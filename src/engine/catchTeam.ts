import type { RosterMon } from '../shared/battle';
import type { BoxMon, Dataset } from '../shared/types';
import type { WildSnapshot } from '../shared/wild';
import { planCatch, planCatchFor, STATUS_LABEL, type CatchPlan, type PlanMon, type PlanOptions } from './catchPlan';
import { indexes, mySet } from './turnAdvisor';
import { moveNamesFor, wildParty } from './wildDefeat';

/**
 * Catch plan for the Pokémon you actually carry. Mid-encounter only the team can act, so the
 * Weaken and Status steps come from it (active first); the box picks stay as a "swap in before
 * exploring" list. Team source is the same as Defeat mode: battle card → switch cards → Explore
 * team panel (with the starter) → the encounter card's lead.
 */

export interface TeamCatchPlan {
  /** 'team' when the team was read; 'box' when it was not and the box plan is the main one. */
  source: 'team' | 'box';
  /** Healthy team members, active first. */
  members: RosterMon[];
  /** Plan option uid → team member, for HP and the "active" tag. */
  memberOf: Record<string, RosterMon>;
  team: CatchPlan;
  box: CatchPlan;
  /** Plain-words line when the team has no safe hit, or when only a benched member has one. */
  weakenHint?: string;
  statusHint?: string;
  notes: string[];
}

const down = (r: RosterMon) => r.fainted || r.hp === 0;
const pctText = (x: number) => `${Math.round(x)}`;

/** A team member's moves (ids): the battle's buttons when it is active, its switch card, your box, else a guess. */
function teamMon(ds: Dataset, box: BoxMon[], w: WildSnapshot, r: RosterMon, i: number): PlanMon | null {
  const idx = indexes(ds);
  const toIds = (names: string[]) => names.map((n) => idx.moves.get(n.toLowerCase())?.id).filter((x): x is string => !!x);
  const me = mySet(idx, box, r, []);
  if (!me) return null;
  let ids: string[] = [];
  let guessed = false;
  if (r.active && w.moves?.length) ids = toIds(w.moves.filter((m) => !m.disabled).map((m) => m.name));
  else if (r.moves?.length) ids = toIds(r.moves.filter((m) => m.pp === undefined || m.pp > 0).map((m) => m.name));
  else if (me.known && me.mon.moves.length) ids = me.mon.moves;
  if (!ids.length) {
    // Not in your box (or no move list): its 4 latest level-up moves at its level, as the game teaches them.
    const lv = r.level ?? me.mon.level ?? 100;
    ids = [...new Set((ds.species[me.mon.species]?.levelMoves ?? []).filter(([, l]) => l <= lv).map(([id]) => id))].slice(-4);
    guessed = true;
  }
  return { b: { ...me.mon, uid: `team:${i}`, level: r.level ?? me.mon.level, moves: ids }, guessed, rank: r.active ? 0 : 1 };
}

export function teamCatchPlan(ds: Dataset, box: BoxMon[], w: WildSnapshot | null, wild: { species: number; level: number }, opts: PlanOptions = {}): TeamCatchPlan {
  const boxPlan = planCatch(ds, box, wild, opts);
  const empty: CatchPlan = { weaken: [], status: [], risky: [], notes: [] };
  const party = w ? wildParty(w, (r) => moveNamesFor(ds, box, w, { ...r, active: false })) : [];
  const members = party.filter((r) => !down(r));
  if (!w || !party.length) {
    return { source: 'box', members: [], memberOf: {}, team: empty, box: boxPlan, notes: ["Your team isn't readable here (no live encounter card), so these picks come from your whole box."] };
  }
  const memberOf: Record<string, RosterMon> = {};
  const mons: PlanMon[] = [];
  members.forEach((r, i) => {
    const m = teamMon(ds, box, w, r, i);
    if (!m) return;
    mons.push(m);
    memberOf[m.b.uid] = r;
  });
  const team = planCatchFor(ds, mons, wild, { ...opts, keepOrder: true });
  const notes: string[] = [];
  if (party.length > members.length) notes.push(`Fainted, left out: ${party.filter(down).map((r) => r.name).join(', ')}.`);
  if (!w.party?.length) notes.push('Only your lead is known: the team panel was not read.');
  if (mons.some((m) => m.guessed)) notes.push('"guessed": not found in your box, so its moves are its latest level-up moves.');

  const active = members.find((r) => r.active);
  const isActive = (uid: string) => !!active && memberOf[uid] === active;
  let weakenHint: string | undefined;
  if (!team.weaken.length) {
    const r = team.risky[0];
    weakenHint = r
      ? `No safe hit on your team. Gentlest: ${r.monName} ${r.moveName} ${pctText(r.minPct)}–${pctText(r.maxPct)}% (${Math.round(r.koChance * 100)}% chance to KO it).`
      : 'No one on your team can hit it.';
  } else if (active && !team.weaken.some((o) => isActive(o.uid))) {
    weakenHint = `${active.name} has no safe hit: switch to ${team.weaken[0].monName} (${team.weaken[0].moveName}).`;
  }
  let statusHint: string | undefined;
  if (!team.status.length) statusHint = 'No one on your team can put a status on it.';
  else if (active && !team.status.some((o) => isActive(o.uid))) {
    const o = team.status[0];
    statusHint = `${active.name} has no status move for it: switch to ${o.monName} (${o.moveName}, ${STATUS_LABEL[o.status].toLowerCase()}).`;
  }
  return { source: 'team', members, memberOf, team, box: boxPlan, weakenHint, statusHint, notes };
}
