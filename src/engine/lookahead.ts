import type { Field, Pokemon as CalcPokemon } from '@smogon/calc';
import type { BoostKey, Boosts } from '../shared/battle';
import type { Dataset } from '../shared/types';
import { damageRolls } from './damage';
import { canFlinch, canGetStatus, critInfo, fxChanceMul, moveFx, type SecStatus } from './moveEffects';
import { npcAttackWeight } from './npcModel';
import { accuracyStageMul, stageMul } from './projection';
import { PAR_SKIP, SLEEP_TURNS, supportEffect, type SupportEffect } from './supportMoves';

/**
 * Lookahead (PLAN §3.3): a small expectimax over a few turns of a singles battle.
 *
 *   decision node (you)  → each action: your moves, support moves, switches
 *   chance node (NPC)    → its reply, from npcModel's guess blended with its strongest hit
 *   chance node (rolls)  → per hit: KO / no KO (16 damage rolls, crit chance, accuracy,
 *                          paralysis / confusion / freeze), plus ONE secondary-effect branch
 *                          (flinch only when the attacker moves first, status, confusion, stat drop)
 *
 * After `depth` turns the leaf is scored with the same 1v1 projection as before (projection.ts),
 * on the same 0–100 scale (55+ = you win the 1v1 against their current Pokémon), so lookahead
 * scores still sort with the item rows. A KO'd NPC Pokémon is replaced by the next one in team
 * order (boosts you set up carry over: "set up now, sweep next turn"); a fainted Pokémon of yours
 * is replaced by your best bench Pokémon for free ("chip now so the next one KOs", kept below 55).
 * Damage is cached per (attacker, stages, defender, stages, move, crit); the search is capped by a
 * node count, not by time, so results are deterministic.
 */

export interface LookMon {
  name: string;
  /** HP and status as on the field now; stat stages are passed separately. */
  calc: CalcPokemon;
  /** Copy NPC attacks hit (World Boss rule: no Wonder Guard). Defaults to `calc`. */
  asDefender?: CalcPokemon;
  /** Usable moves: attacks (and, for your active one, support moves). */
  moves: string[];
}

export interface LookInput {
  ds: Dataset;
  field?: Field;
  /** [0] = your active Pokémon (may be fainted: forced switch), then your healthy bench. */
  mine: LookMon[];
  /** [0] = their active Pokémon, then the ones still to come, in the order they come in (a guess). */
  foes: LookMon[];
  myBoosts?: Boosts;
  foeBoosts?: Boosts;
  focusEnergy?: { me?: boolean; foe?: boolean };
  /** Each side's active Pokémon has not moved yet since it came in (Fake Out works). */
  firstTurn?: { me?: boolean; foe?: boolean };
  /** npcModel's guess for their active Pokémon vs your active one (the first reply). */
  prediction?: { moveId: string; prob: number }[];
  /** Turns to look ahead (2 = this turn and the next). */
  depth?: number;
  /** Search size cap (decision + chance nodes). */
  maxNodes?: number;
}

export type RootAction = { kind: 'move'; moveId: string } | { kind: 'switch'; to: number };

export interface RootValue {
  action: RootAction;
  /** 0–100, same scale as the 1v1 projection. */
  score: number;
  /** Line of play, e.g. "Swords Dance → Earthquake KOs both remaining". */
  line?: string;
}

/** Share of the NPC's reply that is its strongest hit regardless of the guess (npcModel rests on few observations). */
export const WORST_CASE_SHARE = 0.25;
/** Switching gives up a turn: same −8 the old switch rows used, so a good attack wins ties. */
export const SWITCH_PENALTY = 8;
/** Setup on a line that already wins costs a small tie-break (an NPC switch or a miss we don't see). */
export const SETUP_TIEBREAK = 4;
/** Confusion: 33% to hit itself (Gen 7+), lasts 2–5 turns (guess: 3 attempts). */
const CONFUSE_ACT = 2 / 3;
const CONFUSE_TURNS = 3;
const THAW = 0.2;
/** Turns a Pokémon shown asleep (no counter on screen) still sleeps: a guess. */
const SLEEP_SHOWN = 1;
const CHIP: Record<string, number> = { brn: 100 / 16, psn: 100 / 8, tox: 100 / 8 };
const BK: BoostKey[] = ['atk', 'def', 'spa', 'spd', 'spe', 'accuracy', 'evasion'];
const MIN_P = 0.01;

interface Mon {
  name: string;
  side: 0 | 1;
  calc: CalcPokemon;
  def: CalcPokemon;
  work: CalcPokemon;
  workDef: CalcPokemon;
  maxHp: number;
  attacks: string[];
  support: string[];
}

interface S {
  hp: number[];
  st: string[];
  slp: number[];
  me: number;
  /** -1 = all their Pokémon are down. */
  foe: number;
  mb: number[];
  fb: number[];
  mc: number;
  fc: number;
  mFE: boolean;
  fFE: boolean;
  mFirst: boolean;
  fFirst: boolean;
  /** Your Pokémon that fainted in this line. */
  lost: number;
  /** Their Pokémon KO'd in this line. */
  kos: number;
  /** Turn their first Pokémon went down (0 = still up). */
  f0t: number;
  turn: number;
  /** Bit per NPC status move already used in this line (they rarely repeat). */
  fUsed: number;
}

interface Dist {
  n: number[];
  c: number[];
  crit: number;
  acc: number;
  prio: number;
  /** Expected damage % per use, incl. crits and accuracy (not the act chance). */
  mean: number;
}

type Child = { p: number; s: S; note?: string };

const cloneS = (s: S): S => ({ ...s, hp: s.hp.slice(), st: s.st.slice(), slp: s.slp.slice(), mb: s.mb.slice(), fb: s.fb.slice() });
const zeros = () => [0, 0, 0, 0, 0, 0, 0];
const clampStage = (n: number) => Math.max(-6, Math.min(6, n));
const toArr = (b?: Boosts) => BK.map((k) => b?.[k] ?? 0);

export class Lookahead {
  readonly ds: Dataset;
  readonly field?: Field;
  readonly mons: Mon[];
  readonly nMine: number;
  readonly root: S;
  readonly rootFoeHp: number;
  private readonly prediction?: { moveId: string; prob: number }[];
  private readonly dists = new Map<string, Dist | null>();
  private readonly memo = new Map<string, { v: number; best?: RootAction }>();
  private readonly maxNodes: number;
  nodes = 0;
  calcs = 0;

  constructor(input: LookInput) {
    this.ds = input.ds;
    this.field = input.field;
    this.prediction = input.prediction;
    this.maxNodes = input.maxNodes ?? 6000;
    const mk = (m: LookMon, side: 0 | 1, first: boolean): Mon => {
      const work = m.calc.clone();
      const def = m.asDefender ?? m.calc;
      const isStatus = (id: string) => this.ds.moves[id]?.category === 'Status';
      return {
        name: m.name, side, calc: m.calc, def, work, workDef: def === m.calc ? work : def.clone(),
        maxHp: m.calc.maxHP(),
        attacks: m.moves.filter((id) => this.ds.moves[id] && !isStatus(id)),
        support: first || side === 1 ? m.moves.filter((id) => isStatus(id) && searchable(this.ds, id)) : [],
      };
    };
    this.mons = [...input.mine.map((m, i) => mk(m, 0, i === 0)), ...input.foes.map((m) => mk(m, 1, false))];
    this.nMine = input.mine.length;
    const hp = this.mons.map((m) => (100 * m.calc.curHP()) / m.maxHp);
    const st = this.mons.map((m) => (m.calc.status as string) || '');
    this.root = {
      hp, st, slp: st.map((x) => (x === 'slp' ? SLEEP_SHOWN : 0)),
      me: 0, foe: this.nMine,
      mb: toArr(input.myBoosts), fb: toArr(input.foeBoosts), mc: 0, fc: 0,
      mFE: !!input.focusEnergy?.me, fFE: !!input.focusEnergy?.foe,
      mFirst: !!input.firstTurn?.me, fFirst: !!input.firstTurn?.foe,
      lost: 0, kos: 0, f0t: 0, turn: 0, fUsed: 0,
    };
    this.rootFoeHp = hp[this.nMine];
  }

  /* ---------------- damage ---------------- */

  /** Damage distribution of `a` hitting `d` (ids) with the given stages and attacker status. */
  dist(a: number, d: number, moveId: string, ab: number[], db: number[], aSt: string, aFE: boolean): Dist | null {
    const key = `${a}>${d}:${moveId}:${ab[0]},${ab[2]},${ab[4]}:${db[1]},${db[3]},${db[4]}:${aSt}:${aFE ? 1 : 0}`;
    if (this.dists.has(key)) return this.dists.get(key)!;
    const A = this.mons[a];
    const D = this.mons[d];
    const atk = A.work;
    const def = A.side === 1 ? D.workDef : D.work;
    atk.boosts = { ...atk.boosts, atk: ab[0], def: ab[1], spa: ab[2], spd: ab[3], spe: ab[4] };
    def.boosts = { ...def.boosts, atk: 0, def: db[1], spa: 0, spd: db[3], spe: db[4] };
    atk.status = aSt as CalcPokemon['status'];
    this.calcs++;
    const rolls = damageRolls(this.ds, atk, def, moveId, this.field);
    let out: Dist | null = null;
    if (rolls && rolls[rolls.length - 1] > 0) {
      const hp = def.maxHP();
      const n = rolls.map((x) => (100 * x) / hp);
      const ci = critInfo(this.ds, atk, def, moveId, aFE);
      let c = n;
      let crit = ci.always ? 0 : ci.chance;
      if (crit > 0) {
        // A crit ignores your negative stages and their positive ones: with none of those, it's just ×1.5.
        if (ab[0] >= 0 && ab[2] >= 0 && db[1] <= 0 && db[3] <= 0) c = n.map((x) => Math.floor(x * ci.mul * 100) / 100);
        else {
          this.calcs++;
          const cr = damageRolls(this.ds, atk, def, moveId, this.field, true);
          c = cr ? cr.map((x) => (100 * x) / hp) : n.map((x) => x * ci.mul);
        }
      } else crit = 0;
      const mv = this.ds.moves[moveId];
      const accRaw = mv.accuracy;
      const acc = accRaw === true || typeof accRaw !== 'number' || accRaw <= 0 ? 1 : accRaw / 100;
      const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
      out = { n, c, crit, acc, prio: mv.priority ?? 0, mean: ((1 - crit) * avg(n) + crit * avg(c)) * acc };
    }
    this.dists.set(key, out);
    return out;
  }

  private hitChance(dd: Dist, moveId: string, accStage: number): number {
    const a = this.ds.moves[moveId]?.accuracy;
    if (a === true || typeof a !== 'number' || a <= 0) return 1;
    return Math.min(1, dd.acc * accuracyStageMul(accStage));
  }

  private boostsOf(s: S, id: number): number[] {
    return id === s.me ? s.mb : id === s.foe ? s.fb : zeros();
  }

  private actChance(s: S, id: number): number {
    const st = s.st[id];
    let a = st === 'par' ? 1 - PAR_SKIP : st === 'frz' ? THAW : 1;
    if ((id === s.me && s.mc > 0) || (id === s.foe && s.fc > 0)) a *= CONFUSE_ACT;
    return a;
  }

  speed(s: S, id: number): number {
    const m = this.mons[id];
    let v = m.calc.stats.spe * stageMul(this.boostsOf(s, id)[4]);
    if (m.calc.item === 'Choice Scarf') v *= 1.5;
    if (s.st[id] === 'par') v *= 0.5;
    return v;
  }

  /** Expected damage % of the best attack of `a` on `d` in state s (incl. crits and accuracy). */
  private bestHit(s: S, a: number, d: number, withAcc: boolean, firstTurn = false): { id?: string; hit: number; prio: number } {
    const A = this.mons[a];
    const ab = this.boostsOf(s, a);
    const db = this.boostsOf(s, d);
    const fe = a === s.me ? s.mFE : a === s.foe ? s.fFE : false;
    let best = { id: undefined as string | undefined, hit: 0, prio: 0 };
    for (const id of A.attacks) {
      if (moveFx(this.ds, id).firstTurnOnly && !firstTurn) continue;
      const dd = this.dist(a, d, id, ab, db, s.st[a], fe);
      if (!dd) continue;
      const hit = withAcc ? dd.mean * this.hitChance(dd, id, ab[5] - db[6]) / dd.acc : dd.mean / dd.acc;
      if (hit > best.hit) best = { id, hit, prio: dd.prio };
    }
    return best;
  }

  /* ---------------- leaf: the 1v1 projection ---------------- */

  /** Same rules as project(): both keep using their best hit; a tie in speed counts against you. */
  private proj(s: S, a: number, f: number): { win: boolean; hpLeft: number; dealt: number } {
    const mine = this.bestHit(s, a, f, true);
    const theirs = this.bestHit(s, f, a, false);
    const myHit = mine.hit * this.actChance(s, a) + (CHIP[s.st[f]] ?? 0);
    const theirHit = theirs.hit * this.actChance(s, f) + (CHIP[s.st[a]] ?? 0);
    let myHp = s.hp[a];
    let foeHp = s.hp[f];
    // Sleep turns: free hits for the awake side.
    if (s.st[f] === 'slp' && s.slp[f] > 0) foeHp -= mine.hit * this.actChance(s, a) * s.slp[f];
    if (s.st[a] === 'slp' && s.slp[a] > 0) myHp -= theirs.hit * this.actChance(s, f) * s.slp[a];
    if (foeHp <= 0 && myHp > 0) return { win: true, hpLeft: myHp, dealt: s.hp[f] };
    if (myHp <= 0) return { win: false, hpLeft: 0, dealt: s.hp[f] - Math.max(0, foeHp) };
    const first = mine.prio !== theirs.prio ? mine.prio > theirs.prio : this.speed(s, a) > this.speed(s, f);
    const myTurns = myHit > 0 ? Math.ceil(foeHp / myHit) : Infinity;
    const theirTurns = theirHit > 0 ? Math.ceil(myHp / theirHit) : Infinity;
    const win = myTurns !== Infinity && (first ? myTurns <= theirTurns : myTurns < theirTurns);
    if (win) return { win, hpLeft: Math.max(0, myHp - (first ? myTurns - 1 : myTurns) * theirHit), dealt: s.hp[f] };
    const dealtNow = Math.min(foeHp, (theirTurns === Infinity ? 0 : first ? theirTurns : theirTurns - 1) * myHit);
    return { win, hpLeft: 0, dealt: s.hp[f] - foeHp + dealtNow };
  }

  private aliveMine(s: S): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.nMine; i++) if (s.hp[i] > 0) out.push(i);
    return out;
  }

  /** Leaf value on the 0–100 projection scale. */
  leaf(s: S): number {
    const F0 = this.nMine;
    const alive = this.aliveMine(s);
    const dealtRoot = (extra: number) => (this.rootFoeHp > 0 ? (100 * Math.min(this.rootFoeHp, this.rootFoeHp - s.hp[F0] + extra)) / this.rootFoeHp : 0);
    if (!alive.length) return 0.45 * dealtRoot(0);
    let me = s.me;
    if (s.hp[me] <= 0) {
      // Your best replacement comes in for free.
      let best = alive[0];
      let bestV = -1;
      for (const b of alive) {
        const t = this.switched(s, b);
        const v = s.foe >= 0 ? (() => { const p = this.proj(t, b, t.foe); return p.win ? 55 + p.hpLeft : p.dealt; })() : s.hp[b];
        if (v > bestV) { bestV = v; best = b; }
      }
      s = this.switched(s, best);
      me = best;
    }
    let v: number;
    if (s.hp[F0] <= 0) {
      const hp = s.hp[me];
      const quick = s.f0t === 1 ? 10 : s.f0t === 2 ? 3 : 0;
      let sweep = 6 * Math.max(0, s.kos - 1);
      if (s.foe >= 0) {
        const p = this.proj(s, me, s.foe);
        if (p.win) sweep += Math.min(10, 2 + (0.45 * p.hpLeft) / 4);
      }
      v = 55 + 0.45 * hp + quick + Math.min(20, sweep);
      if (s.lost > 0) v = Math.min(54, 45 + 0.09 * hp);
    } else {
      const p = this.proj(s, me, F0);
      v = p.win ? 55 + 0.45 * p.hpLeft : 0.45 * dealtRoot(p.dealt);
      if (p.win && s.lost > 0) v = Math.min(54, 45 + 0.09 * p.hpLeft);
    }
    return Math.max(0, v);
  }

  /* ---------------- transitions ---------------- */

  private switched(s: S, to: number): S {
    const t = cloneS(s);
    t.me = to;
    t.mb = zeros();
    t.mc = 0;
    t.mFE = false;
    t.mFirst = true;
    return t;
  }

  private applyBoosts(t: S, side: 0 | 1, b: Boosts) {
    const arr = side === 0 ? t.mb : t.fb;
    BK.forEach((k, i) => { if (b[k]) arr[i] = clampStage(arr[i] + b[k]!); });
  }

  private setStatus(t: S, id: number, st: SecStatus | 'slp') {
    t.st[id] = st;
    t.slp[id] = st === 'slp' ? SLEEP_TURNS : 0;
  }

  /** One side uses a move. `strictlyFirst`: it moves before the other this turn (flinch works). */
  private act(s: S, side: 0 | 1, moveId: string | undefined, strictlyFirst: boolean): (Child & { flinch?: boolean })[] {
    const aId = side === 0 ? s.me : s.foe;
    const dId = side === 0 ? s.foe : s.me;
    if (!moveId || aId < 0 || dId < 0 || s.hp[aId] <= 0 || s.hp[dId] <= 0) return [{ p: 1, s }];
    const t = cloneS(s);
    if (t.st[aId] === 'slp') {
      if (t.slp[aId] > 0) {
        t.slp[aId]--;
        return [{ p: 1, s: t }];
      }
      t.st[aId] = '';
    }
    const first = side === 0 ? t.mFirst : t.fFirst;
    const fx = moveFx(this.ds, moveId);
    if (fx.firstTurnOnly && !first) return [{ p: 1, s: t }];
    const a = this.actChance(t, aId);
    if (side === 0 && t.mc > 0) t.mc--;
    if (side === 1 && t.fc > 0) t.fc--;
    const mv = this.ds.moves[moveId];
    const ab = side === 0 ? t.mb : t.fb;
    const db = side === 0 ? t.fb : t.mb;
    const A = this.mons[aId];
    const D = this.mons[dId];

    if (mv.category === 'Status') {
      const e = supportEffect(this.ds, moveId);
      if (!e || !searchableEffect(e)) return [{ p: 1, s: t }];
      if (side === 1) t.fUsed |= 1 << Math.max(0, this.mons[aId].support.indexOf(moveId));
      const self = e.kind === 'boost';
      const accRaw = mv.accuracy;
      const acc = self || accRaw === true || typeof accRaw !== 'number' ? 1 : Math.min(1, (accRaw / 100) * accuracyStageMul(ab[5] - db[6]));
      if (e.kind === 'status' && !canGetStatus(D.calc, e.status, mv.type, A.calc, t.st[dId])) return [{ p: 1, s: t }];
      const ok = cloneS(t);
      if (e.kind === 'boost') this.applyBoosts(ok, side, e.self);
      else if (e.kind === 'debuff') this.applyBoosts(ok, side === 0 ? 1 : 0, e.target);
      else if (e.kind === 'status') this.setStatus(ok, dId, e.status);
      const p = a * acc;
      return p >= 1 ? [{ p: 1, s: ok }] : [{ p, s: ok }, { p: 1 - p, s: t }];
    }

    const fe = side === 0 ? t.mFE : t.fFE;
    const dd = this.dist(aId, dId, moveId, ab, db, t.st[aId], fe);
    if (!dd) return [{ p: 1, s: t }];
    const h = t.hp[dId];
    const pHit = a * this.hitChance(dd, moveId, ab[5] - db[6]);
    const frac = (xs: number[]) => {
      let ko = 0;
      let sum = 0;
      for (const x of xs) if (x >= h) ko++; else sum += x;
      return { ko: ko / xs.length, sum: sum / xs.length };
    };
    const fn = frac(dd.n);
    const fc = dd.crit > 0 ? frac(dd.c) : fn;
    const pKO = pHit * ((1 - dd.crit) * fn.ko + dd.crit * fc.ko);
    const pHS = pHit * ((1 - dd.crit) * (1 - fn.ko) + dd.crit * (1 - fc.ko));
    const eDmg = pKO < 1 ? (pHit * ((1 - dd.crit) * fn.sum + dd.crit * fc.sum)) / (1 - pKO) : 0;

    const after = (u: S, dmg: number, hit: number) => {
      // Drain / recoil in the attacker's own %, user stat changes that always happen.
      const raw = (dmg / 100) * D.maxHp;
      if (fx.drain) u.hp[aId] = Math.min(100, u.hp[aId] + (100 * raw * fx.drain) / A.maxHp);
      if (fx.recoil && A.calc.ability !== 'Rock Head' && A.calc.ability !== 'Magic Guard') u.hp[aId] -= (100 * raw * fx.recoil) / A.maxHp;
      if (hit >= 0.5 && fx.userDrop) this.applyBoosts(u, side, fx.userDrop);
      if (hit >= 0.5 && fx.userRaise && fx.userRaise.chance * fxChanceMul(A.calc, D.calc) >= 1) this.applyBoosts(u, side, fx.userRaise.boosts);
    };
    const out: (Child & { flinch?: boolean })[] = [];
    if (pKO > 0) {
      const k = cloneS(t);
      k.hp[dId] = 0;
      after(k, h, 1);
      out.push({ p: pKO, s: k, note: 'ko' });
    }
    if (pKO < 1) {
      const n = cloneS(t);
      n.hp[dId] = h - eDmg;
      after(n, eDmg, pHS / (1 - pKO));
      // Sure effects (Icy Wind, Nuzzle) land; a single chance effect gets its own branch.
      const mul = fxChanceMul(A.calc, D.calc);
      const surviving = pHS / (1 - pKO);
      let branch: { q: number; apply: (u: S) => void; flinch?: boolean } | undefined;
      if (mul > 0 && surviving > 0) {
        const cands: { q: number; apply: (u: S) => void; flinch?: boolean; rank: number }[] = [];
        if (fx.flinch && strictlyFirst && canFlinch(D.calc)) cands.push({ q: Math.min(1, fx.flinch * mul), apply: () => {}, flinch: true, rank: 5 });
        for (const x of fx.status) {
          if (!canGetStatus(D.calc, x.status, mv.type, A.calc, n.st[dId])) continue;
          cands.push({ q: Math.min(1, x.chance * mul), apply: (u) => this.setStatus(u, dId, x.status), rank: x.status === 'slp' || x.status === 'frz' ? 4 : x.status === 'par' ? 3 : 2 });
        }
        if (fx.confuse && !(side === 0 ? n.fc : n.mc)) cands.push({ q: Math.min(1, fx.confuse * mul), apply: (u) => { if (side === 0) u.fc = CONFUSE_TURNS; else u.mc = CONFUSE_TURNS; }, rank: 2 });
        if (fx.targetDrop) cands.push({ q: Math.min(1, fx.targetDrop.chance * mul), apply: (u) => this.applyBoosts(u, side === 0 ? 1 : 0, fx.targetDrop!.boosts), rank: 1 });
        if (fx.userRaise && fx.userRaise.chance * mul < 1) cands.push({ q: fx.userRaise.chance * mul, apply: (u) => this.applyBoosts(u, side, fx.userRaise!.boosts), rank: 0 });
        for (const c of cands) if (c.q >= 1 && !c.flinch) c.apply(n);
        const chance = cands.filter((c) => c.q < 1 || c.flinch).sort((x, y) => y.rank - x.rank || y.q - x.q)[0];
        if (chance) branch = chance;
      }
      const pBranch = branch ? pHS * branch.q : 0;
      if (branch && pBranch >= MIN_P) {
        const e = cloneS(n);
        branch.apply(e);
        out.push({ p: pBranch, s: e, flinch: branch.flinch, note: branch.flinch ? 'flinch' : 'fx' });
        out.push({ p: 1 - pKO - pBranch, s: n });
      } else out.push({ p: 1 - pKO, s: n });
    }
    return out.filter((c) => c.p > 0);
  }

  /** End of turn: burn / poison chip, faints, their next Pokémon comes in. */
  private endTurn(s: S, myAct: RootAction | undefined): S {
    for (const id of [s.me, s.foe]) {
      if (id < 0 || s.hp[id] <= 0) continue;
      const chip = CHIP[s.st[id]];
      if (chip && this.mons[id].calc.ability !== 'Magic Guard') s.hp[id] -= chip;
    }
    s.mFirst = myAct?.kind === 'switch';
    s.fFirst = false;
    if (s.foe >= 0 && s.hp[s.foe] <= 0) {
      s.hp[s.foe] = 0;
      s.kos++;
      if (s.foe === this.nMine && !s.f0t) s.f0t = s.turn;
      let next = -1;
      for (let i = this.nMine; i < this.mons.length; i++) if (s.hp[i] > 0) { next = i; break; }
      s.foe = next;
      s.fb = zeros();
      s.fc = 0;
      s.fFE = false;
      s.fFirst = true;
      s.fUsed = 0;
    }
    if (s.hp[s.me] <= 0) {
      s.hp[s.me] = 0;
      s.lost++;
    }
    return s;
  }

  /** Every outcome of one turn: your action, their move. */
  private resolve(s: S, mine: RootAction, theirs: string | undefined): Child[] {
    const t = cloneS(s);
    t.turn++;
    const out: Child[] = [];
    if (mine.kind === 'switch') {
      const sw = this.switched(t, mine.to);
      sw.turn = t.turn;
      for (const c of this.act(sw, 1, theirs, true)) out.push({ p: c.p, s: this.endTurn(c.s, mine), note: c.note === 'ko' ? 'lost' : undefined });
      return out;
    }
    const myMv = this.ds.moves[mine.moveId];
    const thMv = theirs ? this.ds.moves[theirs] : undefined;
    const pm = myMv?.priority ?? 0;
    const pf = thMv?.priority ?? 0;
    const meFirst = pm !== pf ? pm > pf : this.speed(t, t.me) > this.speed(t, t.foe);
    const order: [0 | 1, string | undefined][] = meFirst ? [[0, mine.moveId], [1, theirs]] : [[1, theirs], [0, mine.moveId]];
    for (const c1 of this.act(t, order[0][0], order[0][1], true)) {
      const second = order[1];
      const secondId = second[0] === 0 ? c1.s.me : c1.s.foe;
      if (c1.flinch || c1.s.hp[secondId] <= 0 || c1.s.hp[second[0] === 0 ? c1.s.foe : c1.s.me] <= 0) {
        out.push({ p: c1.p, s: this.endTurn(c1.s, mine), note: c1.note });
        continue;
      }
      for (const c2 of this.act(c1.s, second[0], second[1], false)) out.push({ p: c1.p * c2.p, s: this.endTurn(c2.s, mine), note: c2.note ?? c1.note });
    }
    return out.filter((c) => c.p >= MIN_P / 4);
  }

  /** Their reply: npcModel's guess (first turn) or the same attack weights, blended with their strongest hit. */
  replies(s: S, root: boolean): { id?: string; p: number }[] {
    if (s.foe < 0) return [{ p: 1 }];
    const F = this.mons[s.foe];
    const myHp = s.hp[s.me];
    let rows: { id: string; w: number }[];
    if (root && s.foe === this.nMine && this.prediction?.length) rows = this.prediction.map((g) => ({ id: g.moveId, w: g.prob }));
    else {
      rows = [];
      for (const id of F.attacks) {
        const dd = this.dist(s.foe, s.me, id, s.fb, s.mb, s.st[s.foe], s.fFE);
        const lo = dd ? dd.n[0] : 0;
        const hi = dd ? dd.n[dd.n.length - 1] : 0;
        rows.push({ id, w: npcAttackWeight(dd?.mean ?? 0, lo, hi, myHp) });
      }
      F.support.forEach((id, i) => {
        const e = supportEffect(this.ds, id)!;
        let w = 1.2;
        if (e.kind === 'status' && s.st[s.me]) w = 0.05;
        if (e.kind === 'boost' && BK.every((k, j) => !e.self[k] || s.fb[j] >= 6)) w = 0.05;
        if (s.fUsed & (1 << i)) w *= e.kind === 'boost' ? 0.8 : 0.5;
        rows.push({ id, w });
      });
    }
    const total = rows.reduce((a, r) => a + r.w, 0);
    if (!total) return [{ p: 1 }];
    const probs = new Map<string, number>();
    for (const r of rows) probs.set(r.id, (probs.get(r.id) ?? 0) + (1 - WORST_CASE_SHARE) * (r.w / total));
    const worst = this.bestHit(s, s.foe, s.me, false, s.fFirst).id;
    if (worst) probs.set(worst, (probs.get(worst) ?? 0) + WORST_CASE_SHARE);
    else for (const [k, v] of probs) probs.set(k, v / (1 - WORST_CASE_SHARE));
    const sorted = [...probs].sort((a, b) => b[1] - a[1]);
    const kept: [string, number][] = [];
    let cum = 0;
    for (const [id, p] of sorted) {
      if (kept.length >= 3 || (kept.length && (p < 0.08 || cum >= 0.95))) break;
      kept.push([id, p]);
      cum += p;
    }
    return kept.map(([id, p]) => ({ id, p: p / cum }));
  }

  /** Your options deeper in the tree: your strongest hit, a priority move, setup moves still worth it. */
  private myActions(s: S): RootAction[] {
    const me = this.mons[s.me];
    const out: RootAction[] = [];
    if (s.foe < 0) return out;
    const strong = this.bestHit(s, s.me, s.foe, true, s.mFirst);
    if (strong.id) out.push({ kind: 'move', moveId: strong.id });
    let prio: { id: string; hit: number } | undefined;
    for (const id of me.attacks) {
      const dd = this.dist(s.me, s.foe, id, s.mb, s.fb, s.st[s.me], s.mFE);
      if (dd && dd.prio > 0 && id !== strong.id && (!prio || dd.mean > prio.hit) && (!moveFx(this.ds, id).firstTurnOnly || s.mFirst)) prio = { id, hit: dd.mean };
    }
    if (prio) out.push({ kind: 'move', moveId: prio.id });
    if (s.me === 0) {
      for (const id of me.support) {
        const e = supportEffect(this.ds, id)!;
        if (e.kind === 'boost' && BK.every((k, j) => !e.self[k] || e.self[k]! < 0 || s.mb[j] >= 6)) continue;
        if (e.kind === 'debuff' && BK.every((k, j) => !e.target[k] || s.fb[j] <= -6)) continue;
        if (e.kind === 'status' && s.st[s.foe]) continue;
        out.push({ kind: 'move', moveId: id });
        if (out.length >= 4) break;
      }
    }
    return out;
  }

  private key(s: S, depth: number): string {
    return `${depth}|${s.me},${s.foe}|${s.hp.map((x) => Math.round(x * 4)).join(',')}|${s.st.join('')}${s.slp.join('')}|${s.mb.join('')}|${s.fb.join('')}|${s.mc}${s.fc}${+s.mFE}${+s.fFE}${+s.mFirst}${+s.fFirst}|${s.lost},${s.kos},${s.f0t},${s.fUsed}`;
  }

  /** Value of a decision node. */
  value(s: S, depth: number): number {
    if (s.foe < 0 || !this.aliveMine(s).length) return this.leaf(s);
    if (s.hp[s.me] <= 0) {
      // Replacement: free switch-in, no turn used.
      // Only your two most promising replacements are searched (by the leaf value).
      const cands = this.aliveMine(s).map((b) => ({ b, v: this.leaf(this.switched(s, b)) })).sort((x, y) => y.v - x.v).slice(0, 2);
      let best = -1;
      for (const c of cands) best = Math.max(best, this.value(this.switched(s, c.b), depth));
      return best;
    }
    if (depth <= 0 || this.nodes >= this.maxNodes) return this.leaf(s);
    const k = this.key(s, depth);
    const hit = this.memo.get(k);
    if (hit) return hit.v;
    let best = -Infinity;
    let bestA: RootAction | undefined;
    for (const a of this.myActions(s)) {
      const v = this.q(s, a, depth, false);
      if (v > best) { best = v; bestA = a; }
    }
    if (!bestA) best = this.leaf(s);
    this.memo.set(k, { v: best, best: bestA });
    return best;
  }

  /** Expected value of taking action `a` now. */
  q(s: S, a: RootAction, depth: number, root: boolean): number {
    this.nodes++;
    let v = 0;
    for (const r of this.replies(s, root)) {
      for (const c of this.resolve(s, a, r.id)) {
        this.nodes++;
        v += r.p * c.p * this.value(c.s, depth - 1);
      }
    }
    return v;
  }

  /* ---------------- root ---------------- */

  rootActions(): RootAction[] {
    const s = this.root;
    const out: RootAction[] = [];
    if (s.hp[0] > 0) {
      for (const id of [...this.mons[0].attacks, ...this.mons[0].support]) out.push({ kind: 'move', moveId: id });
    }
    for (let i = 1; i < this.nMine; i++) if (s.hp[i] > 0) out.push({ kind: 'switch', to: i });
    return out;
  }

  /** Scores every root action. A forced switch (your active fainted) scores the free switch-ins. */
  run(depth: number, actions = this.rootActions()): RootValue[] {
    const s = this.root;
    const forced = s.hp[0] <= 0;
    return actions.map((action) => {
      let v: number;
      if (forced && action.kind === 'switch') v = this.value(this.switched(s, action.to), depth);
      else {
        v = this.q(s, action, depth, true);
        if (action.kind === 'switch') v -= SWITCH_PENALTY;
      }
      return { action, score: squash(v), line: this.line(action, depth) };
    });
  }

  private label(a: RootAction): string {
    return a.kind === 'switch' ? `switch to ${this.mons[a.to].name}` : this.ds.moves[a.moveId]?.name ?? a.moveId;
  }

  /** Most likely line of play after a root action (your moves land, their most likely reply). */
  line(action: RootAction, depth: number): string | undefined {
    const forced = this.root.hp[0] <= 0;
    let s = forced && action.kind === 'switch' ? this.switched(this.root, action.to) : this.root;
    let a: RootAction | undefined = forced ? undefined : action;
    const steps: string[] = [];
    let d = depth;
    let firstTurn = true;
    while (d > 0 && s.foe >= 0 && this.aliveMine(s).length) {
      if (s.hp[s.me] <= 0) {
        // Your best replacement.
        let best = -1;
        let pick = -1;
        for (const b of this.aliveMine(s)) {
          const v = this.value(this.switched(s, b), d);
          if (v > best) { best = v; pick = b; }
        }
        s = this.switched(s, pick);
        steps.push(`${this.mons[pick].name} comes in`);
      }
      if (!a) a = this.memo.get(this.key(s, d))?.best ?? this.myActions(s)[0];
      if (!a) break;
      const r = this.replies(s, firstTurn)[0];
      const kids = this.resolve(s, a, r?.id);
      // Your hit lands: prefer the KO outcome when it is likely.
      const pick = kids.reduce((x, y) => (y.p > x.p ? y : x));
      const before = s;
      s = pick.s;
      let txt = a.kind === 'switch' ? `${this.label(a)[0].toUpperCase()}${this.label(a).slice(1)}` : this.label(a);
      if (before.foe >= 0 && s.foe !== before.foe) txt += ` KOs ${this.mons[before.foe].name}`;
      steps.push(txt);
      a = undefined;
      d--;
      firstTurn = false;
    }
    if (!steps.length) return undefined;
    // After the last step: does it beat what's left?
    // Past the search horizon, the same 1v1 projection carries on: your HP and boosts stay, each of
    // their Pokémon comes in fresh, in order, until one beats you.
    const beaten: string[] = [];
    if (s.foe >= 0 && s.hp[s.me] > 0) {
      let t = s;
      while (t.foe >= 0) {
        const p = this.proj(t, t.me, t.foe);
        if (!p.win) break;
        beaten.push(this.mons[t.foe].name);
        t = cloneS(t);
        t.hp[t.foe] = 0;
        t.hp[t.me] = p.hpLeft;
        let next = -1;
        for (let i = this.nMine; i < this.mons.length; i++) if (t.hp[i] > 0) { next = i; break; }
        t.foe = next;
        t.fb = zeros();
      }
    }
    const total = this.mons.length - this.nMine;
    const allDown = s.kos + beaten.length === total;
    const lastMove = [...steps].reverse().find((x) => !/comes in$/.test(x))?.replace(/ KOs .+$/, '');
    let tail = '';
    if (allDown && total >= 2 && lastMove && !/^Switch to/.test(lastMove)) {
      // Keep the moves up to the repeated attack: "Swords Dance → Brick Break KOs both remaining".
      while (steps.length > 1 && steps[steps.length - 1].replace(/ KOs .+$/, '') === steps[steps.length - 2].replace(/ KOs .+$/, '')) steps.pop();
      steps[steps.length - 1] = `${steps[steps.length - 1].replace(/ KOs .+$/, '')} KOs ${total === 2 ? 'both' : `all ${total}`} remaining`;
    } else if (beaten.length) tail = `, then beats ${beaten.join(', ')}`;
    return steps.join(' → ') + tail;
  }

  /* ---------------- odds for the reason line ---------------- */

  /**
   * Chance one hit KOs this turn from the current HP, and the part only a crit gives.
   * `side` 0 = you hit their active, 1 = they hit `target` (your active by default, or a switch-in).
   */
  hitOdds(side: 0 | 1, moveId: string, target?: number): { ko: number; critKo: number; crit: number } | undefined {
    const s = this.root;
    const a = side === 0 ? s.me : s.foe;
    const d = target ?? (side === 0 ? s.foe : s.me);
    const ab = side === 0 ? s.mb : s.fb;
    const db = side === 0 ? s.fb : d === s.me ? s.mb : zeros();
    const dd = this.dist(a, d, moveId, ab, db, s.st[a], side === 0 ? s.mFE : s.fFE);
    if (!dd) return undefined;
    const h = s.hp[d];
    const pHit = this.actChance(s, a) * this.hitChance(dd, moveId, ab[5] - db[6]);
    const f = (xs: number[]) => xs.filter((x) => x >= h).length / xs.length;
    const fn = f(dd.n);
    const fc = dd.crit > 0 ? f(dd.c) : fn;
    return { ko: pHit * ((1 - dd.crit) * fn + dd.crit * fc), critKo: pHit * dd.crit * Math.max(0, fc - fn), crit: dd.crit };
  }

  /** Their chance to KO your active (or a switch-in) this turn with the reply distribution, and the crit-only part. */
  threatOdds(target?: number): { ko: number; critKo: number } {
    let ko = 0;
    let critKo = 0;
    const s = target !== undefined ? this.switched(this.root, target) : this.root;
    for (const r of this.replies(s, true)) {
      if (!r.id || this.ds.moves[r.id]?.category === 'Status') continue;
      const o = this.hitOdds(1, r.id, target);
      if (!o) continue;
      ko += r.p * o.ko;
      critKo += r.p * o.critKo;
    }
    return { ko, critKo };
  }

  /** You strictly outspeed them this turn with this move (flinch works only then). */
  youFirst(moveId: string, theirMove?: string): boolean {
    const s = this.root;
    const pm = this.ds.moves[moveId]?.priority ?? 0;
    const pf = theirMove ? this.ds.moves[theirMove]?.priority ?? 0 : 0;
    return pm !== pf ? pm > pf : this.speed(s, s.me) > this.speed(s, s.foe);
  }
}

/**
 * Raw values above 90 (a quick KO with lots of HP left: 55 + 0.45 × HP + 10) are squashed into
 * 90–100 instead of clipped, so "KO now" still ranks above "KO next turn" near the top.
 */
export function squash(v: number): number {
  if (v <= 90) return Math.max(0, v);
  return 90 + 10 * (1 - Math.exp(-(v - 90) / 10));
}

/** Support effects the lookahead plays out itself (others keep the plan-B scoring of supportMoves.ts). */
function searchableEffect(e: SupportEffect): boolean {
  return e.kind === 'boost' || e.kind === 'debuff' || (e.kind === 'status' && !e.yawn);
}

export function searchable(ds: Dataset, moveId: string): boolean {
  const e = supportEffect(ds, moveId);
  return !!e && searchableEffect(e);
}

/**
 * Runs the lookahead: `depth` turns (2 by default), deepened to 3 when the tree is small.
 * Returns the engine (for odds) and a score per root action.
 */
export function runLookahead(input: LookInput): { engine: Lookahead; values: RootValue[]; depth: number } {
  const depth = input.depth ?? 2;
  const engine = new Lookahead(input);
  let values = engine.run(depth);
  let used = depth;
  // Small trees (few options, few replies): one more turn fits the budget.
  if (input.depth === undefined && engine.nodes < 400) {
    const deeper = new Lookahead({ ...input, maxNodes: input.maxNodes ?? 6000 });
    const v3 = deeper.run(3);
    if (deeper.nodes < (input.maxNodes ?? 6000)) {
      values = v3;
      used = 3;
      return { engine: deeper, values, depth: used };
    }
  }
  return { engine, values, depth: used };
}
