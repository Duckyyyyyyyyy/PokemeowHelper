import type { RosterMon } from './battle';
import type { WildSnapshot } from './wild';

/**
 * Small pure helpers on the Explore team, shared by the content script (HP carry-over between
 * reads) and the Defeat engine (who is active). No engine imports, so content.js stays small.
 */

const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Index of `lead` in the team: same species, then same level, then same gender. When no name is
 * equal (the card's name text carried extra words), the longest team name contained in it wins.
 * -1 when nothing matches.
 */
export function leadIndex(party: RosterMon[], lead: { name: string; level?: number; gender?: 'M' | 'F' }): number {
  const k = key(lead.name);
  if (!k) return -1;
  let same = party.map((r, i) => ({ r, i })).filter(({ r }) => key(r.name) === k);
  if (!same.length) {
    const inside = party.map((r, i) => ({ r, i })).filter(({ r }) => key(r.name).length >= 3 && k.includes(key(r.name)));
    const longest = Math.max(0, ...inside.map(({ r }) => key(r.name).length));
    same = inside.filter(({ r }) => key(r.name).length === longest);
  }
  if (!same.length) return -1;
  const score = ({ r }: { r: RosterMon }) => (lead.level !== undefined && r.level === lead.level ? 2 : 0) + (lead.gender && r.gender === lead.gender ? 1 : 0);
  return same.sort((x, y) => score(y) - score(x) || x.i - y.i)[0].i;
}

const encounterKey = (w: WildSnapshot) => [w.map, w.name, w.level, w.gender, w.maxHp].join('|');

/**
 * The Explore team panel shows no HP, and the battle card shows only the Pokémon in front. So after
 * a switch the one that went back would lose its HP. This keeps, within one wild battle, the last
 * HP seen for each team member (by slot): the lead card's HP is written onto its team entry, and
 * entries without HP take the previous read's value. Starts fresh on a new encounter or intro view.
 */
export function carryTeamHp(prev: WildSnapshot | null | undefined, next: WildSnapshot | null): WildSnapshot | null {
  if (!next?.party?.length) return next;
  const lead = next.lead;
  const li = lead ? leadIndex(next.party, lead) : -1;
  const sameBattle = !!prev?.party?.length && next.view !== 'intro' && encounterKey(prev) === encounterKey(next);
  const party = next.party.map((r, i) => {
    if (i === li && lead?.hp !== undefined) return { ...r, hp: lead.hp, maxHp: lead.maxHp ?? r.maxHp, fainted: r.fainted || lead.hp === 0 };
    if (r.hp !== undefined || !sameBattle) return r;
    const old = prev!.party!.find((p) => (p.slot !== undefined && p.slot === r.slot) || (p.slot === undefined && key(p.name) === key(r.name) && p.level === r.level));
    if (!old || old.hp === undefined || key(old.name) !== key(r.name)) return r;
    return { ...r, hp: old.hp, maxHp: old.maxHp, fainted: r.fainted || old.hp === 0 };
  });
  return { ...next, party };
}
