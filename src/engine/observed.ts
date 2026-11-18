import type { BattleSnapshot } from '../shared/battle';
import type { Dataset, Npc, NpcTeamVariant } from '../shared/types';
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
    out[key] = { name: e.mon, level, moves: [...(cur?.moves ?? []), id], lastSeen: now };
  }
  return out === store ? store : prune(out);
}

/** Keeps the store small: wild and player battles add keys too (dropped first). */
export const MAX_OBSERVED = 600;
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
  if (exact) return exact.moves;
  const prefix = `${npc}|${lc(name)}|`;
  const any = Object.entries(store).filter(([k]) => k.startsWith(prefix)).flatMap(([, v]) => v.moves);
  return [...new Set(any)];
}

/** Everything recorded for one NPC variant, by Pokémon name (for the NPC tab). */
export function observedForNpc(store: ObservedStore, npc: Npc, variant: NpcTeamVariant): Map<string, string[]> {
  const prefix = `${npc.id}#${lc(variant.label)}|`;
  const out = new Map<string, string[]>();
  for (const [k, v] of Object.entries(store)) {
    if (!k.startsWith(prefix)) continue;
    const name = lc(v.name);
    out.set(name, [...new Set([...(out.get(name) ?? []), ...v.moves])]);
  }
  return out;
}
