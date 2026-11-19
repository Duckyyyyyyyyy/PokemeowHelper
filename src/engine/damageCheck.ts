import type { BattleEvent, BattleMon, BattleSnapshot } from '../shared/battle';
import type { BoxMon, Dataset } from '../shared/types';
import { boxToCalc, damageRolls, makeField, moveDamage, npcToCalc } from './damage';
import { applyState, foeSet, indexes, lc, matchNpc, mySet } from './turnAdvisor';

/**
 * Calc check: compares damage the game reported in the log ("It dealt 12 damage.") with the
 * @smogon/calc range for the same hit. Uses the snapshot taken BEFORE the hit (levels and HP
 * change mid-battle) and the stat stages recorded on the event.
 */
export interface DamageCheck {
  idx: number;
  turn?: number;
  side: 'player' | 'opponent';
  attacker: string;
  target: string;
  move: string;
  damage: number;
  lo: number;
  hi: number;
  /** The hit KO'd the target, so the game's number may be cut at the target's HP. */
  capped: boolean;
  /** A critical hit: lo/hi are the crit range. */
  crit?: boolean;
  /**
   * ok = inside the range · off = outside (formula or data differs) ·
   * set-mismatch = the target's max HP on screen differs from the calc, so the set (IVs/EVs/level) is off, not the formula.
   */
  verdict: 'ok' | 'off' | 'set-mismatch';
}

function find(snap: BattleSnapshot, side: 'player' | 'opponent', name?: string): { mon: BattleMon; moves: string[] } | undefined {
  if (!name) return undefined;
  const active = side === 'player' ? snap.player : snap.opponent;
  if (active && lc(active.name) === lc(name)) {
    return { mon: active, moves: side === 'player' ? snap.moves.map((m) => m.name) : [] };
  }
  const roster = side === 'player' ? snap.bench : snap.opponentTeam;
  const r = roster.find((x) => lc(x.name) === lc(name));
  return r && { mon: { name: r.name, level: r.level, hp: r.hp, maxHp: r.maxHp }, moves: (r.moves ?? []).map((m) => m.name) };
}

export function checkEvent(ds: Dataset, box: BoxMon[], before: BattleSnapshot, ev: BattleEvent): DamageCheck | null {
  if (ev.damage === undefined || ev.missed || ev.unusual || !ev.target) return null;
  const idx = indexes(ds);
  const move = idx.moves.get(lc(ev.move));
  if (!move || move.category === 'Status') return null;
  const variant = matchNpc(ds, before)?.variant;
  const foeSide = ev.side === 'player' ? 'opponent' : 'player';
  const atkState = find(before, ev.side, ev.mon);
  const defState = find(before, foeSide, ev.target);
  if (!atkState || !defState) return null;

  const build = (side: 'player' | 'opponent', st: { mon: BattleMon; moves: string[] }) => {
    if (side === 'player') {
      const m = mySet(idx, box, st.mon, st.moves);
      return m?.known ? boxToCalc(ds, m.mon) : undefined;
    }
    const f = foeSet(ds, idx, variant, st.mon);
    return f?.known ? npcToCalc(ds, f.mon) : undefined;
  };
  const atk = build(ev.side, atkState);
  const def = build(foeSide, defState);
  if (!atk || !def) return null; // only check hits where both sets are known

  applyState(atk, atkState.mon, ev.stages.attacker);
  applyState(def, defState.mon, ev.stages.target);
  const d = moveDamage(ds, atk, def, move.id, makeField('singles'));
  if (!d) return null;
  if (ev.crit) {
    // Critical hit: compare with the crit range instead (stage rules handled by the calc).
    const rolls = damageRolls(ds, atk, def, move.id, makeField('singles'), true);
    if (!rolls) return null;
    d.lo = rolls[0];
    d.hi = rolls[rolls.length - 1];
  }

  const hpBefore = defState.mon.hp;
  const capped = !!ev.targetFainted && hpBefore !== undefined && ev.damage >= hpBefore;
  let verdict: DamageCheck['verdict'];
  if (defState.mon.maxHp !== undefined && defState.mon.maxHp !== def.maxHP()) verdict = 'set-mismatch';
  else if (capped) verdict = ev.damage <= d.hi ? 'ok' : 'off';
  else verdict = ev.damage >= d.lo && ev.damage <= d.hi ? 'ok' : 'off';
  return {
    idx: ev.idx, turn: ev.turn, side: ev.side, attacker: ev.mon, target: ev.target, move: ev.move,
    damage: ev.damage, lo: d.lo, hi: d.hi, capped, verdict, ...(ev.crit ? { crit: true } : {}),
  };
}

/** Events that appeared between two snapshots of the same battle. Empty when it is a new battle. */
export function newEvents(prev: BattleSnapshot | null, next: BattleSnapshot): BattleEvent[] {
  if (!prev || !prev.events || !next.events) return [];
  if (prev.opponentName !== next.opponentName || (next.turn ?? 0) < (prev.turn ?? 0)) return [];
  const last = prev.events.length ? prev.events[prev.events.length - 1].idx : -1;
  return next.events.filter((e) => e.idx > last);
}
