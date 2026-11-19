import type { BattleSnapshot } from '../shared/battle';
import type { BoxMon, NpcTeamVariant } from '../shared/types';
import type { PairResult } from './teamSuggest';

/**
 * Battle Towers (Whirl, Bell, Dark, Light), summarised from the wiki "Battle Towers" page and the
 * tower pages (#/challenges/battle-towers[/<id>], read 2026-11-19):
 *  - ONE continuous singles battle against the guardian's 20 level-100 Pokémon (fixed sets, listed
 *    in roster order; your switches can change the order you meet them). Not a random pool.
 *  - HP, status and PP carry through all 20, no automatic healing; Bag medicine (healing, revives,
 *    PP restore) is disabled; equipped held items still work. Bring 1–6 hatched Pokémon.
 *  - Ordinary (Gen 9) battle rules – unlike the Battle Frontier's own "Battle Tower" facility.
 *  - Exploring, starting another battle or changing the team abandons the attempt; disconnecting
 *    keeps it. Each clear: 2,000 Pokécoins, 10% Mint, 5% Wing/Stone, the tower TM (first time
 *    guaranteed, then 10%).
 */
export const TOWER_RULES_TEXT = 'One continuous battle against 20 level-100 Pokémon: HP, status and PP carry through all of them, Bag medicine is disabled, held items still work. Pick for bulk and sustain, not just the best 1v1.';

const RECOVERY_MOVES = new Set(['recover', 'roost', 'slackoff', 'softboiled', 'milkdrink', 'moonlight', 'morningsun', 'synthesis', 'wish', 'rest', 'shoreup', 'strengthsap', 'junglehealing', 'lifedew', 'healorder', 'lunarblessing']);
const DRAIN_MOVES = new Set(['drainpunch', 'gigadrain', 'hornleech', 'drainingkiss', 'leechlife', 'paraboliccharge', 'oblivionwing', 'leechseed', 'bitterblade']);
const SUSTAIN_ITEMS: Record<string, number> = { leftovers: 6, blacksludge: 6, shellbell: 4 };
const SUSTAIN_ABILITIES: Record<string, number> = { Regenerator: 4, 'Poison Heal': 5, 'Natural Cure': 2, 'Rain Dish': 2, 'Ice Body': 2 };

/** 0–15 points for healing over a long fight: recovery moves, drain moves, Leftovers, Regenerator… */
export function sustainBonus(mon: BoxMon): number {
  let b = 0;
  if (mon.moves.some((id) => RECOVERY_MOVES.has(id))) b += 7;
  else if (mon.moves.some((id) => DRAIN_MOVES.has(id))) b += 3;
  if (mon.item) b += SUSTAIN_ITEMS[mon.item] ?? 0;
  if (mon.ability) b += SUSTAIN_ABILITIES[mon.ability] ?? 0;
  return Math.min(15, b);
}

/**
 * Endurance score of one pair (used for Battle Tower team picks): HP you keep matters more than in a
 * single battle, since nothing heals you between the 20 opponents.
 */
export function enduranceScore(p: PairResult, sustain: number): number {
  const d = p.duel;
  if (!d) return p.score;
  const s = d.win ? 35 + 0.65 * d.hpLeftPct + sustain : 0.35 * (100 - d.hpLeftPct);
  return Math.round(Math.max(0, Math.min(100, s)));
}

export interface EnduranceRow {
  foe: string;
  /** Your member that handles it best (index in the team), or -1. */
  by: number;
  /** % of that member's HP it costs (100 = it falls). */
  cost: number;
  win: boolean;
}

export interface Endurance {
  rows: EnduranceRow[];
  /** HP% each team member is expected to spend, total over the run. */
  spent: number[];
  /** Sum of max HP% of the team (100 per member). */
  budget: number;
  /** Total HP% spent. */
  total: number;
  /** Opponents nobody on the team beats 1v1. */
  losses: number;
}

/**
 * Rough "can this team last 20 fights" check: every opponent is taken by the member with the best
 * 1v1, at the HP cost the duel projects. Ignores sustain healing, switching damage and status, so
 * it is a pessimistic-ish budget, not a simulation.
 */
export function towerEndurance(team: { pairs: PairResult[] }[], v: NpcTeamVariant): Endurance {
  const spent = team.map(() => 0);
  const rows: EnduranceRow[] = v.team.map((foe, j) => {
    let by = -1;
    let best = -1;
    team.forEach((c, i) => {
      const s = c.pairs[j]?.score ?? 0;
      if (s > best) {
        best = s;
        by = i;
      }
    });
    const d = by >= 0 ? team[by].pairs[j]?.duel : undefined;
    const win = !!d?.win;
    const cost = d ? (win ? Math.round(100 - d.hpLeftPct) : 100) : 100;
    if (by >= 0) spent[by] += cost;
    return { foe: foe.name, by, cost, win };
  });
  const total = spent.reduce((s, x) => s + x, 0);
  return { rows, spent, budget: team.length * 100, total, losses: rows.filter((r) => !r.win).length };
}

/* ---------- live run memory (Battle tab) ---------- */

export interface RunMon {
  hp?: number;
  maxHp?: number;
  status?: string;
  fainted: boolean;
  /** Move PP left when known (active Pokémon's move buttons, bench switch cards). */
  pp: { name: string; pp?: number; maxPp?: number }[];
}

/** What MeowHelper remembers about one Battle Tower attempt (or a carry-over Frontier run). */
export interface RunState {
  key: string;
  startedAt: number;
  updatedAt: number;
  turn: number;
  /** Opponent Pokémon seen fainted, in order. */
  beaten: string[];
  /** Your Pokémon, by name, last known state. */
  mine: Record<string, RunMon>;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Same attempt = same opponent and the turn counter did not go back. */
export function runKey(snap: BattleSnapshot, npcId?: string): string {
  return npcId ?? `${snap.kind ?? 'battle'}:${snap.opponentName ?? '?'}`;
}

export function updateRun(prev: RunState | null, snap: BattleSnapshot, npcId?: string): RunState {
  const key = runKey(snap, npcId);
  const turn = snap.turn ?? 0;
  const same = !!prev && prev.key === key && turn >= prev.turn;
  const run: RunState = same
    ? { ...prev!, beaten: [...prev!.beaten], mine: { ...prev!.mine } }
    : { key, startedAt: snap.at, updatedAt: snap.at, turn, beaten: [], mine: {} };
  run.updatedAt = snap.at;
  run.turn = turn;
  for (const r of snap.opponentTeam) {
    if ((r.fainted || r.hp === 0) && !run.beaten.some((b) => norm(b) === norm(r.name))) run.beaten.push(r.name);
  }
  if (snap.opponent && snap.opponent.hp === 0 && !run.beaten.some((b) => norm(b) === norm(snap.opponent!.name))) run.beaten.push(snap.opponent.name);
  for (const r of snap.bench) {
    const old = run.mine[r.name];
    run.mine[r.name] = {
      hp: r.hp ?? old?.hp, maxHp: r.maxHp ?? old?.maxHp, status: old?.status, fainted: r.fainted || r.hp === 0,
      pp: r.moves?.length ? r.moves.map((m) => ({ name: m.name, pp: m.pp, maxPp: m.maxPp })) : old?.pp ?? [],
    };
  }
  if (snap.player) {
    const p = snap.player;
    const old = run.mine[p.name];
    run.mine[p.name] = {
      hp: p.hp ?? old?.hp, maxHp: p.maxHp ?? old?.maxHp, status: p.status, fainted: p.hp === 0 || p.status === 'fnt',
      pp: snap.moves.length ? snap.moves.map((m) => ({ name: m.name, pp: m.pp, maxPp: m.maxPp })) : old?.pp ?? [],
    };
  }
  return run;
}

export interface RunSummary {
  beaten: number;
  total: number;
  /** Roster opponents not beaten yet (the order can change with switches). */
  left: string[];
  /** Your team's HP left, % of its total max HP (known members only). */
  teamHpPct?: number;
  alive: number;
  /** Moves at 2 PP or less: "Surf (Vaporeon) 1/15". */
  lowPp: string[];
}

export function runSummary(run: RunState, v?: NpcTeamVariant): RunSummary {
  const left = v ? v.team.map((m) => m.name) : [];
  for (const b of run.beaten) {
    const i = left.findIndex((n) => norm(n) === norm(b));
    if (i >= 0) left.splice(i, 1);
  }
  let hp = 0;
  let max = 0;
  let alive = 0;
  const lowPp: string[] = [];
  for (const [name, m] of Object.entries(run.mine)) {
    if (!m.fainted) alive++;
    if (m.hp !== undefined && m.maxHp) {
      hp += m.fainted ? 0 : m.hp;
      max += m.maxHp;
    }
    for (const mv of m.pp) if (mv.pp !== undefined && mv.pp <= 2 && !m.fainted) lowPp.push(`${mv.name} (${name}) ${mv.pp}/${mv.maxPp ?? '?'}`);
  }
  return { beaten: run.beaten.length, total: v?.team.length ?? 0, left, teamHpPct: max ? Math.round((100 * hp) / max) : undefined, alive, lowPp };
}

/** Battle Tower team size advice text. */
export const towerTeamNote = (v: NpcTeamVariant) =>
  `${v.team.length} opponents in one battle${v.team[0]?.level ? ` at Lv ${v.team[0].level}` : ''}; bring up to 6 – every extra Pokémon is more HP and PP for the run.`;
