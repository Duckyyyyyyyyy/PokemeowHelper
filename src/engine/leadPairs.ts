import type { Dataset, NpcTeamVariant } from '../shared/types';
import { boxToCalc, makeField, moveDamage, npcToCalc } from './damage';
import { battleSpeed } from './projection';
import type { Candidate } from './teamSuggest';

/**
 * Phase 4b, Team tab: lead PAIRS for a doubles NPC. The NPC opens with its first two Pokémon
 * (seen live: Tate & Liza sent out Claydol and Xatu, team slots 1 and 2).
 *
 * Score (0–100) = how well the pair answers both NPC leads (best 1v1 score of the two for each
 * lead, averaged) plus small teamwork credits / penalties, all rules of thumb (guessed weights):
 *   +6 spread move next to a partner immune to it (Earthquake + Flying/Levitate), −6 if it hurts the partner
 *   +5 both hits KO one NPC lead together on turn 1 when neither does alone
 *   +4 Fake Out, +4 Follow Me / Rage Powder, +3 Helping Hand, +3 Protect next to a spread user
 *   +4 Tailwind when the pair is slower than a lead, +6 Trick Room when both are slower than both leads
 *   −5 both of yours are KO'd by the same NPC lead's best hit
 */
export interface LeadPair {
  a: Candidate;
  b: Candidate;
  score: number;
  why: string[];
}

const SPREAD = new Set(['allAdjacent', 'allAdjacentFoes']);

export function leadPairs(ds: Dataset, team: Candidate[], v: NpcTeamVariant, levelCap?: number, top = 3): LeadPair[] {
  if (v.format !== 'doubles' || team.length < 2 || v.team.length < 1) return [];
  const leads = v.team.slice(0, 2);
  const field = makeField('doubles');
  const calc = new Map(team.map((c) => [c, boxToCalc(ds, c.mon, levelCap ?? 50)]));
  const leadCalc = leads.map((n) => npcToCalc(ds, n));
  const name = (c: Candidate) => ds.species[c.mon.species]?.name ?? '?';
  const has = (c: Candidate, ids: string[]) => c.mon.moves.find((id) => ids.includes(id));
  const out: LeadPair[] = [];

  for (let i = 0; i < team.length; i++) {
    for (let j = i + 1; j < team.length; j++) {
      const a = team[i];
      const b = team[j];
      const why: string[] = [];
      // Each NPC lead is answered by the better of the two.
      const base = leads.reduce((s, _, k) => s + Math.max(a.pairs[k]?.score ?? 0, b.pairs[k]?.score ?? 0), 0) / leads.length;
      let bonus = 0;

      // Spread moves vs the partner.
      for (const [x, y] of [[a, b], [b, a]] as const) {
        for (const id of x.mon.moves) {
          const mv = ds.moves[id];
          if (!mv || mv.category === 'Status' || mv.target !== 'allAdjacent') continue;
          const d = moveDamage(ds, calc.get(x)!, calc.get(y)!, id, field);
          if (d && d.maxPct <= 0) {
            bonus += 6;
            why.push(`${name(x)}'s ${mv.name} can't hurt ${name(y)}`);
          } else if (d) {
            bonus -= 6;
            why.push(`${name(x)}'s ${mv.name} also hits ${name(y)} (${Math.round(d.minPct)}–${Math.round(d.maxPct)}%)`);
          }
          break;
        }
      }
      // Focus fire on turn 1.
      leads.forEach((n, k) => {
        const da = a.pairs[k]?.duel?.mine;
        const db = b.pairs[k]?.duel?.mine;
        if (da && db && da.minPct < 100 && db.minPct < 100 && da.minPct + db.minPct >= 100) {
          bonus += 5;
          why.push(`${da.name} + ${db.name} KO ${n.name} together on turn 1`);
        }
      });
      // Support moves common in doubles.
      const fo = has(a, ['fakeout']) ?? has(b, ['fakeout']);
      if (fo) { bonus += 4; why.push('Fake Out to stop one lead on turn 1'); }
      if (has(a, ['followme', 'ragepowder']) || has(b, ['followme', 'ragepowder'])) { bonus += 4; why.push('Follow Me / Rage Powder to cover the partner'); }
      if (has(a, ['helpinghand']) || has(b, ['helpinghand'])) { bonus += 3; why.push('Helping Hand boosts the partner'); }
      const spreadUser = [a, b].some((c) => c.mon.moves.some((id) => SPREAD.has(ds.moves[id]?.target ?? '') && ds.moves[id]?.category !== 'Status'));
      if (spreadUser && (has(a, ['protect', 'detect']) || has(b, ['protect', 'detect']))) { bonus += 3; why.push('Protect next to a spread move'); }
      const mySpe = [a, b].map((c) => battleSpeed(calc.get(c)!));
      const theirSpe = leadCalc.map((p) => battleSpeed(p));
      if ((has(a, ['tailwind']) || has(b, ['tailwind'])) && mySpe.some((s) => theirSpe.some((t) => s <= t))) { bonus += 4; why.push('Tailwind: you are slower than a lead'); }
      if ((has(a, ['trickroom']) || has(b, ['trickroom'])) && mySpe.every((s) => theirSpe.every((t) => s < t))) { bonus += 6; why.push('Trick Room: both slower than both leads'); }
      // Shared weakness to one lead.
      leads.forEach((n, k) => {
        const ta = a.pairs[k]?.duel?.theirs;
        const tb = b.pairs[k]?.duel?.theirs;
        if (ta && tb && ta.minPct >= 100 && tb.minPct >= 100) {
          bonus -= 5;
          why.push(`${n.name} KOs both in one hit`);
        }
      });
      out.push({ a, b, score: Math.round(Math.max(0, Math.min(100, base + bonus))), why });
    }
  }
  return out.sort((x, y) => y.score - x.score).slice(0, top);
}
