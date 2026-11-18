import type { Field, Pokemon as CalcPokemon } from '@smogon/calc';
import type { Boosts } from '../shared/battle';
import type { Dataset } from '../shared/types';
import { moveDamage } from './damage';

/**
 * Guess of the NPC's next move: a probability per move it knows. Heuristic in the spirit of
 * mainline trainer AI (strong hits and KOs preferred, useless status moves avoided). Based on
 * very few real observations (Brock: 4× strongest hit, 1× Screech on a switch-in), so it is
 * shown as a guess only; the KO warning and scores always use their worst-case hit.
 */
export interface NpcGuess {
  moveId: string;
  name: string;
  prob: number;
  minPct?: number;
  maxPct?: number;
  ko?: 'sure' | 'chance';
}

const STATUS_WORDS = /paralyz|poison|burn|sleep|freez|confus/i;
const LOWERS_TARGET: [RegExp, keyof Boosts][] = [
  [/lowers the target's special defense|lowers the target's sp\. def/i, 'spd'],
  [/lowers the target's special attack|lowers the target's sp\. atk/i, 'spa'],
  [/lowers the target's attack/i, 'atk'],
  [/lowers the target's defense/i, 'def'],
  [/lowers the target's speed/i, 'spe'],
  [/lowers the target's accuracy/i, 'accuracy'],
];

export function predictNpcMove(
  ds: Dataset,
  foe: CalcPokemon,
  me: CalcPokemon,
  moveIds: string[],
  ctx: { field?: Field; myStatus?: string; myBoosts?: Boosts; foeBoosts?: Boosts; usedThisBattle?: string[] } = {},
): NpcGuess[] {
  const myHp = (100 * me.curHP()) / me.maxHP();
  const used = ctx.usedThisBattle ?? [];
  const rows = moveIds.map((id) => {
    const mv = ds.moves[id];
    if (!mv) return null;
    let w: number;
    let dmg: ReturnType<typeof moveDamage> = null;
    if (mv.category !== 'Status') {
      dmg = moveDamage(ds, foe, me, id, ctx.field);
      const exp = dmg?.expectedPct ?? 0;
      w = exp <= 0 ? 0.05 : 1 + 6 * Math.min(1, exp / Math.max(1, myHp)) + (dmg!.minPct >= myHp ? 6 : dmg!.maxPct >= myHp ? 2 : 0);
    } else {
      const d = mv.description;
      w = 1.2;
      if (STATUS_WORDS.test(d) && /target/i.test(d) && ctx.myStatus) w = 0.05; // you already have a status
      const lowers = LOWERS_TARGET.find(([re]) => re.test(d));
      if (lowers && (ctx.myBoosts?.[lowers[1]] ?? 0) <= -6) w = 0.05;
      if (/raises the user's/i.test(d)) w = Math.max(0.1, 1.2 - 0.5 * used.filter((u) => u === id).length);
      if (/protect|detect|endure/i.test(mv.name)) w = 0.6;
      if (/heal|restore|recover|rest\b/i.test(d) && myHp > 0) w = (100 * foe.curHP()) / foe.maxHP() < 50 ? 2 : 0.2;
    }
    // What it did earlier in this battle hints at its habits (small nudge).
    w += Math.min(2, 0.5 * used.filter((u) => u === id).length);
    return { moveId: id, name: mv.name, w, dmg };
  }).filter((r): r is NonNullable<typeof r> => !!r);

  const total = rows.reduce((s, r) => s + r.w, 0) || 1;
  return rows
    .map((r) => ({
      moveId: r.moveId,
      name: r.name,
      prob: r.w / total,
      minPct: r.dmg?.minPct,
      maxPct: r.dmg?.maxPct,
      ko: r.dmg ? (r.dmg.minPct >= myHp ? 'sure' as const : r.dmg.maxPct >= myHp ? 'chance' as const : undefined) : undefined,
    }))
    .sort((a, b) => b.prob - a.prob);
}
