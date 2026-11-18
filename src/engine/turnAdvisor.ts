import type { Pokemon as CalcPokemon } from '@smogon/calc';
import { activeFainted, type BattleMon, type BattleSnapshot, type Boosts, type RosterMon } from '../shared/battle';
import type { BoxMon, Dataset, Npc, NpcMon, NpcTeamVariant } from '../shared/types';
import { ASSUMED_NPC_LEVEL, SELF_KO_MOVES, bestMove, boxToCalc, defenderVsNpc, makeField, moveDamage, npcToCalc, repeatable, type MoveDamage } from './damage';
import { rulesFor, type BattleRules } from './rules';
import { movesForBox } from './teamSuggest';
import { guessNpcSwitch, predictNpcMove, type NpcGuess, type NpcSwitchGuess } from './npcModel';
import { npcKey, observedMoves, type ObservedStore } from './observed';

/**
 * Phase 3 turn advice for SINGLES, from a battle snapshot (content script) + game data + your box.
 * Each action (your 4 moves, each switch) gets a 0–100 score from a short 1v1 projection that
 * starts at the CURRENT HP, status and stat stages:
 *   - both sides keep using their best move; priority, then speed (stages, paralysis, Scarf) set the order;
 *   - a switch takes one free hit from the NPC's best move first.
 * Accuracy/evasion stages scale expected damage (ranking only). It is a ranking aid, not a full
 * simulator: no crits, no secondary effects; NPC switching is only a displayed guess.
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
}

export interface ThreatInfo {
  name: string;
  minPct: number;
  maxPct: number;
  /** Their best hit KOs you from your current HP. */
  ko?: 'sure' | 'chance';
  youFirst: boolean | null;
}

export interface TurnAdvice {
  npc?: Npc;
  variant?: NpcTeamVariant;
  /** Their active Pokémon as MeowHelper knows it (wiki set) and whether it was found in the NPC's team. */
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
}

export interface AdviseOptions {
  /** Moves NPC Pokémon used in earlier battles (see observed.ts). */
  observed?: ObservedStore;
  /** Items in your bag (id → count), from the game's Bag page. Enables item advice. */
  items?: ReadonlyMap<string, number>;
}

/**
 * Battle items. Seen live 2026-11-18 (Gym battle): the battle screen has an Items tab, "Choose an
 * item, then its target. Uses one turn." HP amounts are from the wiki (Balls, Medicine and PP
 * Recovery). A Berry used from the Bag is spent for good; a HELD Berry comes back after the battle.
 */
const HEAL_ITEMS: [id: string, name: string, hp: number][] = [
  ['oranberry', 'Oran Berry', 10], ['potion', 'Potion', 20], ['superpotion', 'Super Potion', 60], ['moomoomilk', 'Moomoo Milk', 100],
  ['hyperpotion', 'Hyper Potion', 120], ['maxpotion', 'Max Potion', Infinity], ['fullrestore', 'Full Restore', Infinity],
];
const CURE_ITEMS: [id: string, name: string, cures: string[]][] = [
  ['fullheal', 'Full Heal', ['par', 'brn', 'psn', 'tox', 'slp', 'frz']], ['fullrestore', 'Full Restore', ['par', 'brn', 'psn', 'tox', 'slp', 'frz']],
  ['paralyzeheal', 'Paralyze Heal', ['par']], ['burnheal', 'Burn Heal', ['brn']], ['antidote', 'Antidote', ['psn', 'tox']],
  ['awakening', 'Awakening', ['slp']], ['iceheal', 'Ice Heal', ['frz']],
  ['cheriberry', 'Cheri Berry', ['par']], ['chestoberry', 'Chesto Berry', ['slp']], ['pechaberry', 'Pecha Berry', ['psn', 'tox']],
  ['rawstberry', 'Rawst Berry', ['brn']], ['aspearberry', 'Aspear Berry', ['frz']], ['lumberry', 'Lum Berry', ['par', 'brn', 'psn', 'tox', 'slp', 'frz']],
];
const REVIVE_ITEMS: [id: string, name: string, frac: number][] = [['revive', 'Revive', 0.5], ['maxrevive', 'Max Revive', 1]];

/** Gen 5+ accuracy/evasion stage multiplier for a net stage n (attacker accuracy − target evasion). */
export function accuracyStageMul(n: number): number {
  const s = Math.max(-6, Math.min(6, n));
  return s >= 0 ? (3 + s) / 3 : 3 / (3 - s);
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
      if (lc(who) !== lc(name) && lc(npc.name) !== lc(name)) continue;
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

export function foeSet(ds: Dataset, idx: Idx, v: NpcTeamVariant | undefined, b: BattleMon): { mon: NpcMon; known: boolean } | undefined {
  const named = v?.team.filter((m) => lc(m.name) === lc(b.name)) ?? [];
  const hit = named.find((m) => m.level === b.level) ?? named[0];
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
const stage = (b: number) => (b >= 0 ? (2 + b) / 2 : 2 / (2 - b));

export function battleSpeed(p: CalcPokemon): number {
  let s = p.stats.spe * stage(p.boosts.spe ?? 0);
  if (p.item === 'Choice Scarf') s *= 1.5;
  if (p.status === 'par') s *= 0.5;
  return s;
}

function order(me: CalcPokemon, foe: CalcPokemon, myPrio: number, theirPrio: number): boolean | null {
  if (myPrio !== theirPrio) return myPrio > theirPrio;
  const a = battleSpeed(me);
  const b = battleSpeed(foe);
  return a === b ? null : a > b;
}

/** Projects a 1v1 from current HP%. Damage values are % of each side's max HP per hit. */
function project(myHit: number, theirHit: number, myHp: number, foeHp: number, youFirst: boolean | null) {
  const myTurns = myHit > 0 ? Math.ceil(foeHp / myHit) : Infinity;
  const theirTurns = theirHit > 0 ? Math.ceil(myHp / theirHit) : Infinity;
  const first = youFirst ?? false; // ties count against you
  const win = myTurns !== Infinity && (first ? myTurns <= theirTurns : myTurns < theirTurns);
  if (win) {
    const hpLeft = Math.max(0, myHp - (first ? myTurns - 1 : myTurns) * theirHit);
    return { win, myTurns, score: 55 + 0.45 * hpLeft };
  }
  const dealt = Math.min(foeHp, (theirTurns === Infinity ? 0 : first ? theirTurns : theirTurns - 1) * myHit);
  return { win, myTurns, score: 0.45 * (foeHp > 0 ? (100 * dealt) / foeHp : 0) };
}

const avg = (d: MoveDamage | null) => (d ? (d.minPct + d.maxPct) / 2 : 0);
const pctTxt = (d: { minPct: number; maxPct: number }) => `${Math.round(d.minPct)}–${Math.round(d.maxPct)}%`;

export function adviseTurn(ds: Dataset, snap: BattleSnapshot, box: BoxMon[], opts: AdviseOptions = {}): TurnAdvice {
  const notes: string[] = [];
  const idx = indexes(ds);
  const match = matchNpc(ds, snap);
  const rules: BattleRules = rulesFor(match?.npc.category);
  const field = makeField('singles');
  const out: TurnAdvice = { npc: match?.npc, variant: match?.variant, actions: [], notes };

  const format = snap.format ?? match?.variant.format;
  if (format && format !== 'singles') notes.push('Only singles are supported for now: advice treats this as a 1v1.');
  if (!match) notes.push(`“${snap.opponentName ?? 'This opponent'}” is not in the wiki data (wild or player battle?). Using guessed sets.`);
  if (!snap.player || !snap.opponent) {
    notes.push('Waiting for both Pokémon to be on the field.');
    return out;
  }

  const foe = foeSet(ds, idx, match?.variant, snap.opponent);
  out.foe = foe;
  if (!foe) {
    notes.push(`Unknown Pokémon: ${snap.opponent.name}.`);
    return out;
  }
  // Moves this opponent Pokémon has used in this battle (from the log).
  const usedThisBattle = (snap.events ?? [])
    .filter((e) => e.side === 'opponent' && lc(e.mon) === lc(foe.mon.name))
    .map((e) => idx.moves.get(lc(e.move))?.id)
    .filter((x): x is string => !!x);
  // Moves it used in earlier battles against this trainer + team (battle-observed).
  const seenBefore = opts.observed ? observedMoves(opts.observed, npcKey(match, snap), snap.opponent.name, snap.opponent.level) : [];
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
    extra = seen.filter((id) => !foe.mon.moves.includes(id));
    if (extra.length) notes.push(`${foe.mon.name} was seen using ${extra.map((id) => ds.moves[id]?.name ?? id).join(', ')}, which is not in the wiki set. Counted as a possible threat.`);
  }
  const foeCalc = applyState(npcToCalc(ds, foe.mon), snap.opponent, snap.boosts.opponent);
  const foeMoves = [...foe.mon.moves, ...extra]; // the rules only ban YOUR moves

  // Your active Pokémon fainted ("Choose your next Pokémon."): the only choice is who comes in.
  // No moves, no items (not even a Revive on it), no "KOs you" line for a Pokémon already down.
  if (activeFainted(snap)) {
    out.forcedSwitch = true;
    for (const r of snap.bench) {
      if (r.active || r.fainted || (r.hp ?? 1) <= 0 || lc(r.name) === lc(snap.player.name)) continue;
      out.actions.push(switchAdvice(ds, idx, box, r, foeCalc, foeMoves, rules, field, true));
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

  const threat = bestMove(ds, foeCalc, defenderVsNpc(myCalc, rules), foeMoves, field);
  const theirHit = avg(threat);
  if (threat) {
    const first = order(myCalc, foeCalc, 0, threat.priority);
    out.threat = {
      name: threat.name, minPct: threat.minPct, maxPct: threat.maxPct,
      ko: threat.minPct >= myHp ? 'sure' : threat.maxPct >= myHp ? 'chance' : undefined,
      youFirst: first,
    };
  }

  // Your moves
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
      out.actions.push({ kind: 'move', label: m.name, moveId: g.id, score: 0, reason: 'Fails in World Boss and Mega Chamber battles.' });
      continue;
    }
    if (g.category === 'Status') {
      out.actions.push({ kind: 'move', label: m.name, moveId: g.id, score: null, reason: 'Status move – not scored. Use it if the effect helps.' });
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
    const d = moveDamage(ds, myCalc, foeCalc, g.id, field);
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
    out.actions.push({ kind: 'move', label: m.name, moveId: g.id, minPct: d.minPct, maxPct: d.maxPct, ko, score, reason });
  }

  // Items from your bag
  if (opts.items?.size && rules.bagItems) out.actions.push(...itemAdvice(ds, idx, box, snap, me.mon, myCalc, foeCalc, myMoveIds, foeMoves, rules, field, opts.items));

  // Switches
  for (const r of snap.bench) {
    if (r.active || r.fainted || (r.hp ?? 1) <= 0) continue;
    out.actions.push(switchAdvice(ds, idx, box, r, foeCalc, foeMoves, rules, field));
  }

  if (!rules.bagItems) notes.push('Bag medicine cannot be used in Battle Towers; HP, status and PP carry over between opponents.');

  // Might the NPC switch out? (Display only.)
  const npcBench = snap.opponentTeam
    .filter((r) => !r.active && !r.fainted && (r.hp ?? 1) > 0 && lc(r.name) !== lc(snap.opponent!.name))
    .map((r) => {
      const s = foeSet(ds, idx, match?.variant, r);
      return s && { name: r.name, calc: applyState(npcToCalc(ds, s.mon), r) };
    })
    .filter((x): x is NonNullable<typeof x> => !!x);
  if (npcBench.length) out.npcSwitch = guessNpcSwitch(ds, foeCalc, defenderVsNpc(myCalc, rules), myMoveIds, foeMoves, npcBench, field);

  out.actions.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  if (Object.keys(snap.boosts.player).length || Object.keys(snap.boosts.opponent).length) notes.push('Stat stages come from the battle log and are included.');
  return out;
}

/**
 * One switch option. `free`: a replacement after your Pokémon fainted comes in without taking a
 * hit (mainline rule), so no free hit and no "gives up a turn" penalty; the reason then leads
 * with their best hit on it.
 */
function switchAdvice(ds: Dataset, idx: Idx, box: BoxMon[], r: RosterMon, foeCalc: CalcPokemon, foeMoves: string[], rules: BattleRules, field: ReturnType<typeof makeField>, free = false): ActionAdvice {
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
  if (!mineBest) return { kind: 'switch', label, score: 5, reason: `Takes ~${Math.round(avg(incoming))}% switching in; no known damaging move${mine.known ? '' : ' (not in your box)'}.` };
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
  if (!mineBest) return { kind: 'switch', label, score: 5, threat, reason: `${hit}No known damaging move.${note}` };
  const proj = project(mineBest.expectedPct, avg(incoming), hp, curPct(foeCalc), first);
  const speed = first === null ? 'speed tie' : first ? 'it moves first' : 'they move first';
  return {
    kind: 'switch', label, threat,
    score: Math.round(Math.max(0, Math.min(100, proj.score))),
    reason: `${hit}${mineBest.name} ${pctTxt(mineBest)}, ${speed}: ${proj.win ? 'wins' : 'loses'} the 1v1.${note}`,
  };
}

/** Healing, curing and reviving: each "uses one turn", so the NPC gets a free hit first. */
function itemAdvice(
  ds: Dataset, idx: Idx, box: BoxMon[], snap: BattleSnapshot, myMon: BoxMon, myCalc: CalcPokemon, foeCalc: CalcPokemon,
  myMoveIds: string[], foeMoves: string[], rules: BattleRules, field: ReturnType<typeof makeField>, items: ReadonlyMap<string, number>,
): ActionAdvice[] {
  const out: ActionAdvice[] = [];
  const has = (id: string) => (items.get(id) ?? 0) > 0;
  const left = (id: string) => `${items.get(id)} in bag`;
  const foeHp = curPct(foeCalc);
  /** Score of "use an item on your active Pokémon, take their hit, then fight" from the given state. */
  const afterItem = (me: CalcPokemon, hpPct: number) => {
    const incoming = bestMove(ds, foeCalc, defenderVsNpc(me, rules), foeMoves, field);
    const hpAfter = Math.min(100, hpPct) - avg(incoming);
    const mine = bestMove(ds, me, foeCalc, myMoveIds, field);
    if (hpAfter <= 0) return { score: 0, text: `but ${incoming?.name ?? 'their hit'} still KOs you` };
    if (!mine) return { score: 5, text: 'no damaging move after' };
    const p = project(mine.expectedPct, avg(incoming), hpAfter, foeHp, order(me, foeCalc, mine.priority, incoming?.priority ?? 0));
    return { score: Math.round(Math.max(0, Math.min(100, p.score - 8))), text: `takes ~${Math.round(avg(incoming))}%, then ${mine.name}: ${p.win ? 'wins' : 'loses'} the 1v1` };
  };

  // Heal: the smallest potion that fills most of the missing HP, only when HP is below 75%.
  const maxHp = myCalc.maxHP();
  const missing = maxHp - myCalc.curHP();
  if (curPct(myCalc) < 75 && missing > 0) {
    const owned = HEAL_ITEMS.filter(([id]) => has(id));
    const pick = owned.find(([, , hp]) => hp >= missing * 0.8) ?? owned[owned.length - 1];
    if (pick) {
      const [id, name, hp] = pick;
      const healed = Math.min(hp, missing);
      const r = afterItem(myCalc, (100 * (myCalc.curHP() + healed)) / maxHp);
      out.push({ kind: 'item', label: `${name} on ${snap.player!.name}`, score: r.score, reason: `+${healed} HP (${left(id)}), ${r.text}.` });
    }
  }

  // Cure a status.
  const st = snap.player!.status;
  if (st) {
    const cure = CURE_ITEMS.find(([id, , cures]) => has(id) && cures.includes(st) && id !== 'fullrestore') ?? CURE_ITEMS.find(([id, , cures]) => has(id) && cures.includes(st));
    if (cure) {
      const [id, name] = cure;
      const cured = applyState(boxToCalc(ds, myMon), { ...snap.player!, status: undefined }, snap.boosts.player);
      const r = afterItem(cured, curPct(cured));
      const what = st === 'par' ? 'paralysis (half Speed, may not move)' : st === 'brn' ? 'the burn (half Attack, chip damage)' : st === 'slp' ? 'sleep' : st === 'frz' ? 'the freeze' : 'the poison';
      out.push({ kind: 'item', label: `${name} on ${snap.player!.name}`, score: r.score, reason: `Cures ${what} (${left(id)}), ${r.text}.` });
    }
  }

  // Revive the fainted team member that would do best here (you still need a turn to switch it in).
  const rev = REVIVE_ITEMS.filter(([id]) => has(id));
  if (rev.length) {
    let best: ActionAdvice | null = null;
    for (const r of snap.bench) {
      // Not the active Pokémon: when it is down the advice is a forced switch, never a Revive on it.
      if (r.active || (!r.fainted && (r.hp ?? 1) > 0)) continue;
      const mine = mySet(idx, box, r, (r.moves ?? []).map((m) => m.name));
      if (!mine) continue;
      const [id, name, frac] = rev[0];
      const p = boxToCalc(ds, mine.mon);
      p.originalCurHP = Math.max(1, Math.floor(p.maxHP() * frac));
      const mineBest = bestMove(ds, p, foeCalc, repeatable(movesForBox(ds, mine.mon).filter((m) => !rules.bannedMoves.has(m))), field);
      const incoming = bestMove(ds, foeCalc, defenderVsNpc(p, rules), foeMoves, field);
      if (!mineBest) continue;
      const proj = project(mineBest.expectedPct, avg(incoming), curPct(p) - avg(incoming), foeHp, order(p, foeCalc, mineBest.priority, incoming?.priority ?? 0));
      // Two turns before it acts (revive, then switch in): a clear penalty.
      const score = Math.round(Math.max(0, Math.min(100, proj.score - 25)));
      if (!best || score > (best.score ?? 0)) {
        best = { kind: 'item', label: `${name} on ${r.name}`, score, reason: `Brings ${r.name} back at ${frac === 1 ? 'full' : 'half'} HP (${left(id)}). Switched in later, it ${proj.win ? 'wins' : 'loses'} the 1v1 with ${mineBest.name}.` };
      }
    }
    if (best) out.push(best);
  }
  return out;
}
