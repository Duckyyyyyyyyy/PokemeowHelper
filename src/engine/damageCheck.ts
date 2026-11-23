import type { BattleEvent, BattleMon, BattleSnapshot, Boosts } from '../shared/battle';
import type { BoxMon, Dataset } from '../shared/types';
import { boxToCalc, damageRolls, makeField, moveDamage, npcToCalc } from './damage';
import { applyState, foeSet, indexes, lc, matchNpc, mySet } from './turnAdvisor';
import { doublesField } from './doublesAdvisor';
import { fieldFromLog } from './supportMoves';

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
  /** Doubles spread hit (×0.75 applied). */
  spread?: boolean;
}

function find(snap: BattleSnapshot, side: 'player' | 'opponent', name?: string): { mon: BattleMon; moves: string[] } | undefined {
  if (!name) return undefined;
  // Doubles: either Pokémon on the field.
  const onField = snap.actives?.[side].find((m) => lc(m.name) === lc(name));
  if (onField) {
    const shown = side === 'player' && snap.movesFor && lc(snap.movesFor) === lc(name) ? snap.moves.map((m) => m.name) : [];
    const card = snap.bench.find((r) => lc(r.name) === lc(name));
    return { mon: onField, moves: shown.length ? shown : (card?.moves ?? []).map((m) => m.name) };
  }
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
  // World Boss: your hits are 125x and capped, its hits are cut 55-70%; the log is not ordinary damage.
  if (before.kind === 'world-boss') return null;
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

/**
 * Doubles calc check: one row per Pokémon hit. Single-target hits use the named target
 * ("X used Crunch on Y! … It dealt 86 damage."); spread hits use each "<Pokémon> took N damage."
 * line, with the ×0.75 spread reduction when the move had more than one target (seen live).
 */
export function checkDoublesEvent(ds: Dataset, box: BoxMon[], before: BattleSnapshot, ev: BattleEvent): DamageCheck[] {
  // Crits are no longer marked unusual (lookahead reader); in doubles they are skipped (which target crit is unclear on spread hits).
  if (ev.missed || ev.unusual || ev.crit) return [];
  const idx = indexes(ds);
  const move = idx.moves.get(lc(ev.move));
  if (!move || move.category === 'Status') return [];
  const variant = matchNpc(ds, before)?.variant;
  type T = { side: 'player' | 'opponent'; mon: string; damage: number; fainted: boolean; stages: Boosts };
  // A named target ("used Crunch on Y") wins over any later "took N damage" line.
  const targets: T[] = ev.targetSide && ev.target
    ? (ev.damage !== undefined ? [{ side: ev.targetSide, mon: ev.target, damage: ev.damage, fainted: !!ev.targetFainted, stages: ev.stages.target }] : [])
    : (ev.hits ?? []).filter((h) => h.damage !== undefined).map((h) => ({ side: h.side, mon: h.mon, damage: h.damage!, fainted: !!h.fainted, stages: h.stages ?? {} }));
  if (!targets.length) return [];
  const spread = !ev.targetSide && (ev.hits?.length ?? 0) > 1;
  // Screens from the log (×2/3 in doubles); a hit under a screen we can't see is still judged with it.
  const screens = fieldFromLog((before.events ?? []).filter((e) => e.idx < ev.idx), ev.turn ?? before.turn, (n) => idx.moves.get(lc(n))?.id);
  const atkState = find(before, ev.side, ev.mon);
  if (!atkState) return [];
  const build = (side: 'player' | 'opponent', st: { mon: BattleMon; moves: string[] }) => {
    if (side === 'player') {
      const m = mySet(idx, box, st.mon, st.moves);
      return m?.known ? boxToCalc(ds, m.mon) : undefined;
    }
    const f = foeSet(ds, idx, variant, st.mon);
    return f?.known ? npcToCalc(ds, f.mon) : undefined;
  };
  const atk = build(ev.side, atkState);
  if (!atk) return [];
  applyState(atk, atkState.mon, ev.stages.attacker);
  const out: DamageCheck[] = [];
  for (const t of targets) {
    const defState = find(before, t.side, t.mon);
    if (!defState) continue;
    const def = build(t.side, defState);
    if (!def) continue;
    applyState(def, defState.mon, t.stages);
    const d = moveDamage(ds, atk, def, move.id, doublesField(screens, ev.side, t.side), { singleTarget: !spread });
    if (!d) continue;
    const hpBefore = defState.mon.hp;
    const capped = t.fainted && hpBefore !== undefined && t.damage >= hpBefore;
    let verdict: DamageCheck['verdict'];
    if (defState.mon.maxHp !== undefined && defState.mon.maxHp !== def.maxHP()) verdict = 'set-mismatch';
    else if (capped) verdict = t.damage <= d.hi ? 'ok' : 'off';
    else verdict = t.damage >= d.lo && t.damage <= d.hi ? 'ok' : 'off';
    out.push({ idx: ev.idx, turn: ev.turn, side: ev.side, attacker: ev.mon, target: t.mon, move: ev.move, damage: t.damage, lo: d.lo, hi: d.hi, capped, verdict, ...(spread ? { spread: true } : {}) });
  }
  return out;
}
