import type { BoxMon, Dataset } from '../shared/types';
import { boxToCalc, moveDamage, npcToCalc, SELF_KO_MOVES } from './damage';
import { effectiveness } from './typeChart';
import { statusBonus } from './catching';

/**
 * Catch plan: which of your Pokémon/moves bring a wild Pokémon low WITHOUT a KO,
 * and which can put it to sleep / paralyze / burn / poison.
 *
 * Wild IVs/nature are unknown, so hits are sized against the WEAKEST possible
 * copy (IV 0, neutral nature): if the max roll can't KO that one, it can't KO any.
 */

export const FALSE_SWIPE_MOVES: ReadonlySet<string> = new Set(['falseswipe', 'holdback']);

type Status = 'slp' | 'par' | 'brn' | 'psn' | 'tox';

interface StatusMoveInfo {
  status: Status;
  /** Blocked by the Grass type (powder/spore). */
  powder?: boolean;
  /** Uses type immunity of its own type (Thunder Wave vs Ground). */
  typeImmune?: boolean;
  /** Also deals damage (Nuzzle). */
  damaging?: boolean;
  note?: string;
}

/** Reliable status moves (secondary-effect chances are not counted). */
export const STATUS_MOVES: Record<string, StatusMoveInfo> = {
  spore: { status: 'slp', powder: true },
  sleeppowder: { status: 'slp', powder: true },
  hypnosis: { status: 'slp' },
  sing: { status: 'slp' },
  lovelykiss: { status: 'slp' },
  grasswhistle: { status: 'slp' },
  darkvoid: { status: 'slp' },
  yawn: { status: 'slp', note: 'falls asleep at the end of the next turn' },
  thunderwave: { status: 'par', typeImmune: true },
  stunspore: { status: 'par', powder: true },
  glare: { status: 'par' },
  nuzzle: { status: 'par', typeImmune: true, damaging: true },
  willowisp: { status: 'brn' },
  poisonpowder: { status: 'psn', powder: true },
  poisongas: { status: 'psn' },
  toxic: { status: 'tox' },
  toxicthread: { status: 'psn' },
};

/** Abilities that stop a status outright. */
export const BLOCKING_ABILITIES: Record<Status, string[]> = {
  slp: ['Insomnia', 'Vital Spirit', 'Sweet Veil', 'Comatose', 'Purifying Salt'],
  par: ['Limber', 'Comatose', 'Purifying Salt'],
  brn: ['Water Veil', 'Water Bubble', 'Thermal Exchange', 'Comatose', 'Purifying Salt'],
  psn: ['Immunity', 'Pastel Veil', 'Comatose', 'Purifying Salt'],
  tox: ['Immunity', 'Pastel Veil', 'Comatose', 'Purifying Salt'],
};

/** Order of preference: sleep (×2.5, stops fleeing) > paralysis > burn/poison (chip damage can KO). */
const STATUS_RANK: Record<Status, number> = { slp: 0, par: 1, brn: 2, psn: 2, tox: 3 };
export const STATUS_LABEL: Record<Status, string> = { slp: 'Sleep', par: 'Paralysis', brn: 'Burn', psn: 'Poison', tox: 'Bad poison' };

/** Why a status cannot land on these types, or undefined. */
export function statusImmunity(ds: Dataset, moveId: string, targetTypes: string[]): string | undefined {
  const info = STATUS_MOVES[moveId];
  const mv = ds.moves[moveId];
  if (!info || !mv) return 'unknown move';
  if (info.powder && targetTypes.includes('Grass')) return 'Grass types ignore powder moves';
  if (info.typeImmune && effectiveness(ds.types, mv.type, targetTypes) === 0) return `${targetTypes.join('/')} is immune to ${mv.type} moves`;
  if (info.status === 'par' && targetTypes.includes('Electric')) return 'Electric types cannot be paralyzed';
  if (info.status === 'brn' && targetTypes.includes('Fire')) return 'Fire types cannot be burned';
  if ((info.status === 'psn' || info.status === 'tox') && (targetTypes.includes('Poison') || targetTypes.includes('Steel'))) return 'Poison/Steel types cannot be poisoned';
  return undefined;
}

export interface WeakenOption {
  uid: string;
  monName: string;
  level?: number;
  moveId: string;
  moveName: string;
  /** False Swipe / Hold Back: never KOs. */
  safe: boolean;
  /** Damage range vs the weakest possible copy (worst nature/ability), % of its max HP. */
  minPct: number;
  maxPct: number;
  /** Even a critical hit (×1.5) leaves it standing. */
  critSafe: boolean;
  /** Move is a guess from level-up moves (box has no move list). */
  guessed: boolean;
}

/** A hit that may KO it at its current HP: the "next best" when nothing is safe. */
export interface RiskyHit extends WeakenOption {
  /** Chance one hit KOs it (rolls spread evenly over min–max; crits not counted), 0–1. */
  koChance: number;
}

export interface StatusOption {
  uid: string;
  monName: string;
  moveId: string;
  moveName: string;
  status: Status;
  accuracy: number;
  bonus: number;
  /** Some of its possible abilities block it. */
  mayFail?: string;
  note?: string;
  guessed: boolean;
}

export interface CatchPlan {
  weaken: WeakenOption[];
  status: StatusOption[];
  /** Hits dropped because they could KO, gentlest first. */
  risky: RiskyHit[];
  /** Targets types / abilities that matter. */
  notes: string[];
}

function knownMoves(ds: Dataset, b: BoxMon): { ids: string[]; guessed: boolean } {
  if (b.moves.length) return { ids: b.moves.filter((id) => ds.moves[id]), guessed: false };
  const lv = b.level ?? 100;
  const ids = (ds.species[b.species]?.levelMoves ?? []).filter(([, l]) => l <= lv).map(([id]) => id);
  return { ids: [...new Set(ids)], guessed: true };
}

const ZERO_IVS = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };

/**
 * Weakest possible copies of the wild Pokémon: IV 0, the nature that lowers the hit
 * defence (Lonely −Def / Naughty −SpD), and every ability it may have (max damage wins).
 */
function weakestFoes(ds: Dataset, speciesId: number, level: number) {
  const s = ds.species[speciesId];
  const abilities: (string | undefined)[] = s.abilities.length ? s.abilities.map((a) => a.name) : [undefined];
  const make = (nature: string) => abilities.map((ability) => npcToCalc(ds, { species: s.id, name: s.name, level, moves: [], baseStats: s.baseStats, ivs: ZERO_IVS, nature, ability }));
  return { Physical: make('Lonely'), Special: make('Naughty') };
}

export interface PlanOptions {
  /** Its current HP, % of max (default 100). Hits whose max roll reaches it are dropped. */
  hpPct?: number;
  limit?: number;
  /** Rank Pokémon by their `rank` (team: active first) before ranking moves. */
  keepOrder?: boolean;
}

/** One Pokémon to plan with: its moves (ids) and whether they are a guess. */
export interface PlanMon {
  b: BoxMon;
  guessed: boolean;
  /** With `keepOrder`: lower comes first (team: 0 for the active Pokémon, 1 for the rest). */
  rank?: number;
}

export function planCatch(ds: Dataset, box: BoxMon[], wild: { species: number; level: number }, opts: PlanOptions = {}): CatchPlan {
  return planCatchFor(ds, box.map((b) => {
    const { ids, guessed } = knownMoves(ds, b);
    return { b: { ...b, moves: ids }, guessed };
  }), wild, opts);
}

/**
 * The plan for a given set of Pokémon (your box, or the team you carry). Options keep the
 * order of `mons` as a tie-break, so a team listed active-first stays active-first.
 */
export function planCatchFor(ds: Dataset, mons: PlanMon[], wild: { species: number; level: number }, opts: PlanOptions = {}): CatchPlan {
  const s = ds.species[wild.species];
  const notes: string[] = [];
  if (!s) return { weaken: [], status: [], risky: [], notes: ['Unknown species.'] };
  const hpPct = Math.min(100, Math.max(1, opts.hpPct ?? 100));
  const limit = opts.limit ?? 8;
  const foes = weakestFoes(ds, s.id, wild.level);
  const foeAbilities = s.abilities.map((a) => a.name);
  if (s.types.includes('Ghost')) notes.push('Ghost type: False Swipe and Hold Back do nothing to it.');

  const weaken: WeakenOption[] = [];
  const status: StatusOption[] = [];
  const risky: RiskyHit[] = [];
  for (const { b, guessed } of mons) {
    const monName = ds.species[b.species]?.name ?? '?';
    const ids = b.moves.filter((id) => ds.moves[id]);
    if (!ids.length) continue;
    let me;
    try {
      me = boxToCalc(ds, b, b.level ?? 50);
    } catch {
      continue;
    }
    for (const id of ids) {
      const mv = ds.moves[id];
      if (!mv) continue;
      const st = STATUS_MOVES[id];
      if (st && !statusImmunity(ds, id, s.types)) {
        const blockers = foeAbilities.filter((a) => BLOCKING_ABILITIES[st.status].includes(a));
        status.push({
          uid: b.uid, monName, moveId: id, moveName: mv.name, status: st.status,
          accuracy: mv.accuracy === true ? 100 : mv.accuracy,
          bonus: statusBonus(st.status),
          mayFail: blockers.length ? `fails if its ability is ${blockers.join(' or ')}` : undefined,
          note: st.note, guessed,
        });
      }
      if (mv.category === 'Status' || SELF_KO_MOVES.has(id)) continue;
      let d: ReturnType<typeof moveDamage> = null;
      for (const foe of foes[mv.category]) {
        const x = moveDamage(ds, me, foe, id);
        if (x && (!d || x.hi > d.hi || (x.hi === d.hi && x.maxPct > d.maxPct))) d = x;
      }
      if (!d || d.hi <= 0) continue;
      const safe = FALSE_SWIPE_MOVES.has(id);
      const opt = {
        uid: b.uid, monName, level: b.level, moveId: id, moveName: d.name, safe,
        minPct: d.minPct, maxPct: d.maxPct,
        critSafe: safe || d.maxPct * 1.5 < hpPct, guessed,
      };
      if (!safe && d.maxPct >= hpPct) {
        // Could KO at its current HP: kept aside as a last resort.
        const koChance = d.minPct >= hpPct ? 1 : (d.maxPct - hpPct) / Math.max(0.01, d.maxPct - d.minPct);
        risky.push({ ...opt, critSafe: false, koChance: Math.min(1, Math.max(0, koChance)) });
        continue;
      }
      weaken.push(opt);
    }
  }
  const order = new Map(mons.map((m) => [m.b.uid, m.rank ?? 0]));
  const byMon = (a: { uid: string }, b: { uid: string }) => (opts.keepOrder ? (order.get(a.uid) ?? 0) - (order.get(b.uid) ?? 0) : 0);
  weaken.sort((a, b) => byMon(a, b) || Number(b.safe) - Number(a.safe) || Number(a.guessed) - Number(b.guessed) || Number(b.critSafe) - Number(a.critSafe) || b.minPct - a.minPct);
  status.sort((a, b) => byMon(a, b) || STATUS_RANK[a.status] - STATUS_RANK[b.status] || b.accuracy - a.accuracy || Number(a.guessed) - Number(b.guessed));
  risky.sort((a, b) => a.koChance - b.koChance || a.maxPct - b.maxPct);
  if (status.some((o) => o.status !== 'slp' && o.status !== 'par')) notes.push('Burn and poison hurt it every turn: at low HP that chip damage can make it faint.');
  return { weaken: dedupe(weaken).slice(0, limit), status: dedupe(status).slice(0, limit), risky: dedupe(risky).slice(0, limit), notes };
}

/** One line per (Pokémon, move). */
function dedupe<T extends { uid: string; moveId: string }>(list: T[]): T[] {
  const seen = new Set<string>();
  return list.filter((o) => {
    const k = `${o.uid}|${o.moveId}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export interface AfterPlan {
  /** HP left after the weaken step (0–1). */
  hpFrac: number;
  status?: string;
  /** "weaken + sleep", "False Swipe", … ; empty when the plan changes nothing. */
  label: string;
}

/**
 * Where the plan leaves the wild Pokémon, for the "43% now → 100% after weaken + sleep" line:
 * False Swipe/Hold Back → 1 HP (~1%); otherwise one hit of the best sized move (its MIN roll,
 * so the line never promises more than the hit surely does); then the top status move.
 */
export function afterPlan(plan: CatchPlan, now: { hpPct: number; status?: string }): AfterPlan {
  const parts: string[] = [];
  let hp = now.hpPct / 100;
  const swipe = plan.weaken.find((w) => w.safe);
  const hit = plan.weaken.find((w) => !w.safe && !w.guessed) ?? plan.weaken.find((w) => !w.safe);
  if (swipe) {
    hp = 0.01;
    parts.push(swipe.moveName);
  } else if (hit && hit.minPct > 0) {
    hp = Math.max(0.01, (now.hpPct - hit.minPct) / 100);
    parts.push('weaken');
  }
  let status = now.status || undefined;
  const st = plan.status[0];
  if (!status && st) {
    status = st.status;
    parts.push(STATUS_LABEL[st.status].toLowerCase());
  }
  return { hpFrac: hp, status, label: parts.join(' + ') };
}
