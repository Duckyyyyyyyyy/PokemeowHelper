import { Field, type Pokemon as CalcPokemon } from '@smogon/calc';
import type { BattleMon, BattleSnapshot } from '../shared/battle';
import type { BoxMon, Dataset, Npc, NpcTeamVariant } from '../shared/types';
import { SELF_KO_MOVES, boxToCalc, defenderVsNpc, moveDamage, npcToCalc, type MoveDamage } from './damage';
import { predictNpcMove } from './npcModel';
import { npcKey, observedMoves, type ObservedStore } from './observed';
import { battleSpeed } from './projection';
import { battleRulesFor, dsFor, type BattleRules } from './rules';
import { fieldFromLog, type FieldState } from './supportMoves';
import { applyState, foeSet, indexes, lc, matchNpc, mySet, type Idx } from './turnAdvisor';

/**
 * Phase 4b: turn advice for DOUBLES (two active Pokémon per side).
 *
 * Seen live (Tate & Liza, 2026-11-19): you pick a command for each position, then a target
 * ("Opponent 1 : Claydol", "Opponent 2 : Xatu", "Ally 1 : Slowbro"); spread moves hit every
 * adjacent Pokémon, your ally included (Surf hit Scrafty), and do ×0.75 damage (Surf on Xatu did
 * 36, below the singles minimum 45 and inside the doubles range; Earthquake 24 on Slowbro, same).
 *
 * Each of your active Pokémon gets its moves scored per target, on one 0–100 scale:
 *   - damage: share of the target's CURRENT HP (× accuracy), a KO bonus, and how dangerous the
 *     target is to your side (its best hit on your two Pokémon);
 *   - spread moves: summed over the foes hit, minus the hit on your own ally (unless it is immune);
 *   - support moves common in doubles (Protect, Fake Out, Helping Hand, Follow Me / Rage Powder,
 *     Tailwind, Trick Room) get rule-of-thumb scores (guessed, see docs/PLAN.md 4b).
 * Then the best PAIR of actions is picked with teamwork credit: both hits on one target to KO it,
 * Protect while your partner's spread move would hit you, Helping Hand on the partner's attack.
 */

type Side = 'player' | 'opponent';

export interface DoublesHit {
  side: Side;
  name: string;
  minPct: number;
  maxPct: number;
  ko?: 'sure' | 'chance';
  immune?: boolean;
}

export interface DoublesAction {
  /** Your Pokémon that acts. */
  user: string;
  kind: 'move' | 'support';
  label: string;
  moveId?: string;
  /** Single-target move: who to pick in the game's target list. */
  target?: { side: Side; name: string; position?: number };
  spread?: boolean;
  /** null = not scored. */
  score: number | null;
  reason: string;
  /** Damage on each Pokémon hit (spread: every one, your ally included). */
  hits?: DoublesHit[];
  /** Spread move that also hits your own ally (not immune): shown as a warning. */
  allyHit?: DoublesHit;
  /** Spread move that hits your ally whose set is unknown (damage not computed). */
  allyUnknown?: string;
  /** Teamwork note (Helping Hand on X, Protect + partner's Earthquake…). */
  combo?: string;
  /** Internal: Helping Hand scored with this partner action in mind (moveId|target). */
  helps?: string;
  /** Single-target move: the target's HP left now, % of its max (for focus fire). */
  targetHp?: number;
}

export interface DoublesMonAdvice {
  mon: BattleMon;
  /** Found in your box (exact IVs/EVs) or guessed. */
  known: boolean;
  /** Where its moves came from. */
  movesFrom: 'screen' | 'remembered' | 'box' | 'none';
  actions: DoublesAction[];
  /** Worst case this turn: both foes' best hits on it. */
  danger?: { minPct: number; maxPct: number; ko?: 'sure' | 'chance'; from: string[] };
}

export interface DoublesFoeAdvice {
  mon: BattleMon;
  known: boolean;
  /** NPC model per Pokémon: likely moves with their likely target (guess). */
  likely: { name: string; prob: number; target?: string; spread?: boolean; ko?: 'sure' | 'chance' }[];
}

export interface DoublesPlan {
  picks: DoublesAction[];
  score: number;
  why: string[];
}

export interface DoublesAdvice {
  npc?: Npc;
  variant?: NpcTeamVariant;
  mine: DoublesMonAdvice[];
  foes: DoublesFoeAdvice[];
  plan?: DoublesPlan;
  /** Turn order by speed (stages, paralysis, Scarf, Tailwind; Trick Room reverses). */
  order: { side: Side; name: string; speed: number }[];
  notes: string[];
}

export interface DoublesOptions {
  observed?: ObservedStore;
  /** Moves of your Pokémon remembered from earlier snapshots (lower-cased name → move names). */
  movesByMon?: Record<string, string[]>;
  /** Force Battle Frontier (Gen III) rules, as AdviseOptions.gen3. */
  gen3?: boolean;
}

/** Move targets (game data, Showdown names) that hit more than one Pokémon. */
const SPREAD_TARGETS = new Set(['allAdjacent', 'allAdjacentFoes']);
const PROTECT_MOVES = new Set(['protect', 'detect', 'spikyshield', 'kingsshield', 'banefulbunker', 'silktrap', 'burningbulwark', 'obstruct']);
const REDIRECT_MOVES = new Set(['followme', 'ragepowder', 'spotlight']);
const FLINCH_FIRST_TURN = new Set(['fakeout']);

const curPct = (p: CalcPokemon) => (100 * p.curHP()) / p.maxHP();
const avgPct = (d: { minPct: number; maxPct: number }) => (d.minPct + d.maxPct) / 2;
const pct = (d: { minPct: number; maxPct: number }) => `${Math.round(d.minPct)}–${Math.round(d.maxPct)}%`;
const alive = (m: BattleMon) => m.hp === undefined || m.hp > 0;

interface Unit {
  side: Side;
  mon: BattleMon;
  calc: CalcPokemon;
  moves: string[];
  known: boolean;
  movesFrom?: DoublesMonAdvice['movesFrom'];
}

/**
 * Field for one hit: always 'Doubles' (the calc also keys screens on it: ×2/3 in doubles, not ½).
 * Screens are the DEFENDER's side (your own when you hit your ally), from the log; Helping Hand,
 * Tailwind on the attacker's side.
 */
export function doublesField(f: FieldState, attacker: Side, defender: Side, opts: { helpingHand?: boolean } = {}): Field {
  const atk = attacker === 'player' ? f.mine : f.theirs;
  const def = defender === 'player' ? f.mine : f.theirs;
  return new Field({
    gameType: 'Doubles',
    attackerSide: { isHelpingHand: !!opts.helpingHand, isTailwind: !!atk.tailwind },
    defenderSide: { isReflect: !!def.reflect, isLightScreen: !!def.lightscreen },
  });
}

/**
 * Damage of one move on one Pokémon. A spread move does ×0.75 only when it has more than one
 * target when used (mainline; immune targets still count, as Earthquake with Xatu showed live):
 * with one target it is computed as a single-target hit.
 */
function hitOn(ds: Dataset, f: FieldState, atk: Unit, def: Unit, moveId: string, targetsOnField: number, opts: { helpingHand?: boolean; rules?: BattleRules } = {}): MoveDamage | null {
  const spread = SPREAD_TARGETS.has(ds.moves[moveId]?.target ?? '');
  const target = def.side === 'player' && atk.side === 'opponent' ? defenderVsNpc(def.calc, opts.rules) : def.calc;
  return moveDamage(ds, atk.calc, target, moveId, doublesField(f, atk.side, def.side, opts), { singleTarget: !spread || targetsOnField <= 1 });
}

/** Pokémon a move hits: single target → [target]; allAdjacentFoes → both foes; allAdjacent → foes + ally. */
function spreadTargets(ds: Dataset, moveId: string, user: Unit, allies: Unit[], foes: Unit[]): Unit[] {
  const t = ds.moves[moveId]?.target ?? '';
  if (t === 'allAdjacentFoes') return foes;
  if (t === 'allAdjacent') return [...foes, ...allies.filter((a) => a !== user)];
  return [];
}

function koOf(d: MoveDamage, hp: number): 'sure' | 'chance' | undefined {
  return d.minPct >= hp ? 'sure' : d.maxPct >= hp ? 'chance' : undefined;
}

export function adviseDoubles(ds: Dataset, snap: BattleSnapshot, box: BoxMon[], opts: DoublesOptions = {}): DoublesAdvice {
  const notes: string[] = [];
  const match = matchNpc(ds, snap);
  // Same rules precedence as adviseTurn (matched NPC, then the battle kind, then the Gen III switch);
  // Battle Frontier doubles use the Gen III data and calc.
  const rules: BattleRules = battleRulesFor(match?.npc.category, snap.kind, opts.gen3);
  ds = dsFor(ds, rules);
  const idx = indexes(ds);
  const out: DoublesAdvice = { npc: match?.npc, variant: match?.variant, mine: [], foes: [], order: [], notes };
  if (!match) notes.push(`“${snap.opponentName ?? 'This opponent'}” is not in the wiki data. Using guessed sets.`);

  const myMons = (snap.actives?.player ?? (snap.player ? [snap.player] : [])).filter(alive);
  const theirMons = (snap.actives?.opponent ?? (snap.opponent ? [snap.opponent] : [])).filter(alive);
  if (!myMons.length || !theirMons.length) {
    notes.push('Waiting for the Pokémon on the field.');
    return out;
  }
  const field = fieldFromLog(snap.events, snap.turn, (n) => idx.moves.get(lc(n))?.id);
  const moveId = (n: string) => idx.moves.get(lc(n))?.id;

  // ----- your side -----
  const mine: Unit[] = [];
  for (const m of myMons) {
    const u = myUnit(ds, idx, box, snap, m, opts);
    if (!u) {
      notes.push(`Unknown Pokémon: ${m.name}.`);
      continue;
    }
    mine.push(u);
    if (!u.known) notes.push(`${m.name} is not in your box: using average IVs. Sync your box for exact numbers.`);
  }
  // ----- their side -----
  const theirs: Unit[] = [];
  for (const m of theirMons) {
    const f = foeSet(ds, idx, match?.variant, m);
    if (!f) {
      notes.push(`Unknown Pokémon: ${m.name}.`);
      continue;
    }
    const used = (snap.events ?? []).filter((e) => e.side === 'opponent' && lc(e.mon) === lc(m.name)).map((e) => moveId(e.move)).filter((x): x is string => !!x);
    const before = opts.observed ? observedMoves(opts.observed, npcKey(match, snap), m.name, m.level) : [];
    const seen = [...new Set([...used, ...before])];
    const moves = f.known ? [...new Set([...f.mon.moves, ...seen])] : [...new Set([...seen, ...f.mon.moves])].slice(0, 4);
    theirs.push({ side: 'opponent', mon: m, calc: applyState(npcToCalc(ds, f.mon), m, m.stages), moves, known: f.known });
    if (!f.known) notes.push(`${m.name}'s set is a guess (moves seen in battle + latest level-up moves, perfect IVs).`);
  }
  if (!mine.length || !theirs.length) return out;

  // ----- threats: each foe's best hit on each of your Pokémon -----
  const foeBest = new Map<Unit, Map<Unit, MoveDamage | null>>();
  for (const f of theirs) {
    const row = new Map<Unit, MoveDamage | null>();
    for (const m of mine) {
      let best: MoveDamage | null = null;
      for (const id of f.moves) {
        if (ds.moves[id]?.category === 'Status') continue;
        const n = SPREAD_TARGETS.has(ds.moves[id]?.target ?? '') ? spreadTargets(ds, id, f, theirs, mine).length : 1;
        const d = hitOn(ds, field, f, m, id, n, { rules });
        if (d && (!best || d.expectedPct > best.expectedPct)) best = d;
      }
      row.set(m, best);
    }
    foeBest.set(f, row);
  }
  /** How dangerous a foe is to your side (0–1): its best hit as a share of your Pokémon's HP left. */
  const danger = (f: Unit) => Math.max(0, ...mine.map((m) => {
    const d = foeBest.get(f)?.get(m);
    return d ? Math.min(1, avgPct(d) / Math.max(1, curPct(m.calc))) : 0;
  }));
  const dangerOn = (m: Unit) => {
    const hits = theirs.map((f) => ({ f, d: foeBest.get(f)?.get(m) })).filter((x) => x.d && x.d.maxPct > 0);
    if (!hits.length) return undefined;
    const minPct = hits.reduce((s, x) => s + x.d!.minPct, 0);
    const maxPct = hits.reduce((s, x) => s + x.d!.maxPct, 0);
    const hp = curPct(m.calc);
    return { minPct, maxPct, ko: (minPct >= hp ? 'sure' : maxPct >= hp ? 'chance' : undefined) as 'sure' | 'chance' | undefined, from: hits.map((x) => `${x.f.mon.name}'s ${x.d!.name}`) };
  };

  // ----- turn order -----
  const trickRoom = trickRoomUp(snap, moveId);
  const all = [...mine, ...theirs];
  out.order = all
    .map((u) => ({ side: u.side, name: u.mon.name, speed: Math.round(battleSpeed(u.calc, (u.side === 'player' ? field.mine : field.theirs).tailwind ? 2 : 1)) }))
    .sort((a, b) => (trickRoom ? a.speed - b.speed : b.speed - a.speed));
  if (trickRoom) notes.push('Trick Room looks active (from the log): slower Pokémon move first.');

  // ----- your actions -----
  for (const me of mine) {
    const partner = mine.find((x) => x !== me);
    const actions: DoublesAction[] = [];
    for (const id of me.moves) {
      const mv = ds.moves[id];
      if (!mv) continue;
      if (rules.bannedMoves.has(id)) {
        actions.push({ user: me.mon.name, kind: 'move', label: mv.name, moveId: id, score: 0, reason: 'Does nothing in this battle (challenge rules).' });
        continue;
      }
      if (mv.category === 'Status') {
        actions.push(supportAction(ds, field, snap, me, partner, mine, theirs, foeBest, id, moveId, trickRoom));
        continue;
      }
      if (SPREAD_TARGETS.has(mv.target)) {
        actions.push(spreadAction(ds, field, me, mine, theirs, id, danger, myMons.filter((m) => m !== me.mon && !mine.some((u) => u.mon === m)).map((m) => m.name)));
        continue;
      }
      if (FLINCH_FIRST_TURN.has(id) && !firstTurnOut(snap, me.mon.name)) {
        actions.push({ user: me.mon.name, kind: 'move', label: mv.name, moveId: id, score: null, reason: 'Fake Out only works on its first turn out.' });
        continue;
      }
      for (const foe of theirs) actions.push(singleAction(ds, field, me, foe, id, danger, snap));
    }
    actions.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
    out.mine.push({ mon: me.mon, known: me.known, movesFrom: me.movesFrom ?? 'none', actions, danger: dangerOn(me) });
    if (!me.moves.length) notes.push(`${me.mon.name}'s moves are not known yet: open its command in the game once (or sync your box).`);
  }

  // ----- the NPC's likely moves, per Pokémon -----
  for (const f of theirs) out.foes.push({ mon: f.mon, known: f.known, likely: npcLikely(ds, snap, field, f, mine, moveId, rules) });

  out.plan = bestPlan(out.mine);
  if (rules.npcIgnoresWonderGuard) notes.push('Challenge rules: the NPC’s attacks ignore Wonder Guard.');
  notes.push('Doubles scores are a guide (one-turn view, no crits); spread ×0.75 checked against one real battle.');
  return out;
}

function myUnit(ds: Dataset, idx: Idx, box: BoxMon[], snap: BattleSnapshot, m: BattleMon, opts: DoublesOptions): Unit | undefined {
  let names: string[] = [];
  let from: DoublesMonAdvice['movesFrom'] = 'none';
  if (snap.movesFor && lc(snap.movesFor) === lc(m.name) && snap.moves.length) {
    names = snap.moves.filter((x) => !x.disabled).map((x) => x.name);
    from = 'screen';
  } else {
    const card = snap.bench.find((r) => lc(r.name) === lc(m.name) && r.moves?.length);
    const remembered = card?.moves?.filter((x) => x.pp !== 0).map((x) => x.name) ?? opts.movesByMon?.[lc(m.name)];
    if (remembered?.length) {
      names = remembered;
      from = 'remembered';
    }
  }
  const set = mySet(idx, box, m, names);
  if (!set) return undefined;
  let moves = names.map((n) => idx.moves.get(lc(n))?.id).filter((x): x is string => !!x);
  if (!moves.length && set.known && set.mon.moves.length) {
    moves = set.mon.moves;
    from = 'box';
  }
  return { side: 'player', mon: m, calc: applyState(boxToCalc(ds, set.mon), m, m.stages), moves: [...new Set(moves)], known: set.known, movesFrom: from };
}

/** Fake Out works on the first turn after the Pokémon came in: no move of it in the log since. */
function firstTurnOut(snap: BattleSnapshot, name: string): boolean {
  const ev = snap.events ?? [];
  return !ev.some((e) => e.side === 'player' && lc(e.mon) === lc(name));
}

function trickRoomUp(snap: BattleSnapshot, moveId: (n: string) => string | undefined): boolean {
  let up = false;
  let since: number | undefined;
  for (const e of snap.events ?? []) {
    if (e.missed || moveId(e.move) !== 'trickroom') continue;
    up = !up; // using it again ends it
    since = e.turn;
  }
  return up && (since === undefined || snap.turn === undefined || snap.turn - since < 5);
}

function singleAction(ds: Dataset, f: FieldState, me: Unit, foe: Unit, id: string, danger: (u: Unit) => number, snap: BattleSnapshot): DoublesAction {
  const mv = ds.moves[id];
  const d = hitOn(ds, f, me, foe, id, 1);
  const target = { side: 'opponent' as Side, name: foe.mon.name, position: foe.mon.position };
  if (!d || d.maxPct <= 0) return { user: me.mon.name, kind: 'move', label: mv.name, moveId: id, target, score: 0, reason: `No effect on ${foe.mon.name}.` };
  const hp = curPct(foe.calc);
  const acc = d.expectedPct / Math.max(0.01, avgPct(d));
  const share = Math.min(1, avgPct(d) / Math.max(1, hp));
  const ko = koOf(d, hp);
  let score = 55 * share * acc + (ko === 'sure' ? 30 : ko === 'chance' ? 12 : 0) * acc + 15 * danger(foe);
  const bits = [`${pct(d)} to ${foe.mon.name}${ko === 'sure' ? ' – KOs it' : ko === 'chance' ? ' – can KO it' : ''}`];
  if (FLINCH_FIRST_TURN.has(id) && firstTurnOut(snap, me.mon.name) && !/inner ?focus|shield ?dust/i.test(foe.calc.ability ?? '')) {
    score += 22 * danger(foe) + 8;
    bits.push(`${foe.mon.name} flinches and loses its turn`);
  }
  if (SELF_KO_MOVES.has(id)) {
    score -= 25;
    bits.push('your Pokémon faints');
  }
  return {
    user: me.mon.name, kind: 'move', label: mv.name, moveId: id, target, score: clamp(score), reason: bits.join('; ') + '.',
    hits: [{ side: 'opponent', name: foe.mon.name, minPct: d.minPct, maxPct: d.maxPct, ko }], targetHp: hp,
  };
}

function spreadAction(ds: Dataset, f: FieldState, me: Unit, mine: Unit[], theirs: Unit[], id: string, danger: (u: Unit) => number, unknownAllies: string[] = []): DoublesAction {
  const mv = ds.moves[id];
  const targets = spreadTargets(ds, id, me, mine, theirs);
  const n = targets.length;
  const hits: DoublesHit[] = [];
  let score = 0;
  let allyHit: DoublesHit | undefined;
  const bits: string[] = [];
  let immuneAlly: string | undefined;
  for (const t of targets) {
    const d = hitOn(ds, f, me, t, id, n);
    const hp = curPct(t.calc);
    if (!d || d.maxPct <= 0) {
      hits.push({ side: t.side, name: t.mon.name, minPct: 0, maxPct: 0, immune: true });
      if (t.side === 'player') immuneAlly = t.mon.name;
      continue;
    }
    const ko = koOf(d, hp);
    const h: DoublesHit = { side: t.side, name: t.mon.name, minPct: d.minPct, maxPct: d.maxPct, ko };
    hits.push(h);
    const acc = d.expectedPct / Math.max(0.01, avgPct(d));
    const share = Math.min(1, avgPct(d) / Math.max(1, hp));
    if (t.side === 'opponent') {
      score += (55 * share + (ko === 'sure' ? 30 : ko === 'chance' ? 12 : 0) + 15 * danger(t)) * acc;
      bits.push(`${pct(d)} to ${t.mon.name}${ko === 'sure' ? ' (KO)' : ko === 'chance' ? ' (can KO)' : ''}`);
    } else {
      allyHit = h;
      score -= (45 * share + (ko === 'sure' ? 40 : ko === 'chance' ? 20 : 0)) * acc;
    }
  }
  // Two foes hit is worth more than one, but the sum of two half-scores is not a KO: soften it.
  const foesHit = hits.filter((h) => h.side === 'opponent' && !h.immune).length;
  if (foesHit > 1) score *= 0.8;
  if (!foesHit) bits.push('no effect on their Pokémon');
  if (ds.moves[id]?.target === 'allAdjacent') for (const n of unknownAllies) bits.push(`also hits your ${n} (its set is unknown)`);
  if (allyHit) bits.push(`also hits your ${allyHit.name} for ${pct(allyHit)}${allyHit.ko === 'sure' ? ' and KOs it!' : allyHit.ko === 'chance' ? ' and can KO it!' : ''}`);
  if (SELF_KO_MOVES.has(id)) {
    score -= 25;
    bits.push('your Pokémon faints');
  }
  return {
    user: me.mon.name, kind: 'move', label: mv.name, moveId: id, spread: true, score: clamp(score), reason: bits.join('; ') + '.', hits, allyHit,
    ...(immuneAlly ? { combo: `${immuneAlly} is immune, so it hits only their side` } : {}),
    ...(ds.moves[id]?.target === 'allAdjacent' && unknownAllies.length ? { allyUnknown: unknownAllies[0] } : {}),
  };
}

/** Rule-of-thumb scores for the support moves that matter in doubles (guessed weights). */
function supportAction(
  ds: Dataset, f: FieldState, snap: BattleSnapshot, me: Unit, partner: Unit | undefined, mine: Unit[], theirs: Unit[],
  foeBest: Map<Unit, Map<Unit, MoveDamage | null>>, id: string, moveId: (n: string) => string | undefined, trickRoom: boolean,
): DoublesAction {
  const name = ds.moves[id].name;
  const base = { user: me.mon.name, kind: 'support' as const, label: name, moveId: id };
  const incoming = (u: Unit) => theirs.reduce((s, t) => s + (foeBest.get(t)?.get(u)?.maxPct ?? 0), 0);
  const threatened = (u: Unit) => incoming(u) >= curPct(u.calc);

  if (PROTECT_MOVES.has(id)) {
    const last = [...(snap.events ?? [])].reverse().find((e) => e.side === 'player' && lc(e.mon) === lc(me.mon.name));
    if (last && PROTECT_MOVES.has(moveId(last.move) ?? '')) return { ...base, score: 5, reason: 'Used last turn: it often fails twice in a row.' };
    if (threatened(me)) return { ...base, score: 52, reason: `Both foes together can KO ${me.mon.name} this turn: Protect buys a turn while your partner attacks.` };
    return { ...base, score: 18, reason: 'Not in danger this turn. Pairs well with a partner\'s Earthquake/Surf (see plan).' };
  }
  if (REDIRECT_MOVES.has(id)) {
    if (!partner) return { ...base, score: null, reason: 'No partner to protect.' };
    if (threatened(partner) && !threatened(me)) return { ...base, score: 58, reason: `Draws their attacks away from ${partner.mon.name}, who could be KO'd this turn; ${me.mon.name} can take it.` };
    return { ...base, score: 22, reason: `${partner.mon.name} is not in danger this turn.` };
  }
  if (id === 'helpinghand') {
    if (!partner) return { ...base, score: null, reason: 'No partner to help.' };
    let best: { gain: number; text: string; helps: string } | undefined;
    for (const pid of partner.moves) {
      const mv = ds.moves[pid];
      if (!mv || mv.category === 'Status') continue;
      const spread = SPREAD_TARGETS.has(mv.target);
      const tgts = spread ? spreadTargets(ds, pid, partner, mine, theirs).filter((t) => t.side === 'opponent') : theirs;
      for (const t of tgts) {
        const n = spread ? spreadTargets(ds, pid, partner, mine, theirs).length : 1;
        const plain = hitOn(ds, f, partner, t, pid, n);
        const boosted = hitOn(ds, f, partner, t, pid, n, { helpingHand: true });
        if (!plain || !boosted) continue;
        const hp = curPct(t.calc);
        const flips = plain.minPct < hp && boosted.minPct >= hp ? 40 : plain.maxPct < hp && boosted.maxPct >= hp ? 20 : 0;
        const gain = flips + Math.min(20, (avgPct(boosted) - avgPct(plain)) / 2);
        if (!best || gain > best.gain) best = { gain, helps: `${pid}|${spread ? '*' : lc(t.mon.name)}`, text: flips ? `${partner.mon.name}'s ${mv.name} then ${flips === 40 ? 'KOs' : 'can KO'} ${t.mon.name} (${pct(boosted)} instead of ${pct(plain)})` : `${partner.mon.name}'s ${mv.name} does ${pct(boosted)} instead of ${pct(plain)} to ${t.mon.name}` };
      }
    }
    if (!best) return { ...base, score: 10, reason: `${partner.mon.name} has no attack to boost.` };
    return { ...base, score: clamp(20 + best.gain), reason: `Helping Hand: ${best.text}.`, combo: `Helping Hand → ${partner.mon.name}`, helps: best.helps };
  }
  if (id === 'tailwind' || id === 'trickroom') {
    const speeds = (u: Unit, mul = 1) => battleSpeed(u.calc, mul);
    if (id === 'tailwind') {
      if (f.mine.tailwind) return { ...base, score: 3, reason: 'Tailwind is already up.' };
      let flips = 0;
      for (const m of mine) for (const t of theirs) if (speeds(m) <= speeds(t) && speeds(m, 2) > speeds(t)) flips++;
      return flips
        ? { ...base, score: clamp(38 + 7 * flips), reason: `Doubles your side's Speed for 4 turns: ${flips} matchup${flips > 1 ? 's' : ''} where you then move first.` }
        : { ...base, score: 12, reason: 'Your side is already faster (or still slower with it).' };
    }
    const slower = mine.filter((m) => theirs.every((t) => speeds(m) < speeds(t))).length;
    if (trickRoom) return { ...base, score: slower ? 2 : 35, reason: slower ? 'Trick Room is up: using it again ends it.' : 'Ends their Trick Room.' };
    return slower
      ? { ...base, score: clamp(35 + 12 * slower), reason: `Slower Pokémon move first for 5 turns: ${slower} of yours ${slower > 1 ? 'are' : 'is'} slower than both foes.` }
      : { ...base, score: 8, reason: 'Your Pokémon are not the slower ones.' };
  }
  return { ...base, score: null, reason: 'Not scored in doubles yet.' };
}

function npcLikely(ds: Dataset, snap: BattleSnapshot, field: FieldState, f: Unit, mine: Unit[], moveId: (n: string) => string | undefined, rules: BattleRules): DoublesFoeAdvice['likely'] {
  const used = (snap.events ?? []).filter((e) => e.side === 'opponent' && lc(e.mon) === lc(f.mon.name)).map((e) => moveId(e.move)).filter((x): x is string => !!x);
  const lastFoe = [...(snap.events ?? [])].reverse().find((e) => e.side === 'opponent' && lc(e.mon) === lc(f.mon.name));
  const perMove = new Map<string, { prob: number; target?: string; ko?: 'sure' | 'chance' }>();
  for (const m of mine) {
    // One prediction per target, on the doubles field (spread moves at ×0.75, screens ×2/3).
    const guesses = predictNpcMove(ds, f.calc, defenderVsNpc(m.calc, rules), f.moves, {
      field: doublesField(field, 'opponent', 'player'),
      myStatus: m.mon.status, myBoosts: m.mon.stages, foeBoosts: f.mon.stages, usedThisBattle: used, firstMove: used.length === 0,
      lastMove: lastFoe ? moveId(lastFoe.move) : undefined,
    });
    for (const g of guesses) {
      const cur = perMove.get(g.moveId);
      if (!cur || g.prob > cur.prob) perMove.set(g.moveId, { prob: g.prob, target: m.mon.name, ko: g.ko });
    }
  }
  const total = [...perMove.values()].reduce((s, x) => s + x.prob, 0) || 1;
  return [...perMove.entries()]
    .map(([id, x]) => {
      const spread = SPREAD_TARGETS.has(ds.moves[id]?.target ?? '');
      const self = ds.moves[id]?.category === 'Status' && !/normal|any/.test(ds.moves[id]?.target ?? '');
      return { name: ds.moves[id]?.name ?? id, prob: x.prob / total, ...(spread ? { spread: true } : self ? {} : { target: x.target }), ko: x.ko };
    })
    .sort((a, b) => b.prob - a.prob)
    .slice(0, 3);
}

/**
 * Best pair of actions (one per Pokémon) with teamwork credit. Weights are guesses:
 * focus fire that KOs together +25 (+12 when only likely), overkill on one target −15,
 * Protect while the partner's spread move would hit it gets the ally penalty back,
 * Helping Hand only counts when the partner does the boosted attack.
 */
function bestPlan(advice: DoublesMonAdvice[]): DoublesPlan | undefined {
  if (advice.length < 2) {
    const top = advice[0]?.actions.find((a) => a.score !== null);
    return top ? { picks: [top], score: top.score!, why: [] } : undefined;
  }
  const [A, B] = advice;
  const cand = (x: DoublesMonAdvice) => x.actions.filter((a) => a.score !== null).slice(0, 8);
  let best: DoublesPlan | undefined;
  for (const a of cand(A)) {
    for (const b of cand(B)) {
      const { bonus, why } = synergy(a, b);
      const score = (a.score ?? 0) + (b.score ?? 0) + bonus;
      if (!best || score > best.score) best = { picks: [a, b], score, why };
    }
  }
  if (best) best.score = Math.round(best.score / 2);
  return best;
}

export function synergy(a: DoublesAction, b: DoublesAction): { bonus: number; why: string[] } {
  let bonus = 0;
  const why: string[] = [];
  // Focus fire: both single-target hits on the same foe.
  if (a.target && b.target && a.target.side === 'opponent' && b.target.side === 'opponent' && a.target.name === b.target.name) {
    const ha = a.hits?.[0];
    const hb = b.hits?.[0];
    if (ha && hb) {
      if (ha.ko === 'sure' || hb.ko === 'sure') {
        bonus -= 15;
        why.push(`${a.target.name} falls to one hit: the second one is wasted`);
      } else {
        const hp = a.targetHp ?? b.targetHp;
        if (hp !== undefined && ha.minPct + hb.minPct >= hp) {
          bonus += 25;
          why.push(`${a.label} + ${b.label} KO ${a.target.name} together`);
        } else if (hp !== undefined && avgPct(ha) + avgPct(hb) >= hp) {
          bonus += 12;
          why.push(`${a.label} + ${b.label} likely KO ${a.target.name} together`);
        }
      }
    }
  }
  // Protect while the partner's spread move would hit you: the ally penalty does not apply.
  for (const [x, y] of [[a, b], [b, a]] as const) {
    if (x.kind === 'support' && PROTECT_MOVES.has(x.moveId ?? '') && y.allyHit && y.allyHit.name === x.user) {
      bonus += 25;
      why.push(`${x.user} protects itself from ${y.user}'s ${y.label}`);
    }
    if (x.moveId === 'helpinghand' && x.helps) {
      const [pid, tgt] = x.helps.split('|');
      const match = y.moveId === pid && (tgt === '*' || (y.target && lc(y.target.name) === tgt));
      if (!match) {
        bonus -= 20;
      } else why.push(`Helping Hand boosts ${y.user}'s ${y.label}`);
    }
    if (x.moveId && REDIRECT_MOVES.has(x.moveId) && (x.score ?? 0) > 40 && y.kind === 'move') {
      bonus += 5;
      why.push(`${x.user} draws the attacks while ${y.user} attacks`);
    }
    if (x.moveId && FLINCH_FIRST_TURN.has(x.moveId) && x.target && y.kind === 'move' && y.target?.name !== x.target.name) {
      bonus += 5;
      why.push(`Fake Out stops ${x.target.name} while ${y.user} hits ${y.target?.name ?? 'their side'}`);
    }
  }
  return { bonus, why };
}

function clamp(n: number) {
  return Math.round(Math.max(0, Math.min(100, n)));
}
