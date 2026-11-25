import type { Field, Pokemon as CalcPokemon } from '@smogon/calc';
import type { BoostKey, Boosts } from '../shared/battle';
import type { Dataset } from '../shared/types';
import { damageRolls, holdsOn } from './damage';
import { canFlinch, canGetStatus, critInfo, fxChanceMul, moveFx, type SecStatus } from './moveEffects';
import { npcAttackWeight } from './npcModel';
import { accuracyStageMul, stageMul } from './projection';
import { friendshipMax, friendshipSurvival } from './friendship';
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
 * After `depth` turns the leaf counts both teams: HP taken and KOs scored minus HP and Pokémon lost, with the
 * rest of the battle played out as 1v1 projections (leaf()). The ranking uses only that balance. The number
 * shown keeps the old 0–100 scale (55+ = their current Pokémon falls at a fair price), so lookahead scores
 * still sort with the item rows. A KO'd NPC Pokémon is replaced by the next one in team order (boosts you set
 * up carry over: "set up now, sweep next turn"); a fainted Pokémon of yours by your best bench Pokémon for free.
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
  /** Your side only, and only in battles that have it (see friendship.ts); undefined = no effects. */
  friendship?: number;
  /** Your side only: fainted now (0 HP); `calc` is at the HP a Revive would give. */
  fainted?: boolean;
}

export interface LookInput {
  ds: Dataset;
  field?: Field;
  /** [0] = your active Pokémon (may be fainted: forced switch), then your healthy bench, then the fainted ones a Revive could bring back. */
  mine: LookMon[];
  /** [0] = their active Pokémon, then the ones still to come, in the order they come in (a guess). */
  foes: LookMon[];
  myBoosts?: Boosts;
  foeBoosts?: Boosts;
  focusEnergy?: { me?: boolean; foe?: boolean };
  /** Each side's active Pokémon has not moved yet since it came in (Fake Out works). */
  firstTurn?: { me?: boolean; foe?: boolean };
  /** Truant: each side's active Pokémon loafs on the coming turn. */
  loafing?: { me?: boolean; foe?: boolean };
  /** npcModel's guess for their active Pokémon vs your active one (the first reply). */
  prediction?: { moveId: string; prob: number }[];
  /** Turns to look ahead (2 = this turn and the next). */
  depth?: number;
  /** Search size cap (decision + chance nodes). */
  maxNodes?: number;
  /** Multiplier on their hits (World Boss: 0.45, Eternamax 0.30). */
  foeHitMult?: number;
}

export type RootAction = { kind: 'move'; moveId: string } | { kind: 'switch'; to: number };
/** Using a Revive takes the turn; searched only while revive() rates one. */
type Action = RootAction | { kind: 'revive'; to: number; hp: number };

export interface RootValue {
  action: RootAction;
  /** 0–100 (55+ = their current Pokémon falls at a fair price), in the order of the team balance. */
  score: number;
  /** Team balance that orders the actions (both teams' HP and Pokémon, whole battle). */
  rank: number;
  /** Line of play, e.g. "Swords Dance → Earthquake KOs both remaining". */
  line?: string;
}

/** Share of the NPC's reply that is its strongest hit regardless of the guess (npcModel rests on few observations). */
export const WORST_CASE_SHARE = 0.25;
/** Switching gives up a turn: same −8 the old switch rows used, so a good attack wins ties. */
export const SWITCH_PENALTY = 8;
/** Leaf: what a Pokémon is worth on top of its HP (0–100) for still being alive. Measured with scripts/audit. */
const ALIVE = 50;
/** Leaf: 1v1s projected at most (who comes in next is a guess, and each one costs damage calcs). */
const DUELS = 12;
/**
 * When an NPC uses medicine: a player's report from real battles (2026-11-25): at risk of a KO, under half HP, "could
 * be lower, maybe 30-40". Only a warning: scores that counted on the heal did not pay off in simulated battles (PLAN).
 */
const HEALS_BELOW = 50;
/** Balance points per HP % (same slope as the 1v1 projection's 0.45 × HP left). */
const PER_HP = 0.45;
/** Setup on a line that already wins costs a small tie-break (an NPC switch or a miss we don't see). */
export const SETUP_TIEBREAK = 2;

/**
 * Score of a support move from its lookahead value and your best attack's (both unrounded), with
 * 4a's rule: a support move that doesn't beat attacking now stays clearly below it and out of the
 * win band (≤ min(50, best attack − 10)). Shared by adviseTurn and the 4a agreement test.
 */
export function setupScore(value: number, bestAttack: number): { score: number; better: boolean } {
  const v = value - (value >= 55 ? SETUP_TIEBREAK : 0);
  // Better by at least a point, so it never shows the same number as the attack it claims to beat.
  const better = bestAttack < 0 || v >= bestAttack + 1;
  return { score: Math.max(0, Math.min(100, better ? v : Math.min(v, bestAttack - 10, 50))), better };
}
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
  /** Friendship: chance a KO hit leaves it at 1 HP; max = crit ×2 and their moves −10 accuracy. */
  survive: number;
  maxFriend: boolean;
  /** Truant: moves every other turn (the cycle restarts when it comes in; alternation seen live 2026-11-25). */
  truant: boolean;
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
  /** Truant: the active Pokémon loafs next time it would move. */
  mLoaf: boolean;
  fLoaf: boolean;
  /** Your Pokémon that fainted in this line. */
  lost: number;
  /** Their Pokémon KO'd in this line. */
  kos: number;
  /** Turn their first Pokémon went down (0 = still up). */
  f0t: number;
  /** What your side had lost when their first Pokémon went down. */
  f0loss: number;
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

/** `v` ranks the lines (both teams' balance); `shown` is what is displayed for the best one (0–100 scale). */
interface Value {
  v: number;
  shown: number;
}

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
  private readonly hits = new Map<string, { id?: string; hit: number; prio: number }>();
  private memo = new Map<string, Value & { best?: Action }>();
  /** The Revive being rated: lines that attack first may still use it on a later turn. */
  private reviving?: { to: number; hp: number };
  /** Search size cap (nodes counted over the engine's life; raised for the depth-3 pass). */
  maxNodes: number;
  foeHitMult: number;
  nodes = 0;
  calcs = 0;

  constructor(input: LookInput) {
    this.ds = input.ds;
    this.field = input.field;
    this.prediction = input.prediction;
    this.maxNodes = input.maxNodes ?? 6000;
    this.foeHitMult = input.foeHitMult ?? 1;
    const mk = (m: LookMon, side: 0 | 1, first: boolean): Mon => {
      const work = m.calc.clone();
      const def = m.asDefender ?? m.calc;
      const isStatus = (id: string) => this.ds.moves[id]?.category === 'Status';
      return {
        name: m.name, side, calc: m.calc, def, work, workDef: def === m.calc ? work : def.clone(),
        maxHp: m.calc.maxHP(),
        attacks: m.moves.filter((id) => this.ds.moves[id] && !isStatus(id)),
        support: first || side === 1 ? m.moves.filter((id) => isStatus(id) && searchable(this.ds, id)) : [],
        survive: side === 0 ? friendshipSurvival(m.friendship) : 0,
        maxFriend: side === 0 && friendshipMax(m.friendship),
        truant: m.calc.ability === 'Truant',
      };
    };
    this.mons = [...input.mine.map((m, i) => mk(m, 0, i === 0)), ...input.foes.map((m) => mk(m, 1, false))];
    this.nMine = input.mine.length;
    const down = [...input.mine, ...input.foes].map((m) => !!m.fainted);
    const hp = this.mons.map((m, i) => (down[i] ? 0 : (100 * m.calc.curHP()) / m.maxHp));
    const st = this.mons.map((m) => (m.calc.status as string) || '');
    this.root = {
      hp, st, slp: st.map((x) => (x === 'slp' ? SLEEP_SHOWN : 0)),
      me: 0, foe: this.nMine,
      mb: toArr(input.myBoosts), fb: toArr(input.foeBoosts), mc: 0, fc: 0,
      mFE: !!input.focusEnergy?.me, fFE: !!input.focusEnergy?.foe,
      mFirst: !!input.firstTurn?.me, fFirst: !!input.firstTurn?.foe,
      mLoaf: !!input.loafing?.me, fLoaf: !!input.loafing?.foe,
      lost: 0, kos: 0, f0t: 0, f0loss: 0, turn: 0, fUsed: 0,
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
      const k = A.side === 1 ? this.foeHitMult : 1; // World Boss: its hits are cut
      const n = rolls.map((x) => (100 * x * k) / hp);
      const ci = critInfo(this.ds, atk, def, moveId, aFE);
      let c = n;
      let crit = ci.always ? 0 : A.maxFriend ? Math.min(1, ci.chance * 2) : ci.chance; // Friendship 255: crit chance ×2
      if (crit > 0) {
        // A crit ignores your negative stages and their positive ones: with none of those, it's just ×1.5.
        if (ab[0] >= 0 && ab[2] >= 0 && db[1] <= 0 && db[3] <= 0) c = n.map((x) => Math.floor(x * ci.mul * 100) / 100);
        else {
          this.calcs++;
          const cr = damageRolls(this.ds, atk, def, moveId, this.field, true);
          c = cr ? cr.map((x) => (100 * x * k) / hp) : n.map((x) => x * ci.mul);
        }
      } else crit = 0;
      const mv = this.ds.moves[moveId];
      const accRaw = mv.accuracy;
      const acc = accRaw === true || typeof accRaw !== 'number' || accRaw <= 0 ? 1 : this.accVs(D, accRaw) / 100;
      const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
      out = { n, c, crit, acc, prio: mv.priority ?? 0, mean: ((1 - crit) * avg(n) + crit * avg(c)) * acc };
    }
    this.dists.set(key, out);
    return out;
  }

  /**
   * Base accuracy of a move aimed at `d`: your Pokémon at Friendship 255 takes 10 points off ("lose 10
   * accuracy": subtractive points, not ×0.9, and before stages: guesses). Never-miss moves don't get here.
   */
  private accVs(d: Mon, acc: number): number {
    return d.maxFriend ? Math.max(0, acc - 10) : acc;
  }

  /** Sturdy / Focus Sash at full HP (see holdsOn). */
  private holds(a: number, d: number, moveId: string | undefined, h: number): boolean {
    return !!moveId && h >= 100 - 1e-6 && !!holdsOn(this.ds, this.mons[a].calc, this.mons[d].def, moveId);
  }

  /** 1 HP in % of max HP: Friendship survival leaves your Pokémon here (no roll when already at it, a guess). */
  private survives(d: Mon, h: number): number {
    return d.survive > 0 && h > 100 / d.maxHp + 1e-9 ? d.survive : 0;
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
    const key = `${a}>${d}:${ab[0]},${ab[2]},${ab[4]},${ab[5]}:${db[1]},${db[3]},${db[4]},${db[6]}:${s.st[a]}:${+fe}${+withAcc}${+firstTurn}`;
    const known = this.hits.get(key);
    if (known) return known;
    let best = { id: undefined as string | undefined, hit: 0, prio: 0 };
    for (const id of A.attacks) {
      if (moveFx(this.ds, id).firstTurnOnly && !firstTurn) continue;
      const dd = this.dist(a, d, id, ab, db, s.st[a], fe);
      if (!dd) continue;
      const hit = withAcc ? dd.mean * this.hitChance(dd, id, ab[5] - db[6]) / dd.acc : dd.mean / dd.acc;
      if (hit > best.hit) best = { id, hit, prio: dd.prio };
    }
    this.hits.set(key, best);
    return best;
  }

  /* ---------------- leaf: the 1v1 projection ---------------- */

  /** Same rules as project(): both keep using their best hit; a tie in speed counts against you. */
  private proj(s: S, a: number, f: number): { win: boolean; hpLeft: number; dealt: number; turns: number } {
    const mine = this.bestHit(s, a, f, true);
    const theirs = this.bestHit(s, f, a, false);
    const mineBy = this.dealtBy(mine.hit * this.actChance(s, a), CHIP[s.st[f]] ?? 0, this.mons[a].truant, a === s.me && s.mLoaf);
    const theirsBy = this.dealtBy(theirs.hit * this.actChance(s, f), CHIP[s.st[a]] ?? 0, this.mons[f].truant, f === s.foe && s.fLoaf);
    let myHp = s.hp[a];
    let foeHp = s.hp[f];
    // Sleep turns: free hits for the awake side.
    if (s.st[f] === 'slp' && s.slp[f] > 0) foeHp -= mine.hit * this.actChance(s, a) * s.slp[f];
    if (s.st[a] === 'slp' && s.slp[a] > 0) myHp -= theirs.hit * this.actChance(s, f) * s.slp[a];
    if (foeHp <= 0 && myHp > 0) return { win: true, hpLeft: myHp, dealt: s.hp[f], turns: s.slp[f] };
    if (myHp <= 0) return { win: false, hpLeft: 0, dealt: s.hp[f] - Math.max(0, foeHp), turns: s.slp[a] };
    const first = mine.prio !== theirs.prio ? mine.prio > theirs.prio : this.speed(s, a) > this.speed(s, f);
    let myTurns = mineBy.turns(foeHp);
    let theirTurns = theirsBy.turns(myHp);
    if (myTurns === 1 && this.holds(a, f, mine.id, foeHp)) myTurns = 2;
    if (theirTurns === 1 && this.holds(f, a, theirs.id, myHp)) theirTurns = 2;
    const win = myTurns !== Infinity && (first ? myTurns <= theirTurns : myTurns < theirTurns);
    if (win) return { win, hpLeft: Math.max(0, myHp - theirsBy.in(first ? myTurns - 1 : myTurns)), dealt: s.hp[f], turns: myTurns };
    const dealtNow = Math.min(foeHp, theirTurns === Infinity ? 0 : mineBy.in(first ? theirTurns : theirTurns - 1));
    return { win, hpLeft: 0, dealt: s.hp[f] - foeHp + dealtNow, turns: theirTurns };
  }

  /** Damage over several turns of the same best hit, plus status chip; Truant hits only every other turn. */
  private dealtBy(hit: number, chip: number, truant: boolean, loaf: boolean): { in: (t: number) => number; turns: (hp: number) => number } {
    const per = hit + chip;
    if (!truant) return { in: (t) => t * per, turns: (hp) => (per > 0 ? Math.ceil(hp / per) : Infinity) };
    const dealt = (t: number) => hit * (loaf ? Math.floor(t / 2) : Math.ceil(t / 2)) + chip * t;
    return {
      in: dealt,
      turns: (hp) => {
        if (per <= 0) return Infinity;
        let t = 1;
        while (dealt(t) < hp) t++;
        return t;
      },
    };
  }

  private aliveMine(s: S): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.nMine; i++) if (s.hp[i] > 0) out.push(i);
    return out;
  }

  /**
   * Leaf value: HP % and Pokémon you took minus those you lost since the root, then the battle played on as 1v1
   * projections (each loser replaced: yours by the best one, free; theirs by the next in order).
   */
  private leaf(s: S): Value {
    const F0 = this.nMine;
    let lost = this.down(s, 0);
    const taken = this.down(s, 1);
    const quick = s.f0t === 1 ? 4 : s.f0t === 2 ? 1 : 0;
    /** What you had lost when their first Pokémon fell. */
    let f0loss = s.hp[F0] <= 0 ? s.f0loss : undefined;
    let v = PER_HP * (taken - lost) + quick;
    let t = cloneS(s);
    for (let n = 0; n < DUELS && t.foe >= 0; n++) {
      if (t.hp[t.me] <= 0) {
        let best = -1;
        let bestV = -Infinity;
        for (const b of this.aliveMine(t)) {
          const u = this.switched(t, b);
          const p = this.proj(u, b, u.foe);
          const x = p.win ? ALIVE + u.hp[u.foe] - (u.hp[b] - p.hpLeft) : p.dealt - u.hp[b] - ALIVE;
          if (x > bestV) { bestV = x; best = b; }
        }
        if (best < 0) break;
        t = this.switched(t, best);
      }
      const p = this.proj(t, t.me, t.foe);
      const cost = this.root.hp[t.me] <= 0 ? 0 : t.hp[t.me] - p.hpLeft + (p.win ? 0 : ALIVE);
      const gain = p.dealt + (p.win ? ALIVE : 0);
      lost += cost;
      v += PER_HP * (gain - cost);
      t.hp[t.me] = p.hpLeft;
      const odd = p.turns % 2 === 1;
      if (p.win) {
        if (odd && this.mons[t.me].truant) t.mLoaf = !t.mLoaf;
        if (t.foe === F0) f0loss = lost;
        this.nextFoe(t);
      } else {
        if (odd && this.mons[t.foe].truant) t.fLoaf = !t.fLoaf;
        t.hp[t.foe] = Math.max(0.5, t.hp[t.foe] - p.dealt);
      }
    }
    // Shown number: 100 = their first Pokémon falls at no cost, 55 = at the cost of 100 points; what comes after it
    // moves the number by up to 10.
    const price = (l: number) => (l <= 100 ? 55 + PER_HP * (100 - l) : (55 * 100) / l) + quick;
    if (f0loss !== undefined) {
      const after = v - quick - PER_HP * (this.rootFoeHp + ALIVE - f0loss);
      return { v, shown: price(f0loss) + Math.max(-10, Math.min(10, after / 10)) };
    }
    // All of yours go down first.
    const dealt = this.rootFoeHp > 0 ? Math.max(0, this.rootFoeHp - t.hp[F0]) / this.rootFoeHp : 0;
    return { v, shown: Math.min(PER_HP * 100 * dealt, price(lost)) };
  }

  /**
   * HP % and Pokémon (ALIVE each) one side lost since the root (drain heals count back). One that was down at the
   * root (a Revive) counts for nothing here: it is worth the KOs it goes on to make and the teammates it spares.
   */
  private down(s: S, side: 0 | 1): number {
    let x = 0;
    for (let i = side ? this.nMine : 0; i < (side ? this.mons.length : this.nMine); i++) {
      const from = this.root.hp[i];
      if (from <= 0) continue;
      const now = Math.max(0, s.hp[i]);
      x += from - now + (now <= 0 ? ALIVE : 0);
    }
    return x;
  }

  /** Their active Pokémon is low enough for an NPC to heal it, and your best hit can KO it on its top roll (both guesses). */
  mayHeal(): boolean {
    const s = this.root;
    if (s.hp[s.foe] >= HEALS_BELOW || s.hp[s.me] <= 0) return false;
    const best = this.bestHit(s, s.me, s.foe, false, s.mFirst).id;
    const dd = best ? this.dist(s.me, s.foe, best, s.mb, s.fb, s.st[s.me], s.mFE) : null;
    return !!dd && dd.n[dd.n.length - 1] >= s.hp[s.foe];
  }

  /** Their active Pokémon is down: the next one in team order comes in fresh. */
  private nextFoe(t: S) {
    t.hp[t.foe] = 0;
    let next = -1;
    for (let i = this.nMine; i < this.mons.length; i++) if (t.hp[i] > 0) { next = i; break; }
    t.foe = next;
    t.fb = zeros();
    t.fc = 0;
    t.fFE = false;
    t.fFirst = true;
    t.fLoaf = false;
    t.fUsed = 0;
  }

  /* ---------------- transitions ---------------- */

  private switched(s: S, to: number): S {
    const t = cloneS(s);
    t.me = to;
    t.mb = zeros();
    t.mc = 0;
    t.mFE = false;
    t.mFirst = true;
    t.mLoaf = false;
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
    if (this.mons[aId].truant) {
      const loaf = side === 0 ? t.mLoaf : t.fLoaf;
      if (side === 0) t.mLoaf = !loaf;
      else t.fLoaf = !loaf;
      if (loaf) return [{ p: 1, s: t }];
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
      const acc = self || accRaw === true || typeof accRaw !== 'number' ? 1 : Math.min(1, (this.accVs(D, accRaw) / 100) * accuracyStageMul(ab[5] - db[6]));
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
      // Friendship (your side): part of the KO leaves it at 1 HP. Guess: any KO hit, every time it happens.
      const q = this.holds(aId, dId, moveId, h) ? 1 : side === 1 ? this.survives(D, h) : 0;
      const pLive = pKO * q >= MIN_P ? pKO * q : 0;
      if (pLive > 0) {
        const one = 100 / D.maxHp;
        const l = cloneS(t);
        l.hp[dId] = one;
        after(l, h - one, 1);
        out.push({ p: pLive, s: l });
      }
      const k = cloneS(t);
      k.hp[dId] = 0;
      after(k, h, 1);
      out.push({ p: pKO - pLive, s: k, note: 'ko' });
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
  private endTurn(s: S, myAct: Action | undefined): S {
    for (const id of [s.me, s.foe]) {
      if (id < 0 || s.hp[id] <= 0) continue;
      const chip = CHIP[s.st[id]];
      if (chip && this.mons[id].calc.ability !== 'Magic Guard') s.hp[id] -= chip;
    }
    s.mFirst = myAct?.kind === 'switch';
    s.fFirst = false;
    if (s.foe >= 0 && s.hp[s.foe] <= 0) {
      s.kos++;
      if (s.foe === this.nMine && !s.f0t) {
        s.f0t = s.turn;
        s.f0loss = this.down(s, 0);
      }
      this.nextFoe(s);
    }
    if (s.hp[s.me] <= 0) {
      s.hp[s.me] = 0;
      s.lost++;
    }
    return s;
  }

  /** Every outcome of one turn: your action, their move. */
  private resolve(s: S, mine: Action, theirs: string | undefined): Child[] {
    const t = cloneS(s);
    t.turn++;
    const out: Child[] = [];
    if (mine.kind === 'switch') {
      const sw = this.switched(t, mine.to);
      sw.turn = t.turn;
      for (const c of this.act(sw, 1, theirs, true)) out.push({ p: c.p, s: this.endTurn(c.s, mine), note: c.note === 'ko' ? 'lost' : undefined });
      return out;
    }
    if (mine.kind === 'revive') {
      t.hp[mine.to] = mine.hp;
      for (const c of this.act(t, 1, theirs, true)) out.push({ p: c.p, s: this.endTurn(c.s, mine) });
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
  private myActions(s: S): Action[] {
    const me = this.mons[s.me];
    const out: Action[] = [];
    if (s.foe < 0) return out;
    if (this.reviving && s.hp[this.reviving.to] <= 0) out.push({ kind: 'revive', ...this.reviving });
    const strong = this.bestHit(s, s.me, s.foe, true, s.mFirst);
    // A weaker move that KOs on every roll and hits more often than the strongest one (Surf vs Hydro Pump)
    // takes its place; with a cost of its own (recoil, stat drop) both are searched.
    let sure: { id: string; acc: number } | undefined;
    const strongAcc = strong.id ? this.dist(s.me, s.foe, strong.id, s.mb, s.fb, s.st[s.me], s.mFE)!.acc : 1;
    for (const id of me.attacks) {
      const dd = this.dist(s.me, s.foe, id, s.mb, s.fb, s.st[s.me], s.mFE);
      if (!dd || dd.acc <= strongAcc || dd.n[0] < s.hp[s.foe] || (moveFx(this.ds, id).firstTurnOnly && !s.mFirst)) continue;
      if (!sure || dd.acc > sure.acc) sure = { id, acc: dd.acc };
    }
    const fx = sure && moveFx(this.ds, sure.id);
    if (strong.id && !(fx && !fx.recoil && !fx.userDrop)) out.push({ kind: 'move', moveId: strong.id });
    if (sure) out.push({ kind: 'move', moveId: sure.id });
    let prio: { id: string; hit: number } | undefined;
    for (const id of me.attacks) {
      const dd = this.dist(s.me, s.foe, id, s.mb, s.fb, s.st[s.me], s.mFE);
      if (dd && dd.prio > 0 && id !== strong.id && (!prio || dd.mean > prio.hit) && (!moveFx(this.ds, id).firstTurnOnly || s.mFirst)) prio = { id, hit: dd.mean };
    }
    if (prio && prio.id !== sure?.id) out.push({ kind: 'move', moveId: prio.id });
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
    return `${depth}|${s.me},${s.foe}|${s.hp.map((x) => Math.round(x * 4)).join(',')}|${s.st.join(',')}|${s.slp.join(',')}|${s.mb.join(',')}|${s.fb.join(',')}|${s.mc}${s.fc}${+s.mFE}${+s.fFE}${+s.mFirst}${+s.fFirst}${+s.mLoaf}${+s.fLoaf}|${s.lost},${s.kos},${s.f0t},${Math.round(s.f0loss)},${s.fUsed}`;
  }

  /** Value of a decision node. */
  private value(s: S, depth: number): Value {
    if (s.foe < 0 || !this.aliveMine(s).length) return this.leaf(s);
    if (s.hp[s.me] <= 0) {
      // Replacement: free switch-in, no turn used.
      // Only your two most promising replacements are searched (by the leaf value).
      const cands = this.aliveMine(s).map((b) => ({ b, v: this.leaf(this.switched(s, b)).v })).sort((x, y) => y.v - x.v).slice(0, 2);
      return cands.map((c) => this.value(this.switched(s, c.b), depth)).reduce((x, y) => (y.v > x.v ? y : x));
    }
    if (depth <= 0 || this.nodes >= this.maxNodes) return this.leaf(s);
    const k = this.key(s, depth);
    const hit = this.memo.get(k);
    if (hit) return hit;
    let best: (Value & { best?: Action }) | undefined;
    for (const a of this.myActions(s)) {
      const x = this.q(s, a, depth, false);
      if (!best || x.v > best.v) best = { ...x, best: a };
    }
    best ??= this.leaf(s);
    this.memo.set(k, best);
    return best;
  }

  /** Expected value of taking action `a` now. */
  private q(s: S, a: Action, depth: number, root: boolean): Value {
    this.nodes++;
    const out = { v: 0, shown: 0 };
    for (const r of this.replies(s, root)) {
      for (const c of this.resolve(s, a, r.id)) {
        this.nodes++;
        const x = this.value(c.s, depth - 1);
        out.v += r.p * c.p * x.v;
        out.shown += r.p * c.p * x.shown;
      }
    }
    return out;
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
    const rows = actions.map((action) => {
      if (forced && action.kind === 'switch') return { action, ...this.value(this.switched(s, action.to), depth) };
      const x = this.q(s, action, depth, true);
      return { action, v: action.kind === 'switch' ? x.v - SWITCH_PENALTY : x.v, shown: x.shown };
    });
    // Each row shows its own number, kept in the order of `v`: a worse line never shows more than a better one.
    let cap = Infinity;
    let prev = Infinity;
    const score = new Map<RootAction, number>();
    for (const r of [...rows].sort((x, y) => y.v - x.v)) {
      cap = Math.max(0, Math.min(squash(r.shown), cap - Math.min(1, prev - r.v)));
      prev = r.v;
      score.set(r.action, cap);
    }
    return rows.map((r) => ({ action: r.action, score: score.get(r.action)!, rank: r.v, line: this.line(r.action, depth) }));
  }

  /** Best target of a Revive that brings back `hp` %, and what using it now gains on attacking now (and using it later). */
  revive(hp: number, depth: number, attacks: string[]): { to: number; gain: number } | undefined {
    const s = this.root;
    if (s.hp[0] <= 0) return undefined;
    const back = (to: number) => {
      const t = cloneS(s);
      t.hp[to] = hp;
      return t;
    };
    let best: { to: number; v: number } | undefined;
    for (let to = 1; to < this.nMine; to++) {
      if (s.hp[to] > 0) continue;
      const { v } = this.leaf(back(to));
      if (!best || v > best.v) best = { to, v };
    }
    if (!best || !attacks.length) return undefined;
    const memo = this.memo;
    this.memo = new Map();
    this.reviving = { to: best.to, hp };
    const v = (a: Action) => {
      this.maxNodes = this.nodes + REVIVE_BUDGET;
      return this.q(s, a, depth, true).v;
    };
    const now = v({ kind: 'revive', ...this.reviving });
    const later = Math.max(...attacks.map((moveId) => v({ kind: 'move', moveId })));
    this.memo = memo;
    this.reviving = undefined;
    return { to: best.to, gain: now - later };
  }

  private label(a: Action): string {
    return a.kind === 'move' ? this.ds.moves[a.moveId]?.name ?? a.moveId : `${a.kind === 'switch' ? 'switch to' : 'revive'} ${this.mons[a.to].name}`;
  }

  /** Most likely line of play after a root action (your moves land, their most likely reply). */
  line(action: RootAction, depth: number): string | undefined {
    const forced = this.root.hp[0] <= 0;
    let s = forced && action.kind === 'switch' ? this.switched(this.root, action.to) : this.root;
    let a: Action | undefined = forced ? undefined : action;
    const steps: string[] = [];
    let d = depth;
    let firstTurn = true;
    while (d > 0 && s.foe >= 0 && this.aliveMine(s).length) {
      if (s.hp[s.me] <= 0) {
        // Your best replacement.
        let best = -Infinity;
        let pick = -1;
        for (const b of this.aliveMine(s)) {
          const { v } = this.value(this.switched(s, b), d);
          if (v > best) { best = v; pick = b; }
        }
        steps.push(`${this.mons[s.me].name} faints, ${this.mons[pick].name} comes in`);
        s = this.switched(s, pick);
      }
      if (!a) a = this.memo.get(this.key(s, d))?.best ?? this.myActions(s)[0];
      if (!a) break;
      const r = this.replies(s, firstTurn)[0];
      const kids = this.resolve(s, a, r?.id);
      // Your hit lands: prefer the KO outcome when it is likely.
      const pick = kids.reduce((x, y) => (y.p > x.p ? y : x));
      const before = s;
      s = pick.s;
      let txt = a.kind === 'move' && before.mLoaf && this.mons[before.me].truant ? `${this.mons[before.me].name} loafs` : a.kind === 'switch' ? `${this.label(a)[0].toUpperCase()}${this.label(a).slice(1)}` : this.label(a);
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
    // "KOs both remaining" only for a line where your Pokémon stays in (a lost one keeps the plain steps).
    if (allDown && total >= 2 && s.lost === 0 && lastMove && !/^Switch to/.test(lastMove)) {
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
    if (this.mons[a].truant && (side === 0 ? s.mLoaf : s.fLoaf)) return { ko: 0, critKo: 0, crit: dd.crit };
    const live = this.holds(a, d, moveId, h) ? 0 : 1 - (side === 1 ? this.survives(this.mons[d], h) : 0); // Sturdy, Friendship survival
    return { ko: live * pHit * ((1 - dd.crit) * fn + dd.crit * fc), critKo: live * pHit * dd.crit * Math.max(0, fc - fn), crit: dd.crit };
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
 * Values above 90 (a KO at little cost) are squashed into
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
  const engine = new Lookahead(input);
  const values = engine.run(input.depth ?? 2);
  // Small trees (few options, few replies): one more turn fits. Same engine, so damage stays cached;
  // if the deeper pass hits its cap, its partial results are dropped.
  if (input.depth === undefined && engine.nodes < DEEPEN_BELOW) {
    engine.maxNodes = engine.nodes + DEEPER_BUDGET;
    const v3 = engine.run(3);
    if (engine.nodes < engine.maxNodes) return { engine, values: v3, depth: 3 };
    return { engine, values, depth: 2 };
  }
  return { engine, values, depth: input.depth ?? 2 };
}

/** Depth 2 trees smaller than this get a third turn, with at most this many extra nodes. */
export const DEEPEN_BELOW = 400;
export const DEEPER_BUDGET = 2500;
/** Nodes per line when rating a Revive, on top of the search. */
const REVIVE_BUDGET = 400;
