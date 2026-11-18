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
const RAISES_USER: [RegExp, keyof Boosts][] = [
  [/user's (special attack|sp\. atk)/i, 'spa'],
  [/user's (special defense|sp\. def)/i, 'spd'],
  [/user's attack/i, 'atk'],
  [/user's defense/i, 'def'],
  [/user's speed/i, 'spe'],
  [/user's accuracy/i, 'accuracy'],
  [/user's evasi/i, 'evasion'],
];

export function predictNpcMove(
  ds: Dataset,
  foe: CalcPokemon,
  me: CalcPokemon,
  moveIds: string[],
  ctx: { field?: Field; myStatus?: string; myBoosts?: Boosts; foeBoosts?: Boosts; usedThisBattle?: string[]; firstMove?: boolean;
    /** Your best hit can KO it from its current HP. */ facingKo?: boolean;
    /** Its previous move (Destiny Bond fails twice in a row). */ lastMove?: string } = {},
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
      const raises = /raises the user's/i.test(d) ? RAISES_USER.find(([re]) => re.test(d)) : undefined;
      if (raises && (ctx.foeBoosts?.[raises[1]] ?? 0) >= 6) w = 0.05; // already maxed
      if (/protect|detect|endure/i.test(mv.name)) w = 0.6;
      // Seen by a friend: the NPC used Destiny Bond exactly when your next hit would KO it.
      if (id === 'destinybond') w = ctx.lastMove === 'destinybond' ? 0.05 : ctx.facingKo ? 6 : 0.1;
      if (/heal|restore|recover|rest\b/i.test(d) && myHp > 0) w = (100 * foe.curHP()) / foe.maxHP() < 50 ? 2 : 0.2;
      // Seen live 4 of 4 times: an NPC Pokémon's FIRST move on the field was a useful status move
      // (Brock: Geodude Defense Curl, Onix Screech; Lt. Surge: Voltorb Screech, Raichu Thunder Wave).
      else if (ctx.firstMove && w >= 1 && id !== 'destinybond') w *= 3;
      // Status moves on you were not repeated live (Onix: Screech once, then Rock Tomb ×3; Voltorb: Screech,
      // then Tackle). Self-boosts were: Raichu and Pikachu each used Double Team twice before attacking.
      w *= (raises ? 0.8 : 0.5) ** used.filter((u) => u === id).length;
    }
    // Attacks it already used hint at its habits (small nudge).
    if (mv.category !== 'Status') w += Math.min(2, 0.5 * used.filter((u) => u === id).length);
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

export interface NpcSwitchGuess {
  to: string;
  reason: string;
}

/**
 * Might the NPC switch out? Seen once live (Juan pulled Whiscash, 4× weak to Grass, when
 * Toedscruel came in), so this is a labelled guess and never changes scores. Flags a switch only
 * when the NPC's active Pokémon is in a bad spot (you can KO it, it can't KO you) AND a healthy
 * teammate takes your best hit much better.
 */
export function guessNpcSwitch(
  ds: Dataset,
  foe: CalcPokemon,
  me: CalcPokemon,
  myMoves: string[],
  foeMoves: string[],
  bench: { name: string; calc: CalcPokemon }[],
  field?: Field,
): NpcSwitchGuess | undefined {
  const best = (atk: CalcPokemon, def: CalcPokemon, ids: string[]) => {
    let top: ReturnType<typeof moveDamage> = null;
    for (const id of ids) {
      const d = moveDamage(ds, atk, def, id, field);
      if (d && (!top || d.maxPct > top.maxPct)) top = d;
    }
    return top;
  };
  const pct = (p: CalcPokemon) => (100 * p.curHP()) / p.maxHP();
  const mine = best(me, foe, myMoves);
  if (!mine || mine.maxPct < pct(foe)) return undefined; // you can't KO it: no reason to run
  const theirs = best(foe, me, foeMoves);
  if (theirs && theirs.maxPct >= pct(me)) return undefined; // it can KO you: it stays and attacks
  let pick: { name: string; taken: number; by: string } | undefined;
  for (const b of bench) {
    if (b.calc.curHP() <= 0) continue;
    const hit = best(me, b.calc, myMoves);
    const taken = hit ? hit.maxPct : 0;
    if (taken < 45 && (!pick || taken < pick.taken)) pick = { name: b.name, taken, by: hit?.name ?? 'your moves' };
  }
  if (!pick) return undefined;
  return { to: pick.name, reason: `${foe.name} can't win this 1v1; ${pick.name} takes at most ~${Math.round(pick.taken)}% from ${pick.by}.` };
}
