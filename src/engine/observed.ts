import type { BattleSnapshot } from '../shared/battle';
import type { Dataset, Npc, NpcMon, NpcTeamVariant } from '../shared/types';
import { indexes, lc, matchNpc, type Idx } from './turnAdvisor';

/**
 * "battle-observed" data: moves NPC Pokémon were actually seen using, remembered across battles.
 * Kept apart from the wiki Dataset (a wiki sync replaces that) and merged in at read time.
 *
 * Recording is idempotent: the store only holds SETS of move ids, so feeding the same snapshot
 * twice (panel reload, repeated storage events) never changes the result.
 */
export interface ObservedMon {
  /** Display name of the Pokémon, as on the battle screen. */
  name: string;
  level?: number;
  /** Move ids seen in battle, oldest first. */
  moves: string[];
  /** Last time a move of this Pokémon was recorded (ms). */
  lastSeen: number;
  /**
   * Moves seen by OTHER players (imported files, see share.ts): move id → number of imported
   * sources that saw it. Never written by battle recording; `moves` stays "seen by you".
   */
  others?: Record<string, number>;
}

/** Key → observation. Key = `${npcKey}|${species}|${level}`, see obsKey(). */
export type ObservedStore = Record<string, ObservedMon>;

/** Moves that are never part of a set (Struggle) or that make the log show ANOTHER move. */
const NOT_A_SET_MOVE = new Set(['struggle']);
const CALLS_OTHER_MOVES = new Set(['metronome', 'sleeptalk', 'copycat', 'assist', 'mefirst', 'mirrormove', 'naturepower', 'transform', 'mimic', 'sketch']);

/** Identifies the trainer + team variant (first run vs rematch have different sets). */
export function npcKey(match: { npc: Npc; variant: NpcTeamVariant } | undefined, snap: Pick<BattleSnapshot, 'opponentName' | 'kind'>): string {
  if (match) return `${match.npc.id}#${lc(match.variant.label)}`;
  return `name:${lc(snap.opponentName ?? 'unknown')}#${snap.kind ?? ''}`;
}

export const obsKey = (npc: string, name: string, level?: number) => `${npc}|${lc(name)}|${level ?? '?'}`;

/**
 * Adds the opponent's move uses in `snap` to `store`. Returns the same object when nothing new
 * was learnt (cheap equality check for the caller), a new object otherwise.
 */
export function recordObserved(ds: Dataset, store: ObservedStore, snap: BattleSnapshot, now = Date.now(), idx: Idx = indexes(ds)): ObservedStore {
  const events = (snap.events ?? []).filter((e) => e.side === 'opponent');
  if (!events.length) return store;
  const match = matchNpc(ds, snap);
  const npc = npcKey(match, snap);
  const levelOf = (name: string) =>
    snap.opponentTeam.find((r) => lc(r.name) === lc(name))?.level
    ?? (snap.opponent && lc(snap.opponent.name) === lc(name) ? snap.opponent.level : undefined);

  let out = store;
  for (const e of events) {
    const id = idx.moves.get(lc(e.move))?.id;
    if (!id || NOT_A_SET_MOVE.has(id)) continue;
    const level = levelOf(e.mon);
    const wiki = match?.variant.team.find((m) => lc(m.name) === lc(e.mon) && (level === undefined || m.level === undefined || m.level === level));
    // A Pokémon that calls other moves logs the CALLED move: only keep moves that are in its set.
    if (wiki && wiki.moves.some((m) => CALLS_OTHER_MOVES.has(m)) && !wiki.moves.includes(id)) continue;
    const key = obsKey(npc, e.mon, level);
    const cur = out[key];
    if (cur?.moves.includes(id)) continue;
    if (out === store) out = { ...store };
    out[key] = { ...cur, name: e.mon, level, moves: [...(cur?.moves ?? []), id], lastSeen: now };
  }
  return out === store ? store : prune(out);
}

/** Keeps the store small: wild and player battles add keys too (dropped first). */
export const MAX_OBSERVED = 2500;
function prune(store: ObservedStore): ObservedStore {
  const keys = Object.keys(store);
  if (keys.length <= MAX_OBSERVED) return store;
  // Wild/player battles ("name:" keys) go first, so grinding never pushes out Gym/League data.
  const unmatched = (k: string) => (k.startsWith('name:') ? 1 : 0);
  const keep = keys.sort((a, b) => unmatched(a) - unmatched(b) || store[b].lastSeen - store[a].lastSeen).slice(0, MAX_OBSERVED);
  return Object.fromEntries(keep.map((k) => [k, store[k]]));
}

/** Moves recorded for one NPC Pokémon (exact level first, then any level of that variant). */
export function observedMoves(store: ObservedStore, npc: string, name: string, level?: number): string[] {
  const exact = store[obsKey(npc, name, level)];
  if (exact) return allMoves(exact);
  const prefix = `${npc}|${lc(name)}|`;
  const any = Object.entries(store).filter(([k]) => k.startsWith(prefix)).flatMap(([, v]) => allMoves(v));
  return [...new Set(any)];
}

/**
 * Seen moves that belong to `mon`. The store keys a Pokémon by NPC + name + level, so twins (two
 * Lv 54 Dragonair on one team) share a record: a move goes to the twin(s) whose wiki set has it,
 * and only a move none of them has stays on all of them (shown as "not in wiki").
 */
export function seenFor(seen: string[], mon: Pick<NpcMon, 'name' | 'level' | 'moves'>, team: readonly NpcMon[], anyLevel = false): string[] {
  // anyLevel: the NPC tab merges records by name over all levels.
  const twins = team.filter((t) => lc(t.name) === lc(mon.name) && (anyLevel || t.level === mon.level));
  if (twins.length < 2) return seen;
  return seen.filter((id) => mon.moves.includes(id) || !twins.some((t) => t.moves.includes(id)));
}

/** Own moves first, then moves only other players saw. */
const allMoves = (m: ObservedMon): string[] => [...new Set([...m.moves, ...Object.keys(m.others ?? {})])];

/** For labelling: how many imported sources saw `move` for this NPC Pokémon (0 = none). */
export function seenByOthers(store: ObservedStore, npc: string, name: string, level: number | undefined, move: string): number {
  const exact = store[obsKey(npc, name, level)];
  if (exact) return exact.others?.[move] ?? 0;
  const prefix = `${npc}|${lc(name)}|`;
  return Math.max(0, ...Object.entries(store).filter(([k]) => k.startsWith(prefix)).map(([, v]) => v.others?.[move] ?? 0));
}

/** True when `you` saw the move yourself (not only others). */
export function seenByYou(store: ObservedStore, npc: string, name: string, level: number | undefined, move: string): boolean {
  const exact = store[obsKey(npc, name, level)];
  if (exact) return exact.moves.includes(move);
  const prefix = `${npc}|${lc(name)}|`;
  return Object.entries(store).some(([k, v]) => k.startsWith(prefix) && v.moves.includes(move));
}

/** Everything recorded for one NPC variant, by Pokémon name (for the NPC tab). */
export function observedForNpc(store: ObservedStore, npc: Npc, variant: NpcTeamVariant): Map<string, string[]> {
  return forNpc(store, npc, variant, allMoves);
}

/** Same, but only the moves other players saw (with source counts) — for labelling in the NPC tab. */
export function observedByOthersForNpc(store: ObservedStore, npc: Npc, variant: NpcTeamVariant): Map<string, Record<string, number>> {
  const prefix = `${npc.id}#${lc(variant.label)}|`;
  const out = new Map<string, Record<string, number>>();
  for (const [k, v] of Object.entries(store)) {
    if (!k.startsWith(prefix) || !v.others) continue;
    const name = lc(v.name);
    const cur = { ...(out.get(name) ?? {}) };
    for (const [id, n] of Object.entries(v.others)) cur[id] = Math.max(cur[id] ?? 0, n);
    out.set(name, cur);
  }
  return out;
}

function forNpc(store: ObservedStore, npc: Npc, variant: NpcTeamVariant, pick: (m: ObservedMon) => string[]): Map<string, string[]> {
  const prefix = `${npc.id}#${lc(variant.label)}|`;
  const out = new Map<string, string[]>();
  for (const [k, v] of Object.entries(store)) {
    if (!k.startsWith(prefix)) continue;
    const name = lc(v.name);
    out.set(name, [...new Set([...(out.get(name) ?? []), ...pick(v)])]);
  }
  return out;
}
