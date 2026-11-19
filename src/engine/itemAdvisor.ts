import type { Pokemon as CalcPokemon } from '@smogon/calc';
import type { BattleSnapshot, Boosts } from '../shared/battle';
import type { BoxMon, Dataset } from '../shared/types';
import { bestMove, boxToCalc, defenderVsNpc, makeField, repeatable, type MoveDamage } from './damage';
import { order, project } from './projection';
import type { BattleRules } from './rules';
import { movesForBox } from './teamSuggest';
import type { ActionAdvice } from './turnAdvisor';

/**
 * In-battle item advice (healing, status cures, Revives, PP restore). Kept out of turnAdvisor.ts, which
 * only calls resolveItems() + itemAdvice(). HP amounts are from the wiki (Balls, Medicine and PP Recovery):
 * Potion 20, Super 60, Hyper 120, Moomoo Milk 100, Oran 10, Sitrus 1/4. Each item "uses one turn": the NPC gets
 * a free hit first. A Berry used from the Bag is spent for good (a HELD Berry comes back after the battle),
 * so potions come first and berries are the fallback.
 */

const lc = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const curPct = (p: CalcPokemon) => (100 * p.curHP()) / p.maxHP();
const avg = (d: MoveDamage | null) => (d ? (d.minPct + d.maxPct) / 2 : 0);

const ALL_STATUS = ['par', 'brn', 'psn', 'tox', 'slp', 'frz'];
/** [id, name, HP restored given max HP]. Berries are marked in BERRIES. */
const HEAL_ITEMS: [id: string, name: string, hp: (maxHp: number) => number][] = [
  ['oranberry', 'Oran Berry', () => 10], ['potion', 'Potion', () => 20], ['superpotion', 'Super Potion', () => 60], ['moomoomilk', 'Moomoo Milk', () => 100],
  ['sitrusberry', 'Sitrus Berry', (m) => Math.floor(m / 4)], ['hyperpotion', 'Hyper Potion', () => 120],
  ['maxpotion', 'Max Potion', () => Infinity], ['fullrestore', 'Full Restore', () => Infinity],
];
/** Cures, best choice first: exact-status medicine, Full Heal, single-status berries, then Lum (any status, so keep it), Full Restore last. */
const CURE_ITEMS: [id: string, name: string, cures: string[]][] = [
  ['paralyzeheal', 'Paralyze Heal', ['par']], ['burnheal', 'Burn Heal', ['brn']], ['antidote', 'Antidote', ['psn', 'tox']],
  ['awakening', 'Awakening', ['slp']], ['iceheal', 'Ice Heal', ['frz']], ['fullheal', 'Full Heal', ALL_STATUS],
  ['cheriberry', 'Cheri Berry', ['par']], ['chestoberry', 'Chesto Berry', ['slp']], ['pechaberry', 'Pecha Berry', ['psn', 'tox']],
  ['rawstberry', 'Rawst Berry', ['brn']], ['aspearberry', 'Aspear Berry', ['frz']], ['lumberry', 'Lum Berry', ALL_STATUS],
  ['fullrestore', 'Full Restore', ALL_STATUS],
];
const REVIVE_ITEMS: [id: string, name: string, frac: number][] = [['revive', 'Revive', 0.5], ['maxrevive', 'Max Revive', 1]];
const isBerry = (id: string) => id.endsWith('berry');

export interface ItemSupply {
  counts: Map<string, number>;
  /** Items the battle screen marks as unusable right now. */
  locked: Set<string>;
  source: 'battle' | 'bag' | 'mixed';
}

/** Medicine from the Bag cannot be used in Player Battles, and (rules.bagItems) in Battle Towers. */
export function itemsAllowed(snap: BattleSnapshot, rules: BattleRules): boolean {
  return rules.bagItems && !/player|pvp/i.test(snap.kind ?? '');
}

/** Battle-screen counts win over the last Bag read; items the battle screen does not list keep the Bag count. */
export function resolveItems(snap: BattleSnapshot, bag?: ReadonlyMap<string, number>): ItemSupply {
  const counts = new Map(bag ?? []);
  const locked = new Set<string>();
  for (const b of snap.bag ?? []) {
    counts.set(b.id, b.count);
    if (b.locked) locked.add(b.id);
  }
  const battle = !!snap.bag?.length;
  return { counts, locked, source: battle ? (bag?.size ? 'mixed' : 'battle') : 'bag' };
}

export interface ItemContext {
  ds: Dataset;
  snap: BattleSnapshot;
  rules: BattleRules;
  supply: ItemSupply;
  box: BoxMon[];
  myMon: BoxMon;
  myCalc: CalcPokemon;
  foeCalc: CalcPokemon;
  /** Your usable (not disabled) damaging/legal move ids, and ALL four moves by name→id (PP-less ones included). */
  myMoveIds: string[];
  allMoveIds: { name: string; id: string; pp?: number; maxPp?: number }[];
  foeMoves: string[];
  /** The active foe plus the NPC Pokémon still to come. */
  foes: { name: string; calc: CalcPokemon }[];
  field: ReturnType<typeof makeField>;
  h: {
    applyState: (p: CalcPokemon, b: { hp?: number; maxHp?: number; status?: string }, boosts?: Boosts) => CalcPokemon;
    mySet: (b: { name: string; level?: number; item?: string }, moveNames: string[]) => { mon: BoxMon; known: boolean } | undefined;
  };
}

export function itemAdvice(c: ItemContext): ActionAdvice[] {
  const { ds, snap, rules, supply, myCalc, foeCalc, field } = c;
  const out: ActionAdvice[] = [];
  const heldBerry = lc(snap.player?.item ?? '');
  // Usable = owned, not locked by the battle screen, and not the berry your Pokémon already holds (that one triggers itself).
  const has = (id: string) => (supply.counts.get(id) ?? 0) > 0 && !supply.locked.has(id) && !(isBerry(id) && heldBerry === id);
  const left = (id: string) => `${supply.counts.get(id)} in ${supply.source === 'bag' ? 'bag' : 'battle bag'}`;
  const foeHp = curPct(foeCalc);
  const spent = (id: string) => (isBerry(id) ? ' A Berry used from the Bag is spent for good.' : '');

  /** Score of "use an item on your active Pokémon, take their hit, then fight" from the given state. */
  const afterItem = (me: CalcPokemon, hpPct: number, moves = c.myMoveIds) => {
    const incoming = bestMove(ds, foeCalc, defenderVsNpc(me, rules), c.foeMoves, field);
    const hpAfter = Math.min(100, hpPct) - avg(incoming);
    const mine = bestMove(ds, me, foeCalc, moves, field);
    if (hpAfter <= 0) return { score: 0, text: `but ${incoming?.name ?? 'their hit'} still KOs you` };
    if (!mine) return { score: 5, text: 'no damaging move after' };
    const p = project(mine.expectedPct, avg(incoming), hpAfter, foeHp, order(me, foeCalc, mine.priority, incoming?.priority ?? 0));
    return { score: Math.round(Math.max(0, Math.min(100, p.score - 8))), text: `takes ~${Math.round(avg(incoming))}%, then ${mine.name}: ${p.win ? 'wins' : 'loses'} the 1v1` };
  };

  // Heal: potions first (the smallest one that fills most of the missing HP); a Berry only when no potion is left
  // or the potions barely help and the berry restores clearly more. Only when HP is below 75%.
  const maxHp = myCalc.maxHP();
  const missing = maxHp - myCalc.curHP();
  if (curPct(myCalc) < 75 && missing > 0) {
    const pickFrom = (list: typeof HEAL_ITEMS) => {
      const owned = list.filter(([id]) => has(id)).sort((a, b) => Math.min(a[2](maxHp), missing) - Math.min(b[2](maxHp), missing));
      return owned.find(([, , hp]) => hp(maxHp) >= missing * 0.8) ?? owned[owned.length - 1];
    };
    const potion = pickFrom(HEAL_ITEMS.filter(([id]) => !isBerry(id)));
    const berry = pickFrom(HEAL_ITEMS.filter(([id]) => isBerry(id)));
    const amount = (p?: (typeof HEAL_ITEMS)[number]) => (p ? Math.min(p[2](maxHp), missing) : 0);
    const useBerry = !!berry && (!potion || (amount(potion) < missing * 0.5 && amount(berry) >= amount(potion) * 1.5));
    const pick = useBerry ? berry : potion;
    if (pick) {
      const [id, name] = pick;
      const healed = amount(pick);
      const r = afterItem(myCalc, (100 * (myCalc.curHP() + healed)) / maxHp);
      const why = useBerry ? (potion ? ' It heals clearly more than your potions here.' : ' No potion left.') : '';
      out.push({ kind: 'item', label: `${name} on ${snap.player!.name}`, score: r.score, reason: `+${healed} HP (${left(id)}), ${r.text}.${why}${spent(id)}` });
    }
  }

  // Cure a status: exact medicine, Full Heal, single berries, then Lum.
  const st = snap.player!.status;
  if (st) {
    const cure = CURE_ITEMS.find(([id, , cures]) => has(id) && cures.includes(st));
    if (cure) {
      const [id, name] = cure;
      const cured = c.h.applyState(boxToCalc(ds, c.myMon), { ...snap.player!, status: undefined }, snap.boosts.player);
      const r = afterItem(cured, curPct(cured));
      const what = st === 'par' ? 'paralysis (half Speed, may not move)' : st === 'brn' ? 'the burn (half Attack, chip damage)' : st === 'slp' ? 'sleep' : st === 'frz' ? 'the freeze' : 'the poison';
      out.push({ kind: 'item', label: `${name} on ${snap.player!.name}`, score: r.score, reason: `Cures ${what} (${left(id)}), ${r.text}.${id === 'lumberry' ? ' Lum cures any status, so only use it when nothing cheaper is left.' : ''}${spent(id)}` });
    }
  }

  // Revive the fainted team member that would do best here (you still need a turn to switch it in).
  const rev = REVIVE_ITEMS.filter(([id]) => has(id));
  if (rev.length) {
    let best: ActionAdvice | null = null;
    for (const r of snap.bench) {
      // Not the active Pokémon: when it is down the advice is a forced switch, never a Revive on it.
      if (r.active || (!r.fainted && (r.hp ?? 1) > 0)) continue;
      const mine = c.h.mySet(r, (r.moves ?? []).map((m) => m.name));
      if (!mine) continue;
      const [id, name, frac] = rev[0];
      const p = boxToCalc(ds, mine.mon);
      p.originalCurHP = Math.max(1, Math.floor(p.maxHP() * frac));
      const mineBest = bestMove(ds, p, foeCalc, repeatable(movesForBox(ds, mine.mon).filter((m) => !rules.bannedMoves.has(m))), field);
      const incoming = bestMove(ds, foeCalc, defenderVsNpc(p, rules), c.foeMoves, field);
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

  const pp = ppAdvice(c, has, left, afterItem);
  if (pp) out.push(pp);
  return out;
}

/** Moves that are out of PP (or at 1–2) and are the best, or the only decent, answer to a Pokémon still on the field or to come. */
export function keyLowMoves(c: ItemContext): { name: string; id: string; pp: number; maxPp: number; vs: string[] }[] {
  const low = c.allMoveIds.filter((m) => m.pp !== undefined && m.maxPp && m.pp <= 2);
  const res: { name: string; id: string; pp: number; maxPp: number; vs: string[] }[] = [];
  for (const m of low) {
    const vs: string[] = [];
    for (const f of c.foes) {
      const hit = (ids: string[]) => bestMove(c.ds, c.myCalc, f.calc, ids, c.field);
      const withIt = hit(c.allMoveIds.map((x) => x.id));
      if (!withIt || withIt.moveId !== m.id) continue;
      const without = hit(c.allMoveIds.filter((x) => x.id !== m.id && (x.pp ?? 1) > 0).map((x) => x.id));
      // "Best or only": the next best move deals under 70% of its expected damage (or there is none).
      if (!without || without.expectedPct < withIt.expectedPct * 0.7) vs.push(f.name);
    }
    if (vs.length) res.push({ name: m.name, id: m.id, pp: m.pp!, maxPp: m.maxPp!, vs });
  }
  return res;
}

function ppAdvice(
  c: ItemContext, has: (id: string) => boolean, left: (id: string) => string,
  afterItem: (me: CalcPokemon, hpPct: number, moves?: string[]) => { score: number; text: string },
): ActionAdvice | undefined {
  const keys = keyLowMoves(c);
  if (!keys.length) return undefined;
  const maxPp = (k: { maxPp: number }) => k.maxPp;
  // Elixirs fix every move; Ethers one. Prefer the smaller item that does the job.
  const many = keys.length > 1;
  const owned = (ids: string[]) => ids.find(has);
  const single = keys.reduce((a, b) => (a.pp <= b.pp ? a : b));
  const id = many
    ? owned(['elixir', 'maxelixir', 'maxether', 'ether'])
    : maxPp(single) - single.pp <= 10 ? owned(['ether', 'maxether', 'elixir', 'maxelixir']) : owned(['maxether', 'ether', 'maxelixir', 'elixir']);
  if (!id) return undefined;
  const name = { ether: 'Ether', maxether: 'Max Ether', elixir: 'Elixir', maxelixir: 'Max Elixir' }[id]!;
  const target = id.endsWith('elixir') ? c.snap.player!.name : `${single.name} (${c.snap.player!.name})`;
  const usable = [...new Set([...c.myMoveIds, ...keys.map((k) => k.id)])];
  const r = afterItem(c.myCalc, curPct(c.myCalc), usable);
  const out0 = keys.filter((k) => k.pp === 0);
  // Out of PP: the item is how you get the move back. At 1–2 PP the move still works: rank it below attacking.
  const score = out0.length ? r.score : Math.max(0, Math.min(r.score, 40) - 15);
  const list = keys.map((k) => `${k.name} ${k.pp}/${k.maxPp} PP (best vs ${k.vs.slice(0, 2).join(', ')}${k.vs.length > 2 ? '…' : ''})`).join('; ');
  return {
    kind: 'item', label: `${name} on ${target}`, score,
    reason: `${list}. ${out0.length ? 'Out of PP: restoring it costs this turn,' : 'Still usable, so this can wait:'} ${r.text} (${left(id)}).`,
  };
}
