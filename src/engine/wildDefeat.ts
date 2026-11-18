import type { BattleMon, BattleSnapshot, RosterMon } from '../shared/battle';
import type { BoxMon, Dataset, NpcMon } from '../shared/types';
import type { WildSnapshot } from '../shared/wild';
import { adviseTurn, indexes, mySet, type ActionAdvice, type ThreatInfo } from './turnAdvisor';
import { movesForBox } from './teamSuggest';
import { effectiveness, formatMult } from './typeChart';

/**
 * "Defeat it" mode of the Explore tab: the Battle tab's engine (adviseTurn) run against the wild
 * Pokémon of the Explore card. No new damage code: this only builds the BattleSnapshot it expects.
 * The wild Pokémon has no wiki set, so adviseTurn guesses its moves from its level-up learnset
 * at its level (foeSet), and there is no trainer name, so no NPC is matched.
 */

/** Your side as known from the card: the battle's switch cards or the team panel, else just the lead. */
export function wildParty(w: WildSnapshot): RosterMon[] {
  if (w.party?.length) {
    let party = w.party;
    // Battle switch cards say who is active. The Explore team panel does not: the lead on the
    // encounter card does (matched by species, then level, then gender); else slot 1.
    if (!party.some((r) => r.active)) {
      const i = w.lead ? leadIndex(party, w.lead) : -1;
      const at = i >= 0 ? i : 0;
      const lead = w.lead && i >= 0 ? w.lead : undefined;
      party = party.map((r, j) => (j === at ? {
        ...r, active: true,
        // The card shows the lead's HP; the panel does not.
        hp: r.hp ?? lead?.hp, maxHp: r.maxHp ?? lead?.maxHp,
        fainted: r.fainted || lead?.hp === 0,
      } : r));
    }
    const active = party.filter((r) => r.active);
    return [...active, ...party.filter((r) => !r.active)];
  }
  if (w.lead) return [{ name: w.lead.name, level: w.lead.level, hp: w.lead.hp, maxHp: w.lead.maxHp, active: true, fainted: w.lead.hp === 0 }];
  return [];
}

/** Index of the encounter card's lead in the team panel: same species, then same level, then same gender. */
export function leadIndex(party: RosterMon[], lead: { name: string; level?: number; gender?: 'M' | 'F' }): number {
  const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const same = party.map((r, i) => ({ r, i })).filter(({ r }) => key(r.name) === key(lead.name));
  if (!same.length) return -1;
  const score = ({ r }: { r: RosterMon }) => (lead.level !== undefined && r.level === lead.level ? 2 : 0) + (lead.gender && r.gender === lead.gender ? 1 : 0);
  return same.sort((x, y) => score(y) - score(x) || x.i - y.i)[0].i;
}

/** The wild Pokémon as the battle screen would show it. HP-bar-only reads become a 0–100 scale. */
export function wildOpponent(w: WildSnapshot): BattleMon {
  const hp = w.hp !== undefined && w.maxHp ? { hp: w.hp, maxHp: w.maxHp } : w.hpPct !== undefined ? { hp: Math.round(w.hpPct), maxHp: 100 } : {};
  return { name: w.name, level: w.level, ...hp, status: w.status, item: w.item };
}

const isDown = (r: RosterMon) => r.fainted || (r.hp !== undefined && r.hp <= 0);

/** Move names for one of your Pokémon: the battle's buttons for the active one, its switch-card moves, else your box. */
function moveNamesFor(ds: Dataset, box: BoxMon[], w: WildSnapshot, r: RosterMon): string[] {
  if (r.active && w.moves?.length) return w.moves.filter((m) => !m.disabled).map((m) => m.name);
  if (r.moves?.length) return r.moves.filter((m) => m.pp === undefined || m.pp > 0).map((m) => m.name);
  const me = mySet(indexes(ds), box, r, []);
  if (!me) return [];
  // Not in your box: guess its 4 latest damaging level-up moves (same rule as unknown NPC sets).
  const ids = me.known ? movesForBox(ds, me.mon) : movesForBox(ds, { ...me.mon, moves: [] }).slice(-4);
  return [...new Set(ids)].map((id) => ds.moves[id]?.name).filter((n): n is string => !!n).slice(0, 8);
}

/** A singles BattleSnapshot with `r` in front of the wild Pokémon (no trainer name → never an NPC match). */
export function wildBattleSnapshot(ds: Dataset, box: BoxMon[], w: WildSnapshot, r: RosterMon): BattleSnapshot {
  return {
    v: 2,
    at: w.at,
    status: 'active',
    kind: 'wild',
    format: 'singles',
    player: { name: r.name, level: r.level, hp: r.hp, maxHp: r.maxHp },
    opponent: wildOpponent(w),
    moves: moveNamesFor(ds, box, w, r).map((name) => ({ name, disabled: false })),
    bench: [],
    opponentTeam: [],
    boosts: { player: {}, opponent: {} },
    log: [],
    events: [],
  };
}

export interface DefeatMove extends ActionAdvice {
  /** Type effectiveness against the wild Pokémon, e.g. "×2". */
  eff?: string;
}

export interface DefeatOption {
  member: RosterMon;
  moves: DefeatMove[];
  /** The wild Pokémon's best hit on this member. */
  threat?: ThreatInfo;
  /** Moves were guessed (member not found in your box). */
  guessed: boolean;
}

export interface DefeatPlan {
  /** The wild Pokémon with its guessed moves (latest level-up damaging moves at its level). */
  foe?: NpcMon;
  options: DefeatOption[];
  notes: string[];
}

/** Ranks each healthy party member's moves vs the wild Pokémon at its live HP; fainted ones are skipped. */
export function defeatPlan(ds: Dataset, box: BoxMon[], w: WildSnapshot, maxMoves = 3): DefeatPlan {
  const notes: string[] = [];
  const party = wildParty(w).filter((r) => !isDown(r));
  if (!party.length) return { options: [], notes: ['No healthy Pokémon on your team.'] };
  let foe: NpcMon | undefined;
  const options: DefeatOption[] = [];
  for (const r of party) {
    const snap = wildBattleSnapshot(ds, box, w, r);
    const advice = adviseTurn(ds, snap, box);
    foe ??= advice.foe?.mon;
    const foeTypes = foe ? ds.species[foe.species]?.types ?? [] : [];
    const moves: DefeatMove[] = advice.actions
      .filter((a) => a.kind === 'move' && a.score !== null)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, maxMoves)
      .map((a) => {
        const mv = a.moveId ? ds.moves[a.moveId] : undefined;
        return { ...a, eff: mv && foeTypes.length ? formatMult(effectiveness(ds.types, mv.type, foeTypes)) : undefined };
      });
    options.push({ member: r, moves, threat: advice.threat, guessed: !advice.me?.known });
  }
  if (foe) notes.push(`${foe.name}'s moves are a guess: its latest level-up attacks at Lv ${foe.level} (${foe.moves.map((id) => ds.moves[id]?.name ?? id).join(', ') || 'none'}).`);
  if (!w.party?.length) notes.push('Only your lead is known here: the team panel was not read.');
  return { foe, options, notes };
}
