import type { Pokemon as CalcPokemon } from '@smogon/calc';
import { activeFainted, doublesReason, type BattleMon, type BattleSnapshot, type Boosts, type RosterMon } from '../shared/battle';
import type { BoxMon, Dataset, Npc, NpcMon, NpcTeamVariant } from '../shared/types';
import { ASSUMED_NPC_LEVEL, SELF_KO_MOVES, bestMove, boxToCalc, calcErrorCount, defenderVsNpc, makeField, npcToCalc, repeatable, takeCalcErrors, tryMoveDamage, type CalcError, type MoveDamage } from './damage';
import { battleRulesFor, dsFor, type BattleRules } from './rules';
import { movesForBox } from './teamSuggest';
import { guessNpcSwitch, predictNpcMove, type NpcGuess, type NpcSwitchGuess } from './npcModel';
import { npcKey, observedMoves, seenFor, type ObservedStore } from './observed';
import { accuracyStageMul, battleSpeed, order, project } from './projection';
import { itemAdvice, itemsAllowed, resolveItems } from './itemAdvisor';
import { fieldFromLog, rateSupport, supportBlocked, supportEffect, type BenchMon, type SupportContext } from './supportMoves';
import { runLookahead, searchable, setupScore, type LookMon, type Lookahead, type RootValue } from './lookahead';
import { fxNotes } from './moveEffects';
import { asHeavyBoss, bossAttackDs, bossFormOf, bossRules, bossVariant, capBossBoosts, cutBossHit, isWorldBoss } from './worldBoss';

export { accuracyStageMul, battleSpeed };

/**
 * Phase 3 turn advice for SINGLES, from a battle snapshot (content script) + game data + your box.
 * Each action (your 4 moves, each switch) gets a 0–100 score. Cheap path (`lookahead: 0`, used by
 * Explore's Defeat it and the guess tracker): a short 1v1 projection from the CURRENT HP, status
 * and stat stages:
 *   - both sides keep using their best move; priority, then speed (stages, paralysis, Scarf) set the order;
 *   - a switch takes one free hit from the NPC's best move first.
 * Default (Battle tab): the lookahead in lookahead.ts plays 2–3 turns (your options, the NPC's
 * likely reply, damage rolls, crits, secondary effects) and scores the leaf with the same
 * projection, so the scale (55+ = you win the 1v1) is unchanged. Attack reasons add the KO chance
 * incl. crits ("KO 6% via crit") and effects ("30% flinch – you're faster").
 * Accuracy/evasion stages scale expected damage. NPC switching is only a displayed guess.
 */

export interface ActionAdvice {
  kind: 'move' | 'switch' | 'item';
  label: string;
  /** null = not scored (status move, unknown move). */
  score: number | null;
  reason: string;
  moveId?: string;
  minPct?: number;
  maxPct?: number;
  ko?: 'sure' | 'chance';
  /** Switch-ins only: their best hit on this Pokémon once it is in. */
  threat?: ThreatInfo;
  /** Support move scored as setup (stat boost, drop, status, screen, weather, hazard): see supportMoves.ts. */
  tag?: 'setup';
  /** Lookahead: chance (0–1) this move KOs this turn, and the part only a critical hit gives. */
  koChance?: number;
  critKo?: number;
  /** Lookahead: line of play, e.g. "Swords Dance → Earthquake KOs both remaining". */
  line?: string;
  /** The damage calc threw for this row: its numbers are missing or incomplete (shown as "calc error"). */
  calcError?: boolean;
  /** Move rows: position in the game's move grid (0–3, the order the battle screen lists them). */
  slot?: number;
  /** Damaging move rows: plain facts the UI turns into words (see plain.ts). */
  facts?: MoveFacts;
  /**
   * Switch-ins that are not in your box and have no known damaging move: their moves are unknown,
   * so they are not scored (score null) instead of getting a misleading low number.
   */
  unknownMoves?: boolean;
}

export interface MoveFacts {
  /** KO from the target's current HP this turn: 'sure' on every roll, 'chance' on a high roll. */
  koNow?: 'sure' | 'chance';
  /** Hits needed to KO (one-turn projection); undefined when it never KOs. */
  hitsToKo?: number;
  /** You move before their best hit (null = speed tie). */
  movesFirst: boolean | null;
  /** Chance to hit in %, only when below 100 (base accuracy and accuracy/evasion stages). */
  accuracy?: number;
}

export interface ThreatInfo {
  name: string;
  minPct: number;
  maxPct: number;
  /** Their best hit KOs you from your current HP. */
  ko?: 'sure' | 'chance';
  youFirst: boolean | null;
  /** Lookahead: chance (0–1) they KO you this turn with their likely moves, and the part only a crit gives. */
  koChance?: number;
  /** The damage calc threw for some of their moves: this may not be their best hit. */
  calcError?: boolean;
  critKo?: number;
}

export interface TurnAdvice {
  npc?: Npc;
  variant?: NpcTeamVariant;
  /** Their active Pokémon as MeowRPGAdvisor knows it (wiki set) and whether it was found in the NPC's team. */
  foe?: { mon: NpcMon; known: boolean };
  me?: { mon: BoxMon; known: boolean };
  actions: ActionAdvice[];
  threat?: ThreatInfo;
  /** Guess of the NPC's next move (see npcModel.ts). Display only: scores use the worst-case threat. */
  prediction?: NpcGuess[];
  /** Guess that the NPC switches out this turn (display only). */
  npcSwitch?: NpcSwitchGuess;
  /** Moves of their active Pokémon seen in earlier battles (battle-observed data). */
  seenBefore?: string[];
  notes: string[];
  /** Your active Pokémon fainted: actions are only switch-ins (no moves, no items, no top-level threat). */
  forcedSwitch?: boolean;
  /** Damage calc calls that threw this turn (also logged to the console). */
  calcErrors?: CalcError[];
}

export interface AdviseOptions {
  /** Moves NPC Pokémon used in earlier battles (see observed.ts). */
  observed?: ObservedStore;
  /** Items in your bag (id → count), from the game's Bag page. Enables item advice. */
  items?: ReadonlyMap<string, number>;
  /**
   * Turns the lookahead plays out (default 2, deepened to 3 when the tree is small).
   * 0 = the cheap one-turn projection (Explore's Defeat it, the guess tracker).
   */
  lookahead?: number;
  /** Force Battle Frontier (Gen III) rules: the Battle tab switch, for battles the reader can't place. */
  gen3?: boolean;
  /**
   * World Boss moves known for this appearance (from the lobby or picked in Prep), by NPC id.
   * The boss's likely moves then come only from this set (moves it is seen using are still added).
   */
  bossMoves?: Readonly<Record<string, readonly string[]>>;
}

/** matchNpc, with a World Boss narrowed to the moves known for this appearance. */
export function matchWithBossMoves(ds: Dataset, snap: BattleSnapshot, bossMoves?: AdviseOptions['bossMoves']): { npc: Npc; variant: NpcTeamVariant; bossFiltered?: boolean } | undefined {
  const m = matchNpc(ds, snap);
  const sel = m && isWorldBoss(m.npc) ? bossMoves?.[m.npc.id] : undefined;
  return m && sel?.length ? { ...m, variant: bossVariant(m.variant, sel), bossFiltered: true } : m;
}

export const lc = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export function indexes(ds: Dataset) {
  const species = new Map(Object.values(ds.species).map((s) => [lc(s.name), s]));
  const moves = new Map(Object.values(ds.moves).map((m) => [lc(m.name), m]));
  const items = new Map(Object.values(ds.items).map((i) => [lc(i.name), i]));
  return { species, moves, items };
}
export type Idx = ReturnType<typeof indexes>;

const KIND_TO_CATEGORY: Record<string, Npc['category'][]> = {
  gym: ['gym'], league: ['elite-four', 'champion'], 'elite-four': ['elite-four'], champion: ['champion'],
  tower: ['tower'], frontier: ['frontier'], mega: ['mega'], rival: ['rival'], rocket: ['rocket'], boss: ['boss'], 'world-boss': ['boss'],
};

/** Finds the NPC and the team variant that best fits what the battle screen shows. */
export function matchNpc(ds: Dataset, snap: BattleSnapshot): { npc: Npc; variant: NpcTeamVariant } | undefined {
  const name = snap.opponentName?.trim();
  if (!name) return undefined;
  const cats = snap.kind ? KIND_TO_CATEGORY[snap.kind] : undefined;
  let best: { npc: Npc; variant: NpcTeamVariant; score: number } | undefined;
  for (const npc of ds.npcs) {
    for (const v of npc.variants) {
      const who = v.trainerName ?? npc.name;
      // Battle Towers are named after the tower; the screen may show the guardian (title "Battle Tower · Ingo").
      const guardian = npc.category === 'tower' ? npc.title.split(' · ')[1] : undefined;
      if (lc(who) !== lc(name) && lc(npc.name) !== lc(name) && (!guardian || lc(guardian) !== lc(name))) continue;
      let score = cats?.includes(npc.category) ? 2 : 0;
      const seen = [...snap.opponentTeam];
      if (snap.opponent && !seen.some((r) => lc(r.name) === lc(snap.opponent!.name))) seen.push({ ...snap.opponent, active: true, fainted: false });
      for (const r of seen) {
        const hit = v.team.find((m) => lc(m.name) === lc(r.name));
        if (hit) score += hit.level === r.level ? 3 : 1;
        else score -= 2;
      }
      if (!best || score > best.score) best = { npc, variant: v, score };
    }
  }
  return best && { npc: best.npc, variant: best.variant };
}

/**
 * The wiki set of a Pokémon on the battle screen. Teams can hold the same species twice at the same
 * level (Lance's two Lv 54 Dragonair): then `ctx` picks the right one, first by which same-name row
 * of the opponent's roster is active (the roster lists the team in order), else by the moves it used
 * since it came in.
 */
export function foeSet(ds: Dataset, idx: Idx, v: NpcTeamVariant | undefined, b: BattleMon, ctx?: { roster?: RosterMon[]; used?: string[] }): { mon: NpcMon; known: boolean } | undefined {
  const named = v?.team.filter((m) => lc(m.name) === lc(b.name)) ?? [];
  const sameLevel = named.filter((m) => m.level === b.level);
  let hit = sameLevel[0] ?? named[0];
  if (sameLevel.length > 1 && ctx) {
    const rows = (ctx.roster ?? []).filter((r) => lc(r.name) === lc(b.name) && (r.level === undefined || r.level === b.level));
    const at = rows.length === sameLevel.length ? rows.findIndex((r) => r.active && !r.fainted) : -1;
    if (at >= 0) hit = sameLevel[at];
    else if (ctx.used?.length) {
      const fit = (m: NpcMon) => ctx.used!.filter((id) => m.moves.includes(id)).length;
      hit = sameLevel.reduce((best, m) => (fit(m) > fit(best) ? m : best), sameLevel[0]);
    }
  }
  if (hit) return { mon: { ...hit, level: b.level ?? hit.level ?? ASSUMED_NPC_LEVEL }, known: true };
  const s = idx.species.get(lc(b.name));
  if (!s) return undefined;
  const level = b.level ?? ASSUMED_NPC_LEVEL;
  // Unknown set: assume its 4 latest damaging level-up moves.
  const moves = s.levelMoves.filter(([id, l]) => l <= level && ds.moves[id] && ds.moves[id].category !== 'Status').map(([id]) => id);
  return { mon: { species: s.id, name: s.name, level, moves: [...new Set(moves)].slice(-4), baseStats: s.baseStats }, known: false };
}

/** Your box entry for a Pokémon on the battle screen: same species, best move overlap, closest level. */
export function mySet(idx: Idx, box: BoxMon[], b: { name: string; level?: number; item?: string }, moveNames: string[]): { mon: BoxMon; known: boolean } | undefined {
  const s = idx.species.get(lc(b.name));
  if (!s) return undefined;
  const moveIds = moveNames.map((n) => idx.moves.get(lc(n))?.id).filter((x): x is string => !!x);
  const itemId = b.item ? idx.items.get(lc(b.item))?.id ?? null : undefined;
  let best: { mon: BoxMon; score: number } | undefined;
  for (const m of box) {
    if (m.species !== s.id) continue;
    const overlap = moveIds.filter((id) => m.moves.includes(id)).length;
    const lvGap = b.level !== undefined && m.level !== undefined ? Math.abs(b.level - m.level) : 5;
    const score = overlap * 10 - lvGap + (m.source === 'game' ? 1 : 0);
    if (!best || score > best.score) best = { mon: m, score };
  }
  const page = { level: b.level, ...(moveIds.length ? { moves: moveIds } : {}), ...(itemId !== undefined ? { item: itemId } : {}) };
  if (best) return { mon: { ...best.mon, ...page, level: b.level ?? best.mon.level }, known: true };
  return { mon: { uid: `battle:${s.id}`, species: s.id, level: b.level, moves: moveIds, source: 'manual', ...(itemId ? { item: itemId } : {}) }, known: false };
}

const STATUS: Record<string, Exclude<CalcPokemon['status'], ''>> = { par: 'par', brn: 'brn', psn: 'psn', tox: 'tox', slp: 'slp', frz: 'frz' };

export function applyState(p: CalcPokemon, b: { hp?: number; maxHp?: number; status?: string }, boosts?: Boosts) {
  if (b.hp !== undefined && b.maxHp) p.originalCurHP = Math.max(0, Math.round((p.maxHP() * b.hp) / b.maxHp));
  const st = b.status ? STATUS[b.status] : undefined;
  if (st) p.status = st;
  if (boosts) for (const k of ['atk', 'def', 'spa', 'spd', 'spe'] as const) if (boosts[k]) p.boosts[k] = boosts[k]!;
  return p;
}

const curPct = (p: CalcPokemon) => (100 * p.curHP()) / p.maxHP();

const avg = (d: MoveDamage | null) => (d ? (d.minPct + d.maxPct) / 2 : 0);
const pctTxt = (d: { minPct: number; maxPct: number }) => `${Math.round(d.minPct)}–${Math.round(d.maxPct)}%`;

export function adviseTurn(ds: Dataset, snap: BattleSnapshot, box: BoxMon[], opts: AdviseOptions = {}): TurnAdvice {
  takeCalcErrors(); // start the turn clean
  const out = adviseTurnInner(ds, snap, box, opts);
  const errs = takeCalcErrors();
  if (errs.length) {
    out.calcErrors = errs;
    const e = errs[0];
    out.notes.unshift(`Calc error: the damage calc failed ${errs.length}× this turn (first: ${e.attacker} ${ds.moves[e.moveId]?.name ?? e.moveId} → ${e.defender}: ${e.message}). Rows marked "calc error" are not real results. Please report this.`);
  }
  return out;
}

function adviseTurnInner(ds: Dataset, snap: BattleSnapshot, box: BoxMon[], opts: AdviseOptions): TurnAdvice {
  const notes: string[] = [];
  const match = matchWithBossMoves(ds, snap, opts.bossMoves);
  const rules: BattleRules = battleRulesFor(match?.npc.category, snap.kind, opts.gen3);
  ds = dsFor(ds, rules); // Battle Frontier: Gen III data and calc
  const idx = indexes(ds);
  const field = makeField('singles');
  // Safety gate: the lookahead is a singles 1v1 search. On a doubles battle (the Battle tab only
  // gets here when you force the singles view) keep the one-turn projection.
  const isDoubles = !!doublesReason(snap, match?.variant.format);
  const out: TurnAdvice = { npc: match?.npc, variant: match?.variant, actions: [], notes };

  const format = snap.format ?? match?.variant.format;
  if (format && format !== 'singles') notes.push('Only singles are supported for now: advice treats this as a 1v1.');
  if (match?.bossFiltered) notes.push(`World Boss: its likely moves come only from the ${match.variant.team[0]?.moves.length ?? 0} moves known for this appearance (World Boss page or your pick in Prep).`);
  if (!match) notes.push(`“${snap.opponentName ?? 'This opponent'}” is not in the wiki data (wild or player battle?). Using guessed sets.`);
  if (!snap.player || !snap.opponent) {
    notes.push('Waiting for both Pokémon to be on the field.');
    return out;
  }

  const sinceInIds = sinceIn(snap, 'opponent', snap.opponent.name).map((e) => idx.moves.get(lc(e.move))?.id).filter((x): x is string => !!x);
  const foe = foeSet(ds, idx, match?.variant, snap.opponent, { roster: snap.opponentTeam, used: sinceInIds });
  out.foe = foe;
  if (!foe) {
    notes.push(`Unknown Pokémon: ${snap.opponent.name}.`);
    return out;
  }
  // Moves this opponent Pokémon has used in this battle (from the log).
  // A move since it came in is certainly its own; earlier uses by the same name may be a twin's.
  const usedThisBattle = [...new Set([...sinceInIds, ...seenFor((snap.events ?? [])
    .filter((e) => e.side === 'opponent' && lc(e.mon) === lc(foe.mon.name))
    .map((e) => idx.moves.get(lc(e.move))?.id)
    .filter((x): x is string => !!x), foe.mon, match?.variant.team ?? [])])];
  // Moves it used in earlier battles against this trainer + team (battle-observed).
  // Two of the same species and level share one record: keep only what fits this one (seenFor).
  const team = match?.variant.team ?? [];
  const seenBefore = opts.observed ? seenFor(observedMoves(opts.observed, npcKey(match, snap), snap.opponent.name, snap.opponent.level), foe.mon, team) : [];
  // The store also holds this battle's moves (recorded as they happen): show only the earlier ones.
  const earlier = seenBefore.filter((id) => !usedThisBattle.includes(id));
  if (earlier.length) out.seenBefore = earlier;
  const seen = [...new Set([...usedThisBattle, ...seenBefore])];
  let extra: string[] = [];
  if (!foe.known) {
    // Guessed set: moves seen in battle are certain, fill the rest with the guess.
    foe.mon.moves = [...new Set([...seen, ...foe.mon.moves])].slice(0, 4);
    notes.push(`${foe.mon.name}'s set is a guess (moves seen in battle + latest level-up moves, perfect IVs).`);
  } else {
    // Known wiki set: never overwritten, but a move it really used counts as a possible threat.
    // A World Boss narrowed to this appearance's moves: moves recorded at EARLIER spawns belong to other
    // sets, so only moves it used in this battle are added back.
    extra = (match?.bossFiltered ? usedThisBattle : seen).filter((id) => !foe.mon.moves.includes(id));
    if (extra.length) notes.push(`${foe.mon.name} was seen using ${extra.map((id) => ds.moves[id]?.name ?? id).join(', ')}, which is not in the ${match?.bossFiltered ? 'moves picked for this appearance' : 'wiki set'}. Counted as a possible threat.`);
  }
  // World Boss: the same rule as Prep (worldBoss.ts): Max Moves only for GMAX/Eternamax, its hits cut
  // 55% / 70% (one-turn rows), its boosts capped, very heavy.
  const bossF = match && isWorldBoss(match.npc) ? bossFormOf(ds, foe.mon, match.npc.name) : undefined;
  const foeCalc = applyState(npcToCalc(ds, foe.mon), snap.opponent, bossF ? capBossBoosts(snap.boosts.opponent) : snap.boosts.opponent);
  const foeMoves = [...foe.mon.moves, ...extra]; // the rules only ban YOUR moves
  if (bossF) {
    asHeavyBoss(foeCalc);
    // One dataset scores both sides: a move your side also uses keeps its normal power.
    const mine = new Set([...snap.moves.map((m) => idx.moves.get(lc(m.name))?.id),
      ...snap.bench.flatMap((r) => { const s = mySet(idx, box, r, (r.moves ?? []).map((m) => m.name)); return s ? movesForBox(ds, s.mon) : []; })].filter((x): x is string => !!x));
    const shared = foeMoves.filter((id) => mine.has(id) && ds.moves[id] && ds.moves[id].category !== 'Status');
    ds = bossAttackDs(ds, bossF, foeMoves, mine);
    notes.push(`World Boss: ${bossRules(bossF).maxMoves ? 'every attack it makes is a Max Move' : 'it uses its normal moves (only the phase-3 extra attack is a Max Move)'}, at ${bossF === 'eternamax' ? '70' : '55'}% less damage.`);
    if (bossRules(bossF).maxMoves && shared.length) notes.push(`${shared.map((id) => ds.moves[id].name).join(', ')}: your side uses it too, so its hit is counted at normal power, not as a Max Move.`);
  }

  // Your active Pokémon fainted ("Choose your next Pokémon."): the only choice is who comes in.
  // No moves, no items (not even a Revive on it), no "KOs you" line for a Pokémon already down.
  if (activeFainted(snap)) {
    out.forcedSwitch = true;
    const bench = benchFor(ds, idx, box, snap, rules);
    const look = (opts.lookahead ?? 2) > 0 && !isDoubles && bench.length
      ? lookFor(ds, idx, snap, field, rules, null, bench, foe.mon.name, foeCalc, foeMoves, foesLeft(ds, idx, match?.variant, snap, npcBenchOf(ds, idx, match?.variant, snap)), undefined, opts.lookahead, bossF && bossRules(bossF).hitMult)
      : undefined;
    for (const r of snap.bench) {
      if (r.active || r.fainted || (r.hp ?? 1) <= 0) continue; // a same-species teammate (two Aggrons) still counts
      const adv = switchAdvice(ds, idx, box, r, foeCalc, foeMoves, rules, field, true);
      if (look) applySwitchLook(adv, look, bench.findIndex((b) => b.row === r) + 1);
      out.actions.push(adv);
    }
    if (!out.actions.length) notes.push('No healthy Pokémon left to send in.');
    out.actions.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
    return out;
  }

  const me = mySet(idx, box, snap.player, snap.moves.map((m) => m.name));
  out.me = me;
  if (!me) {
    notes.push(`Unknown Pokémon: ${snap.player.name}.`);
    return out;
  }
  if (!me.known) notes.push(`${snap.player.name} is not in your box: using average IVs. Sync your box for exact numbers.`);

  const myCalc = applyState(boxToCalc(ds, me.mon), snap.player, snap.boosts.player);
  // Your accuracy vs their evasion (e.g. Kingdra at Evasion +1): lowers expected damage for ranking only.
  const accMul = accuracyStageMul((snap.boosts.player.accuracy ?? 0) - (snap.boosts.opponent.evasion ?? 0));
  const myHp = curPct(myCalc);
  const foeHp = curPct(foeCalc);
  const myMoveIds = repeatable(snap.moves.filter((m) => !m.disabled).map((m) => idx.moves.get(lc(m.name))?.id).filter((x): x is string => !!x && !rules.bannedMoves.has(x)));
  const myBestHit = bestMove(ds, myCalc, foeCalc, myMoveIds, field);

  // Destiny Bond. The game's own move text: it lasts until the user's next move and "fails if the
  // user used this move successfully as its last move".
  // A friend saw an NPC use it exactly when their next hit would KO it.
  const hasDB = foeMoves.includes('destinybond');
  const lastFoe = [...(snap.events ?? [])].reverse().find((e) => e.side === 'opponent');
  const dbJustUsed = !!lastFoe && lc(lastFoe.mon) === lc(foe.mon.name) && idx.moves.get(lc(lastFoe.move))?.id === 'destinybond';
  if (hasDB || dbJustUsed) notes.push(`${foe.mon.name} knows Destiny Bond: if it faints while Destiny Bond is active, your Pokémon faints too. It wears off when it moves again and fails if used twice in a row.`);

  out.prediction = predictNpcMove(ds, foeCalc, defenderVsNpc(myCalc, rules), foeMoves, {
    field, myStatus: snap.player.status, myBoosts: snap.boosts.player, foeBoosts: snap.boosts.opponent, usedThisBattle,
    // It has not moved yet this battle (approximation: a Pokémon switched back in counts as having moved).
    firstMove: usedThisBattle.length === 0,
    facingKo: !!myBestHit && myBestHit.maxPct >= foeHp,
    lastMove: lastFoe && lc(lastFoe.mon) === lc(foe.mon.name) ? idx.moves.get(lc(lastFoe.move))?.id : undefined,
  });
  if (bossF) {
    const k = bossRules(bossF).hitMult;
    out.prediction = out.prediction.map((g) => (g.minPct === undefined || g.maxPct === undefined ? g
      : { ...g, minPct: g.minPct * k, maxPct: g.maxPct * k, ko: g.minPct * k >= myHp ? 'sure' : g.maxPct * k >= myHp ? 'chance' : undefined }));
  }

  const errBefore = calcErrorCount();
  const threatFull = bestMove(ds, foeCalc, defenderVsNpc(myCalc, rules), foeMoves, field);
  const threat = bossF ? cutBossHit(threatFull, bossF) : threatFull;
  const threatError = calcErrorCount() !== errBefore;
  const theirHit = avg(threat);
  if (threat) {
    const first = order(myCalc, foeCalc, 0, threat.priority);
    out.threat = {
      name: threat.name, minPct: threat.minPct, maxPct: threat.maxPct,
      ko: threat.minPct >= myHp ? 'sure' : threat.maxPct >= myHp ? 'chance' : undefined,
      youFirst: first,
      ...(threatError ? { calcError: true } : {}),
    };
  }

  // Might the NPC switch out? (Display, and stage drops on it would be lost.)
  const npcBench = npcBenchOf(ds, idx, match?.variant, snap);
  if (npcBench.length) out.npcSwitch = guessNpcSwitch(ds, foeCalc, defenderVsNpc(myCalc, rules), myMoveIds, foeMoves, npcBench, field);

  // Support moves (Phase 4a): plan A (attack now) vs plan B (support move, then attack).
  const support: SupportContext = {
    ds, rules, me: myCalc, myBoosts: snap.boosts.player, myMoves: myMoveIds,
    foe: foeCalc, foeName: foe.mon.name, foeBoosts: snap.boosts.opponent, foeMoves,
    bench: benchFor(ds, idx, box, snap, rules),
    foesLeft: foesLeft(ds, idx, match?.variant, snap, npcBench),
    npcMaySwitch: !!out.npcSwitch,
    field: fieldFromLog(snap.events, snap.turn, (n) => idx.moves.get(lc(n))?.id),
  };

  // Lookahead (default): a few turns of expectimax; the cheap path keeps the one-turn projection.
  const myLegal = myMoveIds.filter((id) => ds.moves[id]?.category !== 'Status' || (searchable(ds, id) && !supportBlocked(support, id)));
  const look = (opts.lookahead ?? 2) > 0 && !isDoubles
    ? lookFor(ds, idx, snap, field, rules, { name: snap.player.name, calc: myCalc, moves: myLegal }, support.bench as BenchRow[], foe.mon.name, foeCalc, foeMoves, support.foesLeft ?? [], out.prediction, opts.lookahead, bossF && bossRules(bossF).hitMult)
    : undefined;
  if (look && out.threat) {
    const t = look.engine.threatOdds();
    out.threat.koChance = t.ko;
    out.threat.critKo = t.critKo;
  }
  const lookMove = (id: string) => look?.values.find((v) => v.action.kind === 'move' && v.action.moveId === id);
  const attackLooks = look?.values.filter((v) => v.action.kind === 'move' && ds.moves[v.action.moveId]?.category !== 'Status').map((v) => v.score) ?? [];
  const bestAttackLook = attackLooks.length ? Math.max(...attackLooks) : -1;

  // Best attack's one-turn projection score (plan A), to rebase item rows onto the lookahead scale.
  let planA1 = -1;

  // Your moves (each gets its slot in the game's move grid below)
  const moveRowsFrom = out.actions.length;
  for (const m of snap.moves) {
    const g = idx.moves.get(lc(m.name));
    if (!g) {
      out.actions.push({ kind: 'move', label: m.name, score: null, reason: 'Unknown move.' });
      continue;
    }
    if (m.disabled) {
      out.actions.push({ kind: 'move', label: m.name, moveId: g.id, score: null, reason: m.pp === 0 ? 'No PP left.' : 'Disabled.' });
      continue;
    }
    if (rules.bannedMoves.has(g.id)) {
      out.actions.push({ kind: 'move', label: m.name, moveId: g.id, score: 0, reason: 'Fails in this battle (World Boss / Mega Chamber rules).' });
      continue;
    }
    if (g.category === 'Status') {
      const r = rateSupport(support, g.id);
      const lv = lookMove(g.id);
      if (r && lv && r.score !== null) {
        // One model: the lookahead plays the setup out (what plan B did, over more turns), with 4a's cap.
        const sc = setupScore(lv.score, bestAttackLook);
        const vs = bestAttackLook < 0 ? '' : sc.better ? ' Looking ahead, it beats attacking now.' : r.better ? ' Looking ahead, attacking now is as good or better.' : '';
        out.actions.push({ kind: 'move', label: m.name, moveId: g.id, score: Math.round(sc.score), reason: `${r.reason}${vs}`, tag: 'setup', line: sc.better ? planLine(lv) : undefined });
      } else if (r && r.score !== null && look && bestAttackLook >= 0) {
        // Screens, weather, Tailwind, hazards, Yawn: 4a's plan B, moved onto the lookahead's scale
        // (its gain over attacking now, added to the best attack's lookahead score).
        const gain = r.score - r.planA;
        const score = r.better ? bestAttackLook + Math.max(1, gain) : Math.min(bestAttackLook + gain, bestAttackLook - 10, 50);
        out.actions.push({ kind: 'move', label: m.name, moveId: g.id, score: Math.round(Math.max(0, Math.min(100, score))), reason: r.reason, tag: 'setup' });
      } else if (r) out.actions.push({ kind: 'move', label: m.name, moveId: g.id, score: r.score, reason: r.reason, tag: 'setup' });
      else out.actions.push({ kind: 'move', label: m.name, moveId: g.id, score: null, reason: 'Status move – not scored. Use it if the effect helps.' });
      continue;
    }
    // Moves that fail unless someone is asleep (Snore scored 81 on an awake Snorlax, seen live).
    if (g.id === 'snore' && snap.player.status !== 'slp') {
      out.actions.push({ kind: 'move', label: m.name, moveId: g.id, score: 0, reason: `Fails: ${snap.player.name} must be asleep to use it.` });
      continue;
    }
    if (g.id === 'dreameater' && snap.opponent.status !== 'slp') {
      out.actions.push({ kind: 'move', label: m.name, moveId: g.id, score: 0, reason: 'Fails: the target must be asleep.' });
      continue;
    }
    const { d, error } = tryMoveDamage(ds, myCalc, foeCalc, g.id, field);
    if (error) {
      out.actions.push({ kind: 'move', label: m.name, moveId: g.id, score: null, reason: `Calc error: ${error}. Not scored.`, calcError: true });
      continue;
    }
    if (!d || d.maxPct <= 0) {
      out.actions.push({ kind: 'move', label: m.name, moveId: g.id, score: 0, reason: 'No effect on this target.' });
      continue;
    }
    const first = order(myCalc, foeCalc, d.priority, threat?.priority ?? 0);
    // expectedPct already includes the move's base accuracy; stages scale it (capped at 100%).
    const baseAcc = ds.moves[g.id].accuracy;
    const alwaysHits = baseAcc === true || typeof baseAcc !== 'number' || baseAcc <= 0; // same rule as accOf() in damage.ts
    const base = alwaysHits ? 1 : (baseAcc as number) / 100;
    const hitChance = alwaysHits ? 1 : Math.min(1, base * accMul);
    const p = project(d.expectedPct * (hitChance / base), theirHit, myHp, foeHp, first);
    const ko = d.minPct >= foeHp ? 'sure' : d.maxPct >= foeHp ? 'chance' : undefined;
    let reason: string;
    if (ko === 'sure' && first !== false) reason = 'KOs now' + (first === null ? ' (speed tie)' : ', you move first') + '.';
    else if (ko === 'sure') reason = out.threat?.ko === 'sure' ? 'Would KO, but they move first and KO you.' : 'KOs after taking their hit.';
    else if (ko === 'chance') reason = `Can KO now (needs a high roll)${first === false ? ', after their hit' : ''}.`;
    else reason = `${p.myTurns === Infinity ? 'No KO' : `${p.myTurns} hits to KO`}; ${p.win ? 'you win the trade' : 'you lose the trade'}.`;
    if (!alwaysHits && hitChance < 1) {
      reason += accMul === 1 ? ` ${baseAcc}% accuracy.` : ` ~${Math.round(hitChance * 100)}% to hit (accuracy/evasion stages).`;
    }
    let score = Math.round(Math.max(0, Math.min(100, p.score + (ko === 'sure' && first !== false ? 10 : 0))));
    let koChance: number | undefined;
    let critKo: number | undefined;
    let line: string | undefined;
    const lv = lookMove(g.id);
    if (lv) planA1 = Math.max(planA1, score); // same move set as bestAttackLook (no Explosion etc.)
    if (look && lv) {
      score = Math.round(lv.score);
      // Win/lose follows the lookahead (55+ = you win), not the plain one-turn projection.
      reason = reason.replace(/you (win|lose) the trade/, score >= 55 ? 'you win the trade' : 'you lose the trade');
      const odds = look.engine.hitOdds(0, g.id);
      if (odds) {
        koChance = odds.ko;
        critKo = odds.critKo;
        reason += koText(odds, ko);
      }
      const fx = fxNotes(ds, g.id, {
        atk: myCalc, def: foeCalc, youFirst: look.engine.youFirst(g.id, out.prediction?.[0]?.moveId), dmgPct: Math.min(foeHp, avg(d)),
        defStatus: snap.opponent.status, firstTurn: firstOnField(snap, 'player', snap.player.name), attackerMaxHp: myCalc.maxHP(), defMaxHp: foeCalc.maxHP(),
      });
      if (fx.length) reason += ` ${cap(fx.join(', '))}.`;
      line = planLine(lv);
    }
    // A sure side effect (Icy Wind's −1 Spe, Nuzzle's paralysis): hit once, then fight with it.
    if (!look && !ko && supportEffect(ds, g.id)) {
      const r = rateSupport(support, g.id);
      if (r?.score != null && r.score > score) {
        score = r.score;
        reason = `${r.reason} (${pctTxt(d)} now.)`;
      }
    }
    if (SELF_KO_MOVES.has(g.id)) {
      // One use only and you faint too: worth it for a sure KO, otherwise a last resort.
      const name = snap.player.name;
      if (ko === 'sure' && first !== false) {
        score = Math.min(score, 60);
        reason = `KOs now, but ${name} faints too.`;
      } else {
        score = Math.min(score, 15);
        reason = `${name} faints after using it (${pctTxt(d)} to them). Last resort only.`;
      }
    }
    if (ko && (hasDB || dbJustUsed)) {
      const name = snap.player.name;
      // Destiny Bond has priority 0: compare against it, not against their best attack.
      const vsDb = order(myCalc, foeCalc, d.priority, 0);
      if (dbJustUsed && vsDb !== false) {
        score = Math.min(score, 30);
        reason += ` Destiny Bond is active: ${name} faints too if this KOs. Use a move that doesn't KO, or switch, this turn.`;
      } else if (dbJustUsed) {
        reason += ' Its Destiny Bond ends when it moves, and a second one in a row fails: should be safe to KO.';
      } else if (vsDb !== true) {
        score = Math.min(score, 45);
        reason += ` Risk: it moves first and knows Destiny Bond, so it may use it now and take ${name} down too. Bait it: use a move that doesn't KO, or switch, this turn.`;
      } else {
        reason += ' You hit before it can use Destiny Bond.';
      }
    }
    const facts: MoveFacts = {
      koNow: ko, hitsToKo: p.myTurns === Infinity ? undefined : p.myTurns, movesFirst: first,
      accuracy: !alwaysHits && hitChance < 1 ? Math.round(hitChance * 100) : undefined,
    };
    out.actions.push({ kind: 'move', label: m.name, moveId: g.id, minPct: d.minPct, maxPct: d.maxPct, ko, score, reason, koChance, critKo, line, facts });
  }
  // The loop pushes exactly one row per entry of snap.moves, in order.
  out.actions.slice(moveRowsFrom).forEach((a, i) => (a.slot = i));

  // Items from your bag
  const supply = resolveItems(snap, opts.items);
  if (supply.counts.size && itemsAllowed(snap, rules)) {
    const itemRows = itemAdvice({
      ds, snap, rules, supply, box, myMon: me.mon, myCalc, foeCalc, myMoveIds, foeMoves, field,
      allMoveIds: snap.moves.flatMap((m) => { const id = idx.moves.get(lc(m.name))?.id; return id ? [{ name: m.name, id, pp: m.pp, maxPp: m.maxPp }] : []; }),
      foes: [{ name: foe.mon.name, calc: foeCalc }, ...(support.foesLeft ?? [])],
      h: { applyState, mySet: (b, names) => mySet(idx, box, b, names) },
    });
    // Item rows are scored on the one-turn projection. Under lookahead, keep each item's gain over
    // plan A (best attack, one-turn) and add it to the best attack's lookahead score, as field moves do.
    if (look && bestAttackLook >= 0 && planA1 >= 0) {
      for (const a of itemRows) if (a.score != null) a.score = Math.round(Math.max(0, Math.min(100, bestAttackLook + (a.score - planA1))));
    }
    out.actions.push(...itemRows);
  }

  // Switches
  const benchRows = (support.bench ?? []) as BenchRow[];
  for (const r of snap.bench) {
    if (r.active || r.fainted || (r.hp ?? 1) <= 0) continue;
    const adv = switchAdvice(ds, idx, box, r, foeCalc, foeMoves, rules, field);
    if (look) applySwitchLook(adv, look, benchRows.findIndex((b) => b.row === r) + 1);
    out.actions.push(adv);
  }

  if (rules.gen === 3) notes.push('Battle Frontier: Gen III rules (no Fairy, the type decides physical/special, Gen III moves and items only). Bag items cannot be used.');
  else if (!itemsAllowed(snap, rules)) notes.push('Bag medicine cannot be used in Battle Towers or Player Battles; HP, status and PP carry over between opponents.');

  out.actions.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  if (Object.keys(snap.boosts.player).length || Object.keys(snap.boosts.opponent).length) notes.push('Stat stages come from the battle log and are included.');
  return out;
}

/** Your healthy bench as calc Pokémon with their legal attacks (later-Pokémon credit of support moves). */
function benchFor(ds: Dataset, idx: Idx, box: BoxMon[], snap: BattleSnapshot, rules: BattleRules): BenchRow[] {
  const out: BenchRow[] = [];
  for (const r of snap.bench) {
    if (r.active || r.fainted || (r.hp ?? 1) <= 0) continue;
    const mine = mySet(idx, box, r, (r.moves ?? []).map((m) => m.name));
    if (!mine) continue;
    out.push({ row: r, name: r.name, calc: applyState(boxToCalc(ds, mine.mon), r), moves: repeatable(movesForBox(ds, mine.mon).filter((id) => !rules.bannedMoves.has(id))) });
  }
  return out;
}

type BenchRow = BenchMon & { row: RosterMon };

/** The NPC's healthy Pokémon on its team bar (not the active one). */
function npcBenchOf(ds: Dataset, idx: Idx, v: NpcTeamVariant | undefined, snap: BattleSnapshot) {
  return snap.opponentTeam
    .filter((r) => !r.active && !r.fainted && (r.hp ?? 1) > 0 && lc(r.name) !== lc(snap.opponent!.name))
    .map((r) => {
      const s = foeSet(ds, idx, v, r);
      return s && { name: r.name, calc: applyState(npcToCalc(ds, s.mon), r), moves: s.mon.moves };
    })
    .filter((x): x is NonNullable<typeof x> => !!x);
}

/** Log events of this side since `name` last came in (approximation: since another Pokémon of that side last moved). */
function sinceIn(snap: BattleSnapshot, side: 'player' | 'opponent', name: string) {
  const ev = snap.events ?? [];
  let lastOther = -1;
  for (const e of ev) if (e.side === side && lc(e.mon) !== lc(name)) lastOther = e.idx;
  return ev.filter((e) => e.side === side && lc(e.mon) === lc(name) && e.idx > lastOther);
}

/** It has not moved since it came in: Fake Out / First Impression still work. */
const firstOnField = (snap: BattleSnapshot, side: 'player' | 'opponent', name: string) => sinceIn(snap, side, name).length === 0;

/** Focus Energy used since it came in (from the log; the screen doesn't show it). */
const usedFocusEnergy = (snap: BattleSnapshot, side: 'player' | 'opponent', name: string, idx: Idx) =>
  sinceIn(snap, side, name).some((e) => !e.missed && idx.moves.get(lc(e.move))?.id === 'focusenergy');

type Look = { engine: Lookahead; values: RootValue[]; depth: number };

function lookFor(
  ds: Dataset, idx: Idx, snap: BattleSnapshot, field: ReturnType<typeof makeField>, rules: BattleRules, me: LookMon | null, bench: BenchRow[],
  foeName: string, foeCalc: CalcPokemon, foeMoves: string[], left: { name: string; calc: CalcPokemon; moves: string[] }[],
  prediction: NpcGuess[] | undefined, depth: number | undefined, foeHitMult?: number,
): Look | undefined {
  let active = me;
  if (!active) {
    if (!bench.length) return undefined;
    // Forced switch: a fainted placeholder in the active slot; only the switch-ins are scored.
    const c = bench[0].calc.clone();
    c.originalCurHP = 0;
    active = { name: snap.player?.name ?? 'Fainted', calc: c, moves: [] };
  }
  const mine: LookMon[] = [
    { ...active, asDefender: defenderVsNpc(active.calc, rules) },
    ...bench.map((b) => ({ name: b.name, calc: b.calc, asDefender: defenderVsNpc(b.calc, rules), moves: b.moves })),
  ];
  const foes: LookMon[] = [{ name: foeName, calc: foeCalc, moves: repeatable(foeMoves) }, ...left.map((f) => ({ name: f.name, calc: f.calc, moves: repeatable(f.moves) }))];
  return runLookahead({
    ds, field, mine, foes,
    myBoosts: me ? snap.boosts.player : undefined, foeBoosts: snap.boosts.opponent,
    focusEnergy: {
      me: !!me && !!snap.player && usedFocusEnergy(snap, 'player', snap.player.name, idx),
      foe: !!snap.opponent && usedFocusEnergy(snap, 'opponent', snap.opponent.name, idx),
    },
    firstTurn: {
      me: !!me && !!snap.player && firstOnField(snap, 'player', snap.player.name),
      foe: !!snap.opponent && firstOnField(snap, 'opponent', snap.opponent.name),
    },
    prediction: me ? prediction?.map((g) => ({ moveId: g.moveId, prob: g.prob })) : undefined,
    depth,
    foeHitMult,
  });
}

/** Replaces a switch row's score with the lookahead's, adds the line of play and their KO odds on it. */
function applySwitchLook(adv: ActionAdvice, look: Look, to: number) {
  if (to <= 0 || adv.score === null) return;
  const v = look.values.find((x) => x.action.kind === 'switch' && x.action.to === to);
  if (!v) return;
  adv.score = Math.round(v.score);
  adv.line = planLine(v);
  if (adv.threat) {
    const t = look.engine.threatOdds(to);
    adv.threat.koChance = t.ko;
    adv.threat.critKo = t.critKo;
  }
}

/** The line of play is shown when it says more than the move itself (two steps or more, or a tail). */
const planLine = (v: RootValue) => (v.line && (v.line.includes('→') || v.line.includes(', then')) ? v.line : undefined);

const pctOf = (x: number) => (x >= 0.995 ? '100%' : x > 0 && x < 0.01 ? '<1%' : `${Math.round(x * 100)}%`);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "KO 6% via crit" / "~40% to KO now (5% via crit)". */
function koText(o: { ko: number; critKo: number }, ko: 'sure' | 'chance' | undefined): string {
  if (o.ko < 0.005 || (ko === 'sure' && o.ko >= 0.995)) return '';
  if (o.critKo >= 0.9 * o.ko) return ` KO ${pctOf(o.critKo)} via crit.`;
  return ` ~${pctOf(o.ko)} to KO now${o.critKo >= 0.005 ? ` (${pctOf(o.critKo)} via crit)` : ''}.`;
}

/** NPC Pokémon still to come: seen on its team bar, plus wiki team members not seen yet (hazards). */
function foesLeft(ds: Dataset, idx: Idx, v: NpcTeamVariant | undefined, snap: BattleSnapshot, seen: { name: string; calc: CalcPokemon; moves: string[] }[]) {
  const out = [...seen];
  const shown = new Set([...snap.opponentTeam.map((r) => lc(r.name)), lc(snap.opponent?.name ?? '')]);
  for (const m of v?.team ?? []) {
    if (shown.has(lc(m.name))) continue;
    shown.add(lc(m.name));
    const s = foeSet(ds, idx, v, { name: m.name, level: m.level });
    if (s) out.push({ name: m.name, calc: npcToCalc(ds, s.mon), moves: s.mon.moves });
  }
  return out;
}

/**
 * One switch option. `free`: a replacement after your Pokémon fainted comes in without taking a
 * hit (mainline rule; the game's log agrees: "Brock sent out Onix!" right after Geodude fainted closed
 * that turn with no hit), so no free hit and no "gives up a turn" penalty; the reason then leads
 * with their best hit on it.
 */
function switchAdvice(ds: Dataset, idx: Idx, box: BoxMon[], r: RosterMon, foeCalc: CalcPokemon, foeMoves: string[], rules: BattleRules, field: ReturnType<typeof makeField>, free = false): ActionAdvice {
  const before = calcErrorCount();
  const adv = switchAdviceInner(ds, idx, box, r, foeCalc, foeMoves, rules, field, free);
  if (calcErrorCount() !== before) {
    adv.calcError = true;
    adv.reason = `Calc error (some damage could not be computed). ${adv.reason}`;
  }
  return adv;
}

function switchAdviceInner(ds: Dataset, idx: Idx, box: BoxMon[], r: RosterMon, foeCalc: CalcPokemon, foeMoves: string[], rules: BattleRules, field: ReturnType<typeof makeField>, free = false): ActionAdvice {
  const label = free ? `Send in ${r.name}` : `Switch to ${r.name}`;
  const mine = mySet(idx, box, r, (r.moves ?? []).map((m) => m.name));
  if (!mine) return { kind: 'switch', label, score: null, reason: 'Unknown Pokémon.' };
  const p = applyState(boxToCalc(ds, mine.mon), r);
  const moves = movesForBox(ds, mine.mon);
  const incoming = bestMove(ds, foeCalc, defenderVsNpc(p, rules), foeMoves, field);
  if (free) return freeSwitchAdvice(ds, label, mine.known, p, moves, incoming, foeCalc, rules, field);
  const hpAfter = curPct(p) - avg(incoming);
  if (hpAfter <= 0) return { kind: 'switch', label, score: 0, reason: `Would faint switching in (${incoming ? `${incoming.name} ${pctTxt(incoming)}` : ''}).` };
  const mineBest = bestMove(ds, p, foeCalc, repeatable(moves.filter((id) => !rules.bannedMoves.has(id))), field);
  if (!mineBest) {
    return mine.known
      ? { kind: 'switch', label, score: 5, reason: `Takes ~${Math.round(avg(incoming))}% switching in; no known damaging move.` }
      : { kind: 'switch', label, score: null, unknownMoves: true, reason: `Takes ~${Math.round(avg(incoming))}% switching in. Its moves are unknown (not in your box): sync your box to rate it.` };
  }
  const first = order(p, foeCalc, mineBest.priority, incoming?.priority ?? 0);
  const proj = project(mineBest.expectedPct, avg(incoming), hpAfter, curPct(foeCalc), first);
  // Switching gives up this turn's attack: small penalty so a good attack wins ties.
  const score = Math.round(Math.max(0, Math.min(100, proj.score - 8)));
  return {
    kind: 'switch', label, score,
    reason: `Takes ~${Math.round(avg(incoming))}% switching in, then ${mineBest.name} ${pctTxt(mineBest)}: ${proj.win ? 'wins' : 'loses'} the 1v1.${mine.known ? '' : ' (Not in your box: average IVs.)'}`,
  };
}

function freeSwitchAdvice(
  ds: Dataset, label: string, known: boolean, p: CalcPokemon, moves: string[], incoming: MoveDamage | null,
  foeCalc: CalcPokemon, rules: BattleRules, field: ReturnType<typeof makeField>,
): ActionAdvice {
  const hp = curPct(p);
  const mineBest = bestMove(ds, p, foeCalc, repeatable(moves.filter((id) => !rules.bannedMoves.has(id))), field);
  const first = order(p, foeCalc, mineBest?.priority ?? 0, incoming?.priority ?? 0);
  const threat: ThreatInfo | undefined = incoming
    ? { name: incoming.name, minPct: incoming.minPct, maxPct: incoming.maxPct, ko: incoming.minPct >= hp ? 'sure' : incoming.maxPct >= hp ? 'chance' : undefined, youFirst: first }
    : undefined;
  const hit = threat ? `Their ${threat.name} does ${pctTxt(threat)} to it${threat.ko === 'sure' ? ' (KOs it)' : threat.ko ? ' (can KO it)' : ''}. ` : '';
  const note = known ? '' : ' (Not in your box: average IVs.)';
  if (!mineBest) {
    return known
      ? { kind: 'switch', label, score: 5, threat, reason: `${hit}No known damaging move.` }
      : { kind: 'switch', label, score: null, unknownMoves: true, threat, reason: `${hit}Its moves are unknown (not in your box): sync your box to rate it.` };
  }
  const proj = project(mineBest.expectedPct, avg(incoming), hp, curPct(foeCalc), first);
  const speed = first === null ? 'speed tie' : first ? 'it moves first' : 'they move first';
  return {
    kind: 'switch', label, threat,
    score: Math.round(Math.max(0, Math.min(100, proj.score))),
    reason: `${hit}${mineBest.name} ${pctTxt(mineBest)}, ${speed}: ${proj.win ? 'wins' : 'loses'} the 1v1.${note}`,
  };
}
