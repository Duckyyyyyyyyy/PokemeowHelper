import type { Pokemon as CalcPokemon } from '@smogon/calc';
import type { BattleMon, BattleSnapshot, Boosts, RosterMon } from '../shared/battle';
import type { BoxMon, Dataset, Npc, NpcMon, NpcTeamVariant } from '../shared/types';
import { ASSUMED_NPC_LEVEL, bestMove, boxToCalc, defenderVsNpc, makeField, moveDamage, npcToCalc, type MoveDamage } from './damage';
import { rulesFor, type BattleRules } from './rules';
import { movesForBox } from './teamSuggest';

/**
 * Phase 3 turn advice for SINGLES, from a battle snapshot (content script) + game data + your box.
 * Each action (your 4 moves, each switch) gets a 0–100 score from a short 1v1 projection that
 * starts at the CURRENT HP, status and stat stages:
 *   - both sides keep using their best move; priority, then speed (stages, paralysis, Scarf) set the order;
 *   - a switch takes one free hit from the NPC's best move first.
 * It is a ranking aid, not a full simulator: no crits, no secondary effects, no NPC switching.
 */

export interface ActionAdvice {
  kind: 'move' | 'switch';
  label: string;
  /** null = not scored (status move, unknown move). */
  score: number | null;
  reason: string;
  moveId?: string;
  minPct?: number;
  maxPct?: number;
  ko?: 'sure' | 'chance';
}

export interface ThreatInfo {
  name: string;
  minPct: number;
  maxPct: number;
  /** Their best hit KOs you from your current HP. */
  ko?: 'sure' | 'chance';
  youFirst: boolean | null;
}

export interface TurnAdvice {
  npc?: Npc;
  variant?: NpcTeamVariant;
  /** Their active Pokémon as MeowDex knows it (wiki set) and whether it was found in the NPC's team. */
  foe?: { mon: NpcMon; known: boolean };
  me?: { mon: BoxMon; known: boolean };
  actions: ActionAdvice[];
  threat?: ThreatInfo;
  notes: string[];
}

const lc = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function indexes(ds: Dataset) {
  const species = new Map(Object.values(ds.species).map((s) => [lc(s.name), s]));
  const moves = new Map(Object.values(ds.moves).map((m) => [lc(m.name), m]));
  const items = new Map(Object.values(ds.items).map((i) => [lc(i.name), i]));
  return { species, moves, items };
}
type Idx = ReturnType<typeof indexes>;

const KIND_TO_CATEGORY: Record<string, Npc['category'][]> = {
  gym: ['gym'], league: ['elite-four', 'champion'], 'elite-four': ['elite-four'], champion: ['champion'],
  tower: ['tower'], frontier: ['frontier'], mega: ['mega'], rival: ['rival'], rocket: ['rocket'], boss: ['boss'], 'world-boss': ['boss'],
};

/** Finds the NPC and the team variant that best fits what the battle screen shows. */
export function matchNpc(ds: Dataset, snap: BattleSnapshot): { npc: Npc; variant: NpcTeamVariant } | undefined {
  const name = snap.opponentName?.trim();
  if (!name) return undefined;
  const cats = snap.kind ? KIND_TO_CATEGORY[snap.kind] : undefined;
  let best: { npc: Npc; variant: NpcTeamVariant; score: number } | undefined;
  for (const npc of ds.npcs) {
    for (const v of npc.variants) {
      const who = v.trainerName ?? npc.name;
      if (lc(who) !== lc(name) && lc(npc.name) !== lc(name)) continue;
      let score = cats?.includes(npc.category) ? 2 : 0;
      const seen = [...snap.opponentTeam];
      if (snap.opponent && !seen.some((r) => lc(r.name) === lc(snap.opponent!.name))) seen.push({ ...snap.opponent, active: true, fainted: false });
      for (const r of seen) {
        const hit = v.team.find((m) => lc(m.name) === lc(r.name));
        if (hit) score += hit.level === r.level ? 3 : 1;
        else score -= 2;
      }
      if (!best || score > best.score) best = { npc, variant: v, score };
    }
  }
  return best && { npc: best.npc, variant: best.variant };
}

function foeSet(ds: Dataset, idx: Idx, v: NpcTeamVariant | undefined, b: BattleMon): { mon: NpcMon; known: boolean } | undefined {
  const named = v?.team.filter((m) => lc(m.name) === lc(b.name)) ?? [];
  const hit = named.find((m) => m.level === b.level) ?? named[0];
  if (hit) return { mon: { ...hit, level: b.level ?? hit.level ?? ASSUMED_NPC_LEVEL }, known: true };
  const s = idx.species.get(lc(b.name));
  if (!s) return undefined;
  const level = b.level ?? ASSUMED_NPC_LEVEL;
  // Unknown set: assume its 4 latest damaging level-up moves.
  const moves = s.levelMoves.filter(([id, l]) => l <= level && ds.moves[id] && ds.moves[id].category !== 'Status').map(([id]) => id);
  return { mon: { species: s.id, name: s.name, level, moves: [...new Set(moves)].slice(-4), baseStats: s.baseStats }, known: false };
}

/** Your box entry for a Pokémon on the battle screen: same species, best move overlap, closest level. */
function mySet(idx: Idx, box: BoxMon[], b: { name: string; level?: number; item?: string }, moveNames: string[]): { mon: BoxMon; known: boolean } | undefined {
  const s = idx.species.get(lc(b.name));
  if (!s) return undefined;
  const moveIds = moveNames.map((n) => idx.moves.get(lc(n))?.id).filter((x): x is string => !!x);
  const itemId = b.item ? idx.items.get(lc(b.item))?.id ?? null : undefined;
  let best: { mon: BoxMon; score: number } | undefined;
  for (const m of box) {
    if (m.species !== s.id) continue;
    const overlap = moveIds.filter((id) => m.moves.includes(id)).length;
    const lvGap = b.level !== undefined && m.level !== undefined ? Math.abs(b.level - m.level) : 5;
    const score = overlap * 10 - lvGap + (m.source === 'game' ? 1 : 0);
    if (!best || score > best.score) best = { mon: m, score };
  }
  const page = { level: b.level, ...(moveIds.length ? { moves: moveIds } : {}), ...(itemId !== undefined ? { item: itemId } : {}) };
  if (best) return { mon: { ...best.mon, ...page, level: b.level ?? best.mon.level }, known: true };
  return { mon: { uid: `battle:${s.id}`, species: s.id, level: b.level, moves: moveIds, source: 'manual', ...(itemId ? { item: itemId } : {}) }, known: false };
}

const STATUS: Record<string, Exclude<CalcPokemon['status'], ''>> = { par: 'par', brn: 'brn', psn: 'psn', tox: 'tox', slp: 'slp', frz: 'frz' };

function applyState(p: CalcPokemon, b: { hp?: number; maxHp?: number; status?: string }, boosts?: Boosts) {
  if (b.hp !== undefined && b.maxHp) p.originalCurHP = Math.max(0, Math.round((p.maxHP() * b.hp) / b.maxHp));
  const st = b.status ? STATUS[b.status] : undefined;
  if (st) p.status = st;
  if (boosts) for (const k of ['atk', 'def', 'spa', 'spd', 'spe'] as const) if (boosts[k]) p.boosts[k] = boosts[k]!;
  return p;
}

const curPct = (p: CalcPokemon) => (100 * p.curHP()) / p.maxHP();
const stage = (b: number) => (b >= 0 ? (2 + b) / 2 : 2 / (2 - b));

export function battleSpeed(p: CalcPokemon): number {
  let s = p.stats.spe * stage(p.boosts.spe ?? 0);
  if (p.item === 'Choice Scarf') s *= 1.5;
  if (p.status === 'par') s *= 0.5;
  return s;
}

function order(me: CalcPokemon, foe: CalcPokemon, myPrio: number, theirPrio: number): boolean | null {
  if (myPrio !== theirPrio) return myPrio > theirPrio;
  const a = battleSpeed(me);
  const b = battleSpeed(foe);
  return a === b ? null : a > b;
}

/** Projects a 1v1 from current HP%. Damage values are % of each side's max HP per hit. */
function project(myHit: number, theirHit: number, myHp: number, foeHp: number, youFirst: boolean | null) {
  const myTurns = myHit > 0 ? Math.ceil(foeHp / myHit) : Infinity;
  const theirTurns = theirHit > 0 ? Math.ceil(myHp / theirHit) : Infinity;
  const first = youFirst ?? false; // ties count against you
  const win = myTurns !== Infinity && (first ? myTurns <= theirTurns : myTurns < theirTurns);
  if (win) {
    const hpLeft = Math.max(0, myHp - (first ? myTurns - 1 : myTurns) * theirHit);
    return { win, myTurns, score: 55 + 0.45 * hpLeft };
  }
  const dealt = Math.min(foeHp, (theirTurns === Infinity ? 0 : first ? theirTurns : theirTurns - 1) * myHit);
  return { win, myTurns, score: 0.45 * (foeHp > 0 ? (100 * dealt) / foeHp : 0) };
}

const avg = (d: MoveDamage | null) => (d ? (d.minPct + d.maxPct) / 2 : 0);
const pctTxt = (d: { minPct: number; maxPct: number }) => `${Math.round(d.minPct)}–${Math.round(d.maxPct)}%`;

export function adviseTurn(ds: Dataset, snap: BattleSnapshot, box: BoxMon[]): TurnAdvice {
  const notes: string[] = [];
  const idx = indexes(ds);
  const match = matchNpc(ds, snap);
  const rules: BattleRules = rulesFor(match?.npc.category);
  const field = makeField('singles');
  const out: TurnAdvice = { npc: match?.npc, variant: match?.variant, actions: [], notes };

  const format = snap.format ?? match?.variant.format;
  if (format && format !== 'singles') notes.push('Only singles are supported for now: advice treats this as a 1v1.');
  if (!match) notes.push(`“${snap.opponentName ?? 'This opponent'}” is not in the wiki data (wild or player battle?). Using guessed sets.`);
  if (!snap.player || !snap.opponent) {
    notes.push('Waiting for both Pokémon to be on the field.');
    return out;
  }

  const foe = foeSet(ds, idx, match?.variant, snap.opponent);
  const me = mySet(idx, box, snap.player, snap.moves.map((m) => m.name));
  out.foe = foe;
  out.me = me;
  if (!foe || !me) {
    notes.push(`Unknown Pokémon: ${!foe ? snap.opponent.name : snap.player.name}.`);
    return out;
  }
  if (!foe.known) notes.push(`${foe.mon.name}'s set is a guess (latest level-up moves, perfect IVs).`);
  if (!me.known) notes.push(`${snap.player.name} is not in your box: using average IVs. Sync your box for exact numbers.`);

  const myCalc = applyState(boxToCalc(ds, me.mon), snap.player, snap.boosts.player);
  const foeCalc = applyState(npcToCalc(ds, foe.mon), snap.opponent, snap.boosts.opponent);
  const foeMoves = foe.mon.moves.filter((id) => !rules.bannedMoves.has(id));
  const myHp = curPct(myCalc);
  const foeHp = curPct(foeCalc);

  const threat = bestMove(ds, foeCalc, defenderVsNpc(myCalc, rules), foeMoves, field);
  const theirHit = avg(threat);
  if (threat) {
    const first = order(myCalc, foeCalc, 0, threat.priority);
    out.threat = {
      name: threat.name, minPct: threat.minPct, maxPct: threat.maxPct,
      ko: threat.minPct >= myHp ? 'sure' : threat.maxPct >= myHp ? 'chance' : undefined,
      youFirst: first,
    };
  }

  // Your moves
  for (const m of snap.moves) {
    const g = idx.moves.get(lc(m.name));
    if (!g) {
      out.actions.push({ kind: 'move', label: m.name, score: null, reason: 'Unknown move.' });
      continue;
    }
    if (m.disabled) {
      out.actions.push({ kind: 'move', label: m.name, moveId: g.id, score: null, reason: m.pp === 0 ? 'No PP left.' : 'Disabled.' });
      continue;
    }
    if (rules.bannedMoves.has(g.id)) {
      out.actions.push({ kind: 'move', label: m.name, moveId: g.id, score: 0, reason: 'Does nothing under challenge rules.' });
      continue;
    }
    if (g.category === 'Status') {
      out.actions.push({ kind: 'move', label: m.name, moveId: g.id, score: null, reason: 'Status move – not scored. Use it if the effect helps.' });
      continue;
    }
    const d = moveDamage(ds, myCalc, foeCalc, g.id, field);
    if (!d || d.maxPct <= 0) {
      out.actions.push({ kind: 'move', label: m.name, moveId: g.id, score: 0, reason: 'No effect on this target.' });
      continue;
    }
    const first = order(myCalc, foeCalc, d.priority, threat?.priority ?? 0);
    const p = project(d.expectedPct, theirHit, myHp, foeHp, first);
    const ko = d.minPct >= foeHp ? 'sure' : d.maxPct >= foeHp ? 'chance' : undefined;
    let reason: string;
    if (ko === 'sure' && first !== false) reason = 'KOs now' + (first === null ? ' (speed tie)' : ', you move first') + '.';
    else if (ko === 'sure') reason = out.threat?.ko === 'sure' ? 'Would KO, but they move first and KO you.' : 'KOs after taking their hit.';
    else if (ko === 'chance') reason = `Can KO now (needs a high roll)${first === false ? ', after their hit' : ''}.`;
    else reason = `${p.myTurns === Infinity ? 'No KO' : `${p.myTurns} hits to KO`}; ${p.win ? 'you win the trade' : 'you lose the trade'}.`;
    const accuracy = ds.moves[g.id].accuracy;
    if (accuracy !== true && accuracy < 100) reason += ` ${accuracy}% accuracy.`;
    out.actions.push({ kind: 'move', label: m.name, moveId: g.id, minPct: d.minPct, maxPct: d.maxPct, ko, score: Math.round(Math.max(0, Math.min(100, p.score + (ko === 'sure' && first !== false ? 10 : 0)))), reason });
  }

  // Switches
  for (const r of snap.bench) {
    if (r.active || r.fainted || (r.hp ?? 1) <= 0) continue;
    out.actions.push(switchAdvice(ds, idx, box, r, foeCalc, foeMoves, rules, field));
  }

  out.actions.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  if (Object.keys(snap.boosts.player).length || Object.keys(snap.boosts.opponent).length) notes.push('Stat stages come from the battle log and are included.');
  return out;
}

function switchAdvice(ds: Dataset, idx: Idx, box: BoxMon[], r: RosterMon, foeCalc: CalcPokemon, foeMoves: string[], rules: BattleRules, field: ReturnType<typeof makeField>): ActionAdvice {
  const label = `Switch to ${r.name}`;
  const mine = mySet(idx, box, r, (r.moves ?? []).map((m) => m.name));
  if (!mine) return { kind: 'switch', label, score: null, reason: 'Unknown Pokémon.' };
  const p = applyState(boxToCalc(ds, mine.mon), r);
  const moves = movesForBox(ds, mine.mon);
  const incoming = bestMove(ds, foeCalc, defenderVsNpc(p, rules), foeMoves, field);
  const hpAfter = curPct(p) - avg(incoming);
  if (hpAfter <= 0) return { kind: 'switch', label, score: 0, reason: `Would faint switching in (${incoming ? `${incoming.name} ${pctTxt(incoming)}` : ''}).` };
  const mineBest = bestMove(ds, p, foeCalc, moves, field);
  if (!mineBest) return { kind: 'switch', label, score: 5, reason: `Takes ~${Math.round(avg(incoming))}% switching in; no known damaging move${mine.known ? '' : ' (not in your box)'}.` };
  const first = order(p, foeCalc, mineBest.priority, incoming?.priority ?? 0);
  const proj = project(mineBest.expectedPct, avg(incoming), hpAfter, curPct(foeCalc), first);
  // Switching gives up this turn's attack: small penalty so a good attack wins ties.
  const score = Math.round(Math.max(0, Math.min(100, proj.score - 8)));
  return {
    kind: 'switch', label, score,
    reason: `Takes ~${Math.round(avg(incoming))}% switching in, then ${mineBest.name} ${pctTxt(mineBest)}: ${proj.win ? 'wins' : 'loses'} the 1v1.${mine.known ? '' : ' (Not in your box: average IVs.)'}`,
  };
}
