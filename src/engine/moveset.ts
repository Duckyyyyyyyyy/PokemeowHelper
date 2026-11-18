import type { Field } from '@smogon/calc';
import type { BoxMon, Dataset, NpcTeamVariant } from '../shared/types';
import { SELF_KO_MOVES, SLEEP_ONLY_MOVES, boxToCalc, makeField, moveDamage, npcToCalc } from './damage';
import type { BattleRules } from './rules';

export type MoveSource = 'known' | 'level' | 'tm' | 'egg';

export interface MoveChoice {
  moveId: string;
  name: string;
  type: string;
  source: MoveSource;
  /** Learn level for 'level' moves. */
  level?: number;
  /** A level-up move it learns ABOVE its current level (before the level cap). */
  later?: boolean;
  /** NPC Pokémon this move is the best answer to. */
  bestAgainst: string[];
}

export interface MovesetSuggestion {
  moves: MoveChoice[];
  /** Sum over NPC Pokémon of min(100, best expected damage %) / team size: 0–100. */
  coverage: number;
  currentCoverage: number;
}

/**
 * Picks up to 4 damaging moves that together hit the NPC team hardest.
 * Candidates: moves it already knows, level-up moves at or below its level (or up to
 * `untilLevel`, e.g. the level cap you can train it to), and TM moves if `allowTM`
 * (only TMs in `ownedTms` when your bag is known). Egg moves are only kept if already known.
 * Damage is computed at its CURRENT level (so the lists compare fairly) unless `calcLevel` is set.
 */
export function suggestMoveset(ds: Dataset, b: BoxMon, v: NpcTeamVariant, opts: { levelCap?: number; untilLevel?: number; calcLevel?: number; passedLevelUps?: boolean; allowTM?: boolean; ownedTms?: ReadonlySet<string> | null; rules?: BattleRules } = {}): MovesetSuggestion {
  const s = ds.species[b.species];
  const level = b.level ?? opts.levelCap ?? 50;
  const until = Math.max(level, opts.untilLevel ?? level);
  const sources = new Map<string, { source: MoveSource; level?: number; later?: boolean }>();
  for (const id of b.moves) sources.set(id, { source: 'known' });
  // Wiki (Learning and Changing Moves): a level-up move is a one-use chance when the Pokémon
  // CROSSES its level while you own it. Moves below its level are only there if that chance is
  // unspent, or by re-learning for a cost (e.g. a Heart Scale): `passedLevelUps: false` leaves them out.
  for (const [id, l] of s?.levelMoves ?? []) {
    if (l > until || sources.has(id) || (l <= level && opts.passedLevelUps === false)) continue;
    sources.set(id, { source: 'level', level: l, later: l > level || undefined });
  }
  // With a bag read from the game, only TMs you own.
  if (opts.allowTM !== false) for (const id of s?.machineMoves ?? []) if (!sources.has(id) && (!opts.ownedTms || opts.ownedTms.has(id))) sources.set(id, { source: 'tm' });

  const candidates = [...sources.keys()].filter((id) => ds.moves[id] && ds.moves[id].category !== 'Status' && !opts.rules?.bannedMoves.has(id) && !SELF_KO_MOVES.has(id) && !SLEEP_ONLY_MOVES.has(id));
  // `calcLevel`: score the moves as if it were already that level (potential view).
  const me = boxToCalc(ds, opts.calcLevel ? { ...b, level: opts.calcLevel } : b, level);
  const foes = v.team.map((n) => npcToCalc(ds, n));
  const field: Field = makeField(v.format);

  // dmg[c][j] = expected % vs NPC j, capped at 100
  const dmg = candidates.map((id) => foes.map((f) => Math.min(100, moveDamage(ds, me, f, id, field)?.expectedPct ?? 0)));
  const coverageOf = (rows: number[]) =>
    foes.length ? foes.reduce((sum, _f, j) => sum + Math.max(0, ...rows.map((r) => dmg[r][j])), 0) / foes.length : 0;

  const chosen: number[] = [];
  while (chosen.length < 4) {
    const base = coverageOf(chosen);
    let best = -1;
    let bestRank = -Infinity;
    let bestGain = 0;
    candidates.forEach((_id, i) => {
      if (chosen.includes(i)) return;
      const gain = coverageOf([...chosen, i]) - base;
      // Tie-break toward moves it already knows, then level-up over TM (never enough to add a useless move).
      const src = sources.get(candidates[i])!.source;
      const later = sources.get(candidates[i])!.later;
      const rank = gain + (src === 'known' ? 0.5 : src === 'level' ? (later ? 0.1 : 0.2) : 0);
      if (rank > bestRank) {
        bestRank = rank;
        best = i;
        bestGain = gain;
      }
    });
    if (best < 0 || bestGain < 0.5) break;
    chosen.push(best);
  }

  const currentRows = candidates.map((id, i) => (b.moves.includes(id) ? i : -1)).filter((i) => i >= 0);
  const moves: MoveChoice[] = chosen.map((i) => {
    const id = candidates[i];
    const src = sources.get(id)!;
    return {
      moveId: id,
      name: ds.moves[id].name,
      type: ds.moves[id].type,
      source: src.source,
      level: src.level,
      later: src.later,
      bestAgainst: v.team.filter((_n, j) => chosen.every((k) => dmg[k][j] <= dmg[i][j]) && dmg[i][j] > 0).map((n) => n.name),
    };
  });
  return { moves, coverage: Math.round(coverageOf(chosen)), currentCoverage: Math.round(coverageOf(currentRows)) };
}
