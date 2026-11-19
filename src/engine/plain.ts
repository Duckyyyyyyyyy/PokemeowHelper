/**
 * Plain words for the panel: ratings instead of raw 0–100 scores, short sentences from the facts the
 * advisors return, and a three-step danger level. The scores stay the engine's ranking; players see these.
 */
import type { ActionAdvice, MoveFacts, ThreatInfo } from './turnAdvisor';

export type Tone = 'best' | 'good' | 'ok' | 'weak' | 'none';
export interface Rating {
  label: string;
  tone: Tone;
}

/**
 * Rating for one option. `top` = the best score among the options shown together: the top one (and
 * anything within 3 points of it) is "Best" when it is at least OK, so near-ties read as ties.
 */
export function rate(score: number | null | undefined, top?: number | null): Rating {
  if (score === null || score === undefined) return { label: 'Not rated', tone: 'none' };
  if (score <= 0) return { label: 'Avoid', tone: 'weak' };
  if (top !== undefined && top !== null && score >= 45 && score >= top - 3) return { label: 'Best', tone: 'best' };
  if (score >= 70) return { label: 'Good', tone: 'good' };
  if (score >= 45) return { label: 'OK', tone: 'ok' };
  return { label: 'Weak', tone: 'weak' };
}

export type Danger = 'safe' | 'watch' | 'ko';
export const DANGER_LABEL: Record<Danger, string> = { safe: 'Safe', watch: 'Watch', ko: 'KO risk' };

/** Their best hit on you this turn: KO on every roll = 'ko'; can KO (high roll, crit ≥10% or likely moves ≥10%) = 'watch'. */
export function dangerOf(t: Pick<ThreatInfo, 'ko' | 'koChance' | 'critKo'> | undefined): Danger {
  if (!t) return 'safe';
  if (t.ko === 'sure') return 'ko';
  if (t.ko === 'chance' || (t.koChance ?? 0) >= 0.1 || (t.critKo ?? 0) >= 0.1) return 'watch';
  return 'safe';
}

/** "Knocks it out before it moves" / "2 hits to knock it out · 95% to hit". */
export function factsLine(f: MoveFacts | undefined): string | undefined {
  if (!f) return undefined;
  let s: string;
  if (f.koNow === 'sure') s = f.movesFirst === false ? 'Knocks it out, after their hit' : f.movesFirst === null ? 'Knocks it out (speed tie)' : 'Knocks it out before it moves';
  else if (f.koNow === 'chance') s = 'Can knock it out with a high roll';
  else if (f.hitsToKo) s = `${f.hitsToKo} hits to knock it out`;
  else s = 'Won’t knock it out';
  if (f.accuracy !== undefined) s += ` · ${f.accuracy}% to hit`;
  return s;
}

/** Short tag for a move tile: "KO", "2 hits", "no KO". */
export function factsTag(f: MoveFacts | undefined): string | undefined {
  if (!f) return undefined;
  if (f.koNow === 'sure') return 'KO';
  if (f.koNow === 'chance') return 'KO?';
  return f.hitsToKo ? `${f.hitsToKo} hits` : 'no KO';
}

/** One sentence for any action: facts for damaging moves, otherwise the advisor's own reason. */
export function plainLine(a: ActionAdvice): string {
  return factsLine(a.facts) ?? a.reason;
}

/** "You move first" / "They move first" / "Speed tie". */
export function speedLine(first: boolean | null | undefined): string {
  return first === null || first === undefined ? 'Speed tie' : first ? 'You move first' : 'They move first';
}
