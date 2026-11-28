import type { BattleSnapshot } from '../shared/battle';
import type { BoxMon, Dataset } from '../shared/types';
import { EV_MAX_STAT } from './evPlan';
import { statsAtLevel } from './potential';

/**
 * Battle Debrief: after a battle, the knockouts and the ones where your Pokémon was hit first and
 * knocked out before it could move, with the Spe EVs that would have let it move first.
 *
 * GUESSES: "outsped" = it was on the field the turn before, had not moved this turn and the hit had no
 * priority (sleep, paralysis, flinch and Choice Scarf look the same); the foe's Speed is estimated with
 * 31 IVs, no EVs and a neutral nature (the trainer's real set is not on screen).
 */

export interface DebriefKo {
  turn?: number;
  /** Side that landed the knockout. */
  side: 'player' | 'opponent';
  by: string;
  move: string;
  target: string;
}

export interface Outsped {
  turn?: number;
  mine: string;
  foe: string;
  move: string;
  /** Your box Pokémon, when found by name (and level). */
  uid?: string;
  mySpe?: number;
  /** Estimate (31 IVs, no EVs, neutral nature). */
  foeSpe?: number;
  /** Extra Spe EVs that pass the estimate; null = even 252 does not; undefined = it already passes the estimate. */
  needEvs?: number | null;
}

export interface Debrief {
  result: string;
  opponent?: string;
  turns?: number;
  kos: DebriefKo[];
  outsped: Outsped[];
}

const lc = (s: string) => s.toLowerCase();

function speciesId(ds: Dataset, name: string): number | undefined {
  const n = lc(name);
  return Object.values(ds.species).find((s) => lc(s.name) === n)?.id;
}

export function debrief(ds: Dataset, snap: BattleSnapshot, box: readonly BoxMon[]): Debrief {
  const ev = snap.events ?? [];
  const kos: DebriefKo[] = [];
  for (const e of ev) {
    if (e.targetFainted && e.target) kos.push({ turn: e.turn, side: e.side, by: e.mon, move: e.move, target: e.target });
    for (const h of e.hits ?? []) if (h.fainted && h.side !== e.side) kos.push({ turn: e.turn, side: e.side, by: e.mon, move: e.move, target: h.mon });
  }
  const moveByName = new Map(Object.values(ds.moves).map((m) => [lc(m.name), m]));
  const levelOf = (side: 'player' | 'opponent', name: string) => {
    const roster = side === 'player' ? [snap.player, ...snap.bench] : [snap.opponent, ...snap.opponentTeam];
    return roster.find((r) => r && lc(r.name) === lc(name))?.level;
  };
  const outsped: Outsped[] = [];
  for (const e of ev) {
    if (e.side !== 'opponent' || !e.targetFainted || !e.target || e.turn === undefined) continue;
    if ((moveByName.get(lc(e.move))?.priority ?? 0) > 0) continue;
    const mine = e.target;
    const actedBefore = ev.some((x) => x.side === 'player' && lc(x.mon) === lc(mine) && x.turn === e.turn! - 1);
    const actedNow = ev.some((x) => x.side === 'player' && lc(x.mon) === lc(mine) && x.turn === e.turn && x.idx < e.idx);
    if (!actedBefore || actedNow) continue;
    const o: Outsped = { turn: e.turn, mine, foe: e.mon, move: e.move };
    const myLevel = levelOf('player', mine);
    const sp = speciesId(ds, mine);
    const own = box.filter((b) => b.species === sp);
    const m = own.find((b) => b.level === myLevel) ?? own[0];
    const foeSp = speciesId(ds, e.mon);
    const foeLevel = levelOf('opponent', e.mon);
    if (m && foeSp !== undefined && foeLevel !== undefined) {
      const level = myLevel ?? m.level ?? 50;
      const from = m.evs?.spe ?? 0;
      const speAt = (x: number) => statsAtLevel(ds, { ...m, evs: { ...m.evs, spe: x } }, level).spe;
      o.uid = m.uid;
      o.mySpe = speAt(from);
      o.foeSpe = statsAtLevel(ds, { uid: '', species: foeSp, moves: [], source: 'game', ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, evs: {} }, foeLevel).spe;
      if (o.mySpe <= o.foeSpe) {
        o.needEvs = null;
        for (let x = from + 4 - (from % 4); x <= EV_MAX_STAT; x += 4) {
          if (speAt(x) > o.foeSpe) {
            o.needEvs = x - from;
            break;
          }
        }
      }
    }
    outsped.push(o);
  }
  return { result: snap.status, opponent: snap.opponentName, turns: snap.turn, kos, outsped };
}
