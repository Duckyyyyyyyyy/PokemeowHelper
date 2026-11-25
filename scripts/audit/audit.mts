// @ts-nocheck: measuring tool, see README.md
/* Audit: Showdown engine = truth; the advisor sees only what the extension reads. Usage: tsx audit.mts <seed> <battles> <rollouts> <out.jsonl> [audit|match|selftest] */
import fs from 'node:fs';
import { createRequire } from 'node:module';
const ROOT = new URL('../../', import.meta.url).href;
/** Source tree under test (default: this repo; run.sh passes an older version's). */
const REPO = process.env.REPO ? 'file:///' + process.env.REPO + '/' : ROOT;
const req = createRequire(new URL('.sim/x.js', import.meta.url));
const { Battle, Dex, Teams, PRNG } = req('@pkmn/sim');
const u = (p: string) => REPO + p;
const { adviseTurn } = await import(u('src/engine/turnAdvisor.ts'));
const { boxToCalc, damageRolls } = await import(u('src/engine/damage.ts'));
const { Field } = await import(ROOT + 'node_modules/@smogon/calc/dist/index.js').then((m: any) => m.default ?? m);
const { npcAttackWeight } = await import(u('src/engine/npcModel.ts'));
const mini = JSON.parse(fs.readFileSync(new URL('tests/fixtures/wiki-mini.json', ROOT), 'utf8'));

/* ---------- rng ---------- */
let rs = Number(process.argv[2] ?? 1) * 7919 + 13;
const rnd = () => { rs |= 0; rs = (rs + 0x6d2b79f5) | 0; let t = Math.imul(rs ^ (rs >>> 15), 1 | rs); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = <T,>(a: T[]): T => a[Math.floor(rnd() * a.length)];
const BATTLES = Number(process.argv[3] ?? 5), ROLL = Number(process.argv[4] ?? 24), OUT = process.argv[5], MODE = process.argv[6] ?? 'audit';


const SIZE = Number(process.env.SIZE ?? 4), BAG = process.env.BAG !== '0', NPCMED = process.env.NPCMED !== '0', HELD = process.env.HELD !== '0';
/* ---------- dataset from the Showdown dex ---------- */
const dex = Dex.forGen(9);
const ds: any = { version: 'audit', syncedAt: 0, types: mini.types, species: {}, moves: {}, abilities: {}, items: {}, npcs: [], maps: [], schemaVersion: 7 };
for (const m of Dex.moves.all()) {
  if (m.num <= 0 || m.isZ || m.isMax || m.isNonstandard === 'CAP' || m.isNonstandard === 'LGPE') continue;
  ds.moves[m.id] = { id: m.id, name: m.name, type: m.type, category: m.category, power: m.basePower, accuracy: m.accuracy, pp: m.pp, priority: m.priority, target: m.target, description: m.shortDesc || m.desc };
}
for (const k of Object.keys(mini.moves)) if (ds.moves[k]) ds.moves[k].description = mini.moves[k].description;
for (const a of Dex.abilities.all()) ds.abilities[a.id] = { id: a.id, name: a.name, summary: a.shortDesc };
for (const i of Dex.items.all()) ds.items[i.id] = { id: i.id, name: i.name, effect: i.shortDesc };
const pool: any[] = [];
const byName: Record<string, number> = {};
let sid = 1;
for (const s of Dex.species.all()) {
  if (s.num <= 0 || s.isNonstandard === 'CAP' || s.isNonstandard === 'Custom' || s.isNonstandard === 'Future') continue;
  if (s.forme && /Mega|Gmax|Primal|Totem|Eternamax|Tera|Starter/.test(s.forme)) continue;
  const id = sid++;
  ds.species[id] = { id, name: s.name, types: s.types, baseStats: s.baseStats, abilities: Object.values(s.abilities).map((n: any) => ({ id: n.toLowerCase().replace(/[^a-z0-9]/g, ''), name: n, hidden: false })), levelMoves: [], machineMoves: [], eggMoves: [] };
  byName[s.name] = id;
  if (!s.forme && !s.nfe && s.name !== 'Ditto' && s.name !== 'Smeargle') pool.push(s);
}
const learn = new Map<string, string[]>();
async function learnset(s: any): Promise<string[]> {
  if (learn.has(s.id)) return learn.get(s.id)!;
  const out = new Set<string>();
  let cur = s;
  for (let i = 0; i < 4 && cur?.exists; i++) {
    const d = await Dex.learnsets.get(cur.id);
    for (const id of Object.keys(d?.learnset ?? {})) if (ds.moves[id]) out.add(id);
    cur = cur.prevo ? Dex.species.get(cur.prevo) : null;
  }
  const r = [...out];
  learn.set(s.id, r);
  return r;
}
Dex.learnsets ??= { get: async (id: string) => Dex.species.getLearnsetData(id) };
const ITEMS = HELD ? ['leftovers', 'sitrusberry', 'sitrusberry', 'lifeorb', 'choicescarf', 'choiceband', 'choicespecs', 'focussash', 'mysticwater', 'charcoal', 'expertbelt', 'rockyhelmet', 'assaultvest', 'lumberry', 'airballoon', 'eviolite', 'whiteherb', 'weaknesspolicy', 'shellbell', 'blacksludge', 'liechiberry', 'salacberry', 'occaberry', 'passhoberry', 'shucaberry', 'chopleberry', 'cheriberry', 'chestoberry', 'quickclaw', 'brightpowder', 'scopelens', 'kingsrock', 'ejectbutton', 'redcard', 'heavydutyboots', 'flameorb', 'toxicorb', 'lightclay', 'normalgem', 'throatspray'] : [''];
const BAN = new Set(['explosion', 'selfdestruct', 'mistyexplosion', 'finalgambit', 'memento', 'healingwish', 'lunardance', 'batonpass', 'ragepowder', 'followme', 'helpinghand', 'struggle', 'celebrate', 'splash', 'holdhands']);

interface MonSet { species: number; name: string; level: number; moves: string[]; ability?: string; item: string; nature: string; ivs: any; evs: any; gender?: string }
const st = (n: number) => ({ hp: n, atk: n, def: n, spa: n, spd: n, spe: n });
async function randomMon(level: number, player: boolean): Promise<MonSet | null> {
  const s = pick(pool);
  const ls = (await learnset(s)).filter((m) => !BAN.has(m));
  const stab = ls.filter((m) => ds.moves[m].category !== 'Status' && ds.moves[m].power >= 50 && s.types.includes(ds.moves[m].type));
  const atk = ls.filter((m) => ds.moves[m].category !== 'Status' && (ds.moves[m].power >= 40 || ds.moves[m].power === 0));
  const stat = ls.filter((m) => ds.moves[m].category === 'Status');
  if (!stab.length || atk.length < 4) return null;
  const mv = new Set<string>([pick(stab)]);
  for (let g = 0; mv.size < (rnd() < 0.5 && stat.length ? 3 : 4) && g < 40; g++) mv.add(pick(atk));
  for (let g = 0; mv.size < 4 && g < 40; g++) mv.add(pick(stat));
  return { species: byName[s.name], name: s.name, level, moves: [...mv], ability: pick(Object.values(s.abilities)) as string, item: pick(ITEMS), nature: pick(['Hardy', 'Adamant', 'Modest', 'Jolly', 'Timid', 'Bold', 'Calm']), ivs: st(player ? 15 : 31), evs: st(player ? 20 : 0) };
}
const npcTeams = mini.npcs.filter((n: any) => !['boss', 'frontier'].includes(n.category)).flatMap((n: any) => n.variants.map((v: any) => ({ name: n.name, category: n.category, team: v.team, meds: v.medicines ?? [] }))).filter((t: any) => t.team.length >= 3 && t.team.every((m: any) => byName[m.name] && m.moves.every((x: string) => ds.moves[x])));
async function foeTeam(size: number): Promise<{ name: string; team: MonSet[]; meds: string[] }> {
  if (npcTeams.length && rnd() < 0.5) {
    const t: any = pick(npcTeams);
    const ms = [...t.team].sort(() => rnd() - 0.5).slice(0, size);
    return { name: t.name, meds: t.meds, team: ms.map((m: any) => ({ species: byName[m.name], name: m.name, level: m.level ?? 50, moves: m.moves, ability: m.ability, item: m.item ?? '', nature: m.nature ?? 'Hardy', ivs: m.ivs ?? st(31), evs: m.evs ?? st(0), gender: m.gender })) };
  }
  const lv = 45 + Math.floor(rnd() * 30);
  return { name: 'Trainer', meds: pick([[], ['hyperpotion'], ['fullrestore', 'fullrestore']]), team: await team(size, lv, false) };
}
async function team(size: number, lv: number, player: boolean): Promise<MonSet[]> {
  const out: MonSet[] = [];
  while (out.length < size) {
    const m = await randomMon(Math.max(5, Math.min(100, lv + Math.floor(rnd() * 7) - 3)), player);
    if (m && !out.some((x) => x.name === m.name)) out.push(m);
  }
  return out;
}
const pack = (t: MonSet[]) => Teams.pack(t.map((m) => ({ name: m.name, species: m.name, item: m.item ? Dex.items.get(m.item).name : '', ability: m.ability ?? '', moves: m.moves, nature: m.nature, gender: m.gender ?? '', evs: m.evs, ivs: m.ivs, level: m.level } as any)));

/* ---------- calc helpers (truth side: full field) ---------- */
const WEATHER: any = { raindance: 'Rain', sunnyday: 'Sun', sandstorm: 'Sand', snowscape: 'Snow', snow: 'Snow', hail: 'Hail', primordialsea: 'Heavy Rain', desolateland: 'Harsh Sunshine', deltastream: 'Strong Winds' };
const TERRAIN: any = { electricterrain: 'Electric', grassyterrain: 'Grassy', mistyterrain: 'Misty', psychicterrain: 'Psychic' };
const calcBase = new Map<string, any>();
function calcOf(p: any, sets: MonSet[]): any {
  const set = sets.find((m) => m.name === p.set.name)!;
  const k = `${set.name}|${set.level}|${JSON.stringify(set.ivs)}|${JSON.stringify(set.evs)}|${set.nature}|${p.item}|${p.ability}|${p.side.id}`;
  let b = calcBase.get(k);
  if (!b) calcBase.set(k, (b = boxToCalc(ds, { uid: 'x', species: set.species, level: set.level, moves: set.moves, source: 'game', nature: set.nature, ability: Dex.abilities.get(p.ability).name, item: p.item || null, ivs: set.ivs, evs: set.evs, gender: p.gender })));
  return b;
}
function fieldOf(b: any, atk: any): any {
  const side = (s: any) => ({ isReflect: !!s.sideConditions.reflect, isLightScreen: !!s.sideConditions.lightscreen, isAuroraVeil: !!s.sideConditions.auroraveil, isTailwind: !!s.sideConditions.tailwind });
  return new Field({ gameType: 'Singles', weather: WEATHER[b.field.weather], terrain: TERRAIN[b.field.terrain], attackerSide: side(atk.side), defenderSide: side(atk.side.foe) });
}
const dmgCache = new Map<string, number[]>();
function rolls(b: any, a: any, d: any, id: string, T: { p1: MonSet[]; p2: MonSet[] }): number[] {
  if (!ds.moves[id] || ds.moves[id].category === 'Status') return [0];
  const bs = (x: any) => Object.values(x.boosts).join('');
  const sc = (s: any) => Object.keys(s.sideConditions).filter((k) => /screen|reflect|veil/.test(k)).join('');
  const k = `${a.side.id}${a.set.name}|${a.item}|${a.ability}|${a.status}|${bs(a)}|${Math.ceil((8 * a.hp) / a.maxhp)}>${d.set.name}|${d.item}|${d.ability}|${d.status}|${bs(d)}|${d.hp === d.maxhp ? 'f' : Math.ceil((8 * d.hp) / d.maxhp)}|${id}|${b.field.weather}${b.field.terrain}${sc(d.side)}`;
  const c = dmgCache.get(k);
  if (c) return c;
  const A = calcOf(a, T[a.side.id as 'p1']).clone(), D = calcOf(d, T[d.side.id as 'p1']).clone();
  for (const [p, s] of [[A, a], [D, d]] as any) { p.boosts = { ...p.boosts, ...s.boosts }; p.status = s.status || ''; p.originalCurHP = Math.max(1, s.hp); if (s.terastallized) p.types = s.types; }
  let r: number[] = [0];
  try { r = damageRolls(ds, A, D, id, fieldOf(b, a)) ?? [0]; } catch { /* calc gap */ }
  if (dmgCache.size > 400000) dmgCache.clear();
  dmgCache.set(k, r);
  return r;
}
const mean = (x: number[]) => x.reduce((s, y) => s + y, 0) / x.length;
const accOf = (id: string, a: any, d: any) => { const m = ds.moves[id]; if (!m || m.accuracy === true) return 1; const n = Math.max(-6, Math.min(6, a.boosts.accuracy - d.boosts.evasion)); return Math.min(1, (m.accuracy / 100) * (n >= 0 ? (3 + n) / 3 : 3 / (3 - n))); };
const usable = (p: any) => (p.getMoveRequestData?.().moves ?? []).filter((m: any) => !m.disabled && (m.pp === undefined || m.pp > 0));

/* ---------- items (Showdown has none: effect first, then the user loses its move) ---------- */
type Bag = Record<string, number>;
const HEAL: Record<string, (m: number) => number> = { potion: () => 20, superpotion: () => 60, hyperpotion: () => 120, moomoomilk: () => 100, sitrusberry: (m) => Math.floor(m / 4), maxpotion: () => 1e9, fullrestore: () => 1e9 };
const CURE: Record<string, string[]> = { paralyzeheal: ['par'], burnheal: ['brn'], antidote: ['psn', 'tox'], awakening: ['slp'], iceheal: ['frz'], fullheal: ['par', 'brn', 'psn', 'tox', 'slp', 'frz'], fullrestore: ['par', 'brn', 'psn', 'tox', 'slp', 'frz'] };
const itemStats: Record<string, number> = {};
/** "item <id> <mon> [moveid]" for side s; returns false when it would do nothing. */
function applyItem(b: any, side: any, bag: Bag, cmd: string): boolean {
  const [, id, mon, move] = cmd.split('~');
  const p = side.pokemon.find((x: any) => x.set.name === mon);
  if (!p || !(bag[id] > 0)) return false;
  let did = false;
  if (id === 'revive' || id === 'maxrevive') {
    if (!p.fainted) return false;
    side.pokemonLeft++; p.fainted = false; p.faintQueued = false; p.subFainted = false; p.status = ''; p.hp = 1;
    p.sethp(id === 'revive' ? Math.floor(p.maxhp / 2) : p.maxhp); did = true;
  } else {
    if (p.fainted) return false;
    if (HEAL[id] && p.hp < p.maxhp) { p.hp = Math.min(p.maxhp, p.hp + HEAL[id](p.maxhp)); did = true; }
    if (CURE[id]?.includes(p.status)) { p.status = ''; p.statusState = b.initEffectState ? b.initEffectState({ id: '', target: p }) : { id: '', target: p }; did = true; }
    if (/ether|elixir/.test(id)) for (const m of p.moveSlots) if (id.endsWith('elixir') || m.id === move) { const n = Math.min(m.maxpp, m.pp + (id.startsWith('max') ? 99 : 10)); if (n > m.pp) { m.pp = n; did = true; } }
  }
  if (!did) return false;
  bag[id]--;
  if (side.id === 'p2') (b.__npcItems ??= []).push(id); // the game's log names each one
  itemStats[side.id + ':' + id] = (itemStats[side.id + ':' + id] ?? 0) + 1;
  const a = side.active[0];
  a.volatiles.flinch = b.initEffectState ? b.initEffectState({ id: 'flinch', target: a, duration: 1 }) : { id: 'flinch', target: a, duration: 1 };
  return true;
}
/** A harmless move to "choose" while the item turn is spent. */
function idleMove(side: any): string {
  const ms = side.active[0].getMoveRequestData().moves as any[];
  const i = ms.findIndex((m) => !m.disabled && m.pp !== 0 && !['focuspunch', 'pursuit', 'beakblast', 'shelltrap'].includes(m.id));
  return 'move ' + (i < 0 ? 1 : i + 1);
}
const canItem = (side: any) => side.requestState === 'move' && !['twoturnmove', 'lockedmove', 'mustrecharge', 'bide', 'rollout', 'iceball', 'uproar'].some((v) => side.active[0].volatiles[v]);
/** Heal when the best hit can KO within two hits and the heal outlasts one more hit; not when it can KO now and moves first. */
function healCmd(b: any, side: any, T: any, bag: Bag): string | null {
  if (!canItem(side)) return null;
  const a = side.active[0], f = side.foe.active[0];
  if (!a || !f || a.hp / a.maxhp > 0.5) return null;
  let hit = 0, mine = 0;
  for (const m of f.moveSlots) if (m.pp > 0) hit = Math.max(hit, mean(rolls(b, f, a, m.id, T)));
  for (const m of a.moveSlots) if (m.pp > 0) mine = Math.max(mine, mean(rolls(b, a, f, m.id, T)) * accOf(m.id, a, f));
  if (mine >= f.hp && a.getStat('spe') > f.getStat('spe')) return null;
  for (const id of ['fullrestore', 'maxpotion', 'hyperpotion', 'superpotion']) if (bag[id] > 0 && HEAL[id](a.maxhp) > hit * 1.5 && Math.min(a.maxhp, a.hp + HEAL[id](a.maxhp)) - hit > a.hp) return 'item~' + id + '~' + a.set.name;
  return null;
}
/**
 * NPC medicine. NPCHEAL=seen: a player's report from real battles (2026-11-25): at risk of a KO it usually heals under
 * half HP, "could be lower, maybe 30-40". Here 80% under 40% HP and 40% from 40 to 50% (the numbers are guesses; "at
 * risk" = your active's best move can KO on its top roll, also a guess).
 * Otherwise the older guess: at 1/4 HP or less. Full Heal on a bad status is a guess in both.
 */
function npcItem(b: any, side: any, meds: Bag, T: any, r: () => number): string | null {
  if (!canItem(side)) return null;
  const a = side.active[0], you = side.foe.active[0];
  const low = () => {
    if (process.env.NPCHEAL !== 'seen') return a.hp <= a.maxhp / 4;
    if (a.hp >= a.maxhp / 2 || !you || you.fainted) return false;
    const top = Math.max(0, ...you.moveSlots.filter((m: any) => m.pp > 0).map((m: any) => { const x = rolls(b, you, a, m.id, T); return x[x.length - 1]; }));
    return top >= a.hp && r() < (a.hp < 0.4 * a.maxhp ? 0.8 : 0.4);
  };
  const heal = Object.keys(meds).find((id) => meds[id] > 0 && HEAL[id]);
  if (heal && low()) return 'item~' + heal + '~' + a.set.name;
  for (const id of Object.keys(meds)) if (meds[id] > 0) {
    if (id === 'fullheal' && ['slp', 'par', 'frz', 'tox'].includes(a.status)) return 'item~' + id + '~' + a.set.name;
  }
  return null;
}

/* ---------- policies ---------- */
type Pol = (b: any, side: any, T: any, r: () => number) => string;
const bench = (side: any) => side.pokemon.map((p: any, i: number) => ({ p, i: i + 1 })).filter((x: any) => !x.p.fainted && !x.p.isActive);
/** Duel value of `m` vs `f`: turns to KO each way. */
function duel(b: any, m: any, f: any, T: any, hit = 0): number {
  let mine = 0, theirs = 0;
  for (const s of m.moveSlots) if (s.pp > 0) mine = Math.max(mine, mean(rolls(b, m, f, s.id, T)) * accOf(s.id, m, f));
  for (const s of f.moveSlots) if (s.pp > 0) theirs = Math.max(theirs, mean(rolls(b, f, m, s.id, T)) * accOf(s.id, f, m));
  const hp = m.hp - hit * theirs;
  if (hp <= 0) return -2;
  const fast = (m.getStat('spe') > f.getStat('spe')) !== !!b.field.pseudoWeather.trickroom;
  const t1 = mine > 0 ? Math.ceil(f.hp / mine) : 99, t2 = theirs > 0 ? Math.ceil(hp / theirs) : 99;
  return Math.max(-1.5, Math.min(1.5, (t2 - t1 + (fast ? 0.5 : -0.5)) / Math.max(1, Math.min(t1, t2))));
}
const bestIn = (b: any, side: any, T: any) => bench(side).map((x: any) => ({ ...x, v: duel(b, x.p, side.foe.active[0], T) })).sort((a: any, c: any) => c.v - a.v)[0];
const greedy: Pol = (b, side, T) => {
  if (side.requestState === 'switch') return `switch ${bestIn(b, side, T).i}`;
  const a = side.active[0], f = side.foe.active[0];
  let best = 'move 1', bv = -1;
  for (const [i, m] of (a.getMoveRequestData().moves as any[]).entries()) {
    if (m.disabled || m.pp === 0) continue;
    const r = rolls(b, a, f, m.id, T);
    const ko = r.filter((x) => x >= f.hp).length / r.length;
    const v = accOf(m.id, a, f) * (Math.min(1, mean(r) / Math.max(1, f.hp)) + ko);
    if (v > bv) { bv = v; best = `move ${i + 1}`; }
  }
  return best;
};
/** Greedy, plus a voluntary switch when it clearly loses and a bench Pokémon wins even after a free hit. */
const smart: Pol = (b, side, T, r) => {
  if (side.requestState !== 'switch' && !side.active[0].trapped && !side.active[0].maybeTrapped) {
    const now = duel(b, side.active[0], side.foe.active[0], T);
    if (now < -0.3) {
      const c = bench(side).map((x: any) => ({ ...x, v: duel(b, x.p, side.foe.active[0], T, 1) })).sort((x: any, y: any) => y.v - x.v)[0];
      if (c && c.v > 0.3) return `switch ${c.i}`;
    }
  }
  return greedy(b, side, T, r);
};
/** NPC: the advisor's own npcModel weights on true damage (strong hits, KOs), status moves 1.2 (×3 as a first move). No switching. */
const npc: Pol = (b, side, T, r) => {
  if (side.requestState === 'switch') return `switch ${bench(side)[0].i}`;
  const a = side.active[0], f = side.foe.active[0];
  const ms = a.getMoveRequestData().moves as any[];
  const w = ms.map((m) => {
    if (m.disabled || m.pp === 0) return 0;
    const mv = ds.moves[m.id];
    if (!mv) return 0.1;
    if (mv.category === 'Status') return (f.status && /paralyz|poison|burn|sleep/i.test(mv.description) ? 0.05 : 1.2) * (a.activeMoveActions === 0 ? 3 : 0.6);
    const x = rolls(b, a, f, m.id, T), h = f.maxhp / 100;
    return npcAttackWeight((mean(x) / h) * accOf(m.id, a, f), x[0] / h, x[x.length - 1] / h, f.hp / h);
  });
  let t = r() * w.reduce((s, x) => s + x, 0);
  for (let i = 0; i < w.length; i++) { t -= w[i]; if (t <= 0 && w[i] > 0) return `move ${i + 1}`; }
  return 'default';
};

/* ---------- what the extension would read ---------- */
function snapshot(b: any, T: any, name: string, extra: any[]): any {
  const [p1, p2] = b.sides;
  const a = p1.active[0], f = p2.active[0];
  const events: any[] = [...extra];
  let turn = 0;
  b.log.forEach((l: string, idx: number) => {
    const q = l.split('|');
    if (q[1] === 'turn') turn = Number(q[2]);
    if (q[1] === 'move') {
      const side = q[2].startsWith('p1') ? 'player' : 'opponent';
      events.push({ idx: idx + 100, turn: turn || 1, side, mon: q[2].slice(5), move: q[3], target: (q[4] ?? '').slice(5) || undefined, stages: { attacker: {}, target: {} } });
    }
    if (q[1] === '-miss' && events.length) events[events.length - 1].missed = true;
    if (q[1] === '-damage' && events.length && !q[4]) events[events.length - 1].damage ??= 1;
  });
  const boosts = (p: any) => Object.fromEntries(Object.entries(p.boosts).filter(([, v]) => v));
  const status = (p: any) => p.status || undefined;
  const req = p1.requestState === 'switch' ? [] : a.getMoveRequestData().moves;
  const labels = [WEATHER[b.field.weather], TERRAIN[b.field.terrain] && TERRAIN[b.field.terrain] + ' Terrain', b.field.pseudoWeather.trickroom && 'Trick Room'].filter(Boolean);
  const itemName = (p: any) => (p.item ? Dex.items.get(p.item).name : undefined);
  const own = (p: any) => ({ name: p.set.name, level: p.level, hp: p.hp, maxHp: p.maxhp, ...(status(p) ? { status: status(p) } : {}), ...(itemName(p) ? { item: itemName(p) } : {}) });
  const foe = (p: any) => ({ name: p.set.name, level: p.level, ...(process.env.HPFULL && p.hp > 0 ? {} : { hpPct: Math.ceil((100 * p.hp) / p.maxhp) }), ...(p.hp <= 0 ? { hp: 0 } : {}), ...(status(p) ? { status: status(p) } : {}), ...(itemName(p) ? { item: itemName(p) } : {}) });
  return {
    v: 2, at: 0, status: 'active', kind: 'gym', opponentName: name, turn: b.turn,
    player: own(a), opponent: foe(f),
    moves: req.map((m: any) => ({ name: m.move, pp: m.pp, maxPp: m.maxpp, disabled: !!m.disabled })),
    bench: p1.pokemon.map((p: any) => ({ ...own(p), active: p.isActive, fainted: p.fainted, moves: p.moveSlots.map((m: any) => ({ name: m.move, pp: m.pp, maxPp: m.maxpp })) })),
    opponentTeam: p2.pokemon.map((p: any) => ({ ...foe(p), active: p.isActive, fainted: p.fainted })),
    boosts: { player: boosts(a), opponent: boosts(f) }, log: [], events, forcedSwitch: p1.requestState === 'switch' || undefined,
    ...(b.__npcItems ? { npcItems: b.__npcItems } : {}),
    ...(labels.length ? { field: { weather: WEATHER[b.field.weather], terrain: TERRAIN[b.field.terrain], labels } } : {}),
  };
}
const boxOf = (t: MonSet[]) => t.map((m, i) => ({ uid: 'game:' + i, gameId: String(i), source: 'game', species: m.species, level: m.level, moves: m.moves, nature: m.nature, ability: m.ability, item: m.item || null, ivs: m.ivs, evs: m.evs }));

interface Opt { cmd: string; label: string; kind: 'move' | 'switch'; score?: number | null }
function options(b: any): Opt[] {
  const p1 = b.sides[0], a = p1.active[0], out: Opt[] = [];
  if (p1.requestState !== 'switch') for (const [i, m] of (a.getMoveRequestData().moves as any[]).entries()) if (!m.disabled && m.pp !== 0) out.push({ cmd: `move ${i + 1}`, label: m.move, kind: 'move' });
  if (p1.requestState === 'switch' || !a.trapped) for (const x of bench(p1)) out.push({ cmd: `switch ${x.i}`, label: x.p.set.name, kind: 'switch' });
  return out;
}
function advise(b: any, T: any, name: string, extra: any[], bag?: Bag, meds: string[] = []): { opts: Opt[]; choice: Opt; noItem: Opt; itemOpt?: Opt; adv: any } {
  const snap = snapshot(b, T, name, extra);
  ds.npcs = [{ id: 'challenge:x', name, category: 'gym', variants: [{ label: 'x', format: 'singles', medicines: meds, team: T.p2.map((m: MonSet) => ({ ...m, item: m.item || null, baseStats: ds.species[m.species].baseStats })) }] }];
  let adv: any;
  try { adv = adviseTurn(ds, snap, boxOf(T.p1), bag ? { items: new Map(Object.entries(bag).filter(([, n]) => n > 0)) } : {}); } catch (e: any) { fs.writeFileSync(OUT + '.crash.json', JSON.stringify({ snap, T, bag, npcs: ds.npcs })); throw e; }
  const opts = options(b);
  const name2 = (o: Opt) => [o.label, 'Switch to ' + o.label, 'Send in ' + o.label];
  for (const o of opts) o.score = adv.actions.find((x: any) => x.kind === o.kind && name2(o).includes(x.label))?.score;
  const find = (x: any) => opts.find((o) => x && o.kind === x.kind && name2(o).includes(x.label));
  const rated = adv.actions.filter((x: any) => x.score !== null);
  const top = rated.find((x: any) => x.kind !== 'item' && find(x));
  const noItem = find(top) ?? opts[0];
  let itemOpt: Opt | undefined;
  const it = rated.find((x: any) => x.kind === 'item');
  if (it && canItem(b.sides[0])) {
    const [nm, rest] = it.label.split(' on ');
    const pm = rest.match(/^(.+) \((.+)\)$/);
    itemOpt = { cmd: ['item', Dex.toID(nm), pm ? pm[2] : rest, pm ? Dex.toID(pm[1]) : ''].join('~'), label: it.label, kind: 'item' as any, score: it.score };
  }
  const choice = itemOpt && it === rated[0] ? itemOpt : itemOpt && (it.score ?? 0) > (top?.score ?? -1) ? itemOpt : noItem;
  return { opts, choice, noItem, itemOpt, adv };
}

/** The advisor's best-rated move (no switch); `other` when it rates none. */
const topMove = (a: ReturnType<typeof advise>, other: () => string) => a.opts.filter((o) => o.kind === 'move' && o.score != null).sort((x, y) => y.score! - x.score!)[0]?.cmd ?? other();

/* ---------- running ---------- */
const outcome = (b: any) => {
  const [p1, p2] = b.sides;
  const hp = (s: any) => s.pokemon.reduce((x: number, p: any) => x + p.hp / p.maxhp, 0) / s.pokemon.length;
  const win = b.ended ? (b.winner === 'You' ? 1 : b.winner ? 0 : 0.5) : 0.5 + 0.5 * (hp(p1) - hp(p2));
  return 0.75 * win + 0.25 * (0.5 + 0.5 * (hp(p1) - hp(p2)));
};
function step(b: any, T: any, mine: string | Pol, theirs: Pol, r: () => number, bags: { me: Bag; foe: Bag }) {
  const [p1, p2] = b.sides;
  b.sentLogPos = b.log.length;
  const need = (x: any) => x.requestState && x.requestState !== '' && !x.isChoiceDone();
  const n1 = need(p1), n2 = need(p2);
  let c1 = n1 ? (typeof mine === 'string' ? mine : mine(b, p1, T, r)) : '';
  let c2 = n2 ? (npcItem(b, p2, bags.foe, T, r) ?? theirs(b, p2, T, r)) : '';
  if (c1.startsWith('item~')) { if (applyItem(b, p1, bags.me, c1)) { b.__it = (b.__it ?? 0) + 1; c1 = idleMove(p1); } else { b.__badItem = c1; c1 = greedy(b, p1, T, r); } }
  if (c2.startsWith('item~')) c2 = applyItem(b, p2, bags.foe, c2) ? idleMove(p2) : theirs(b, p2, T, r);
  if (n1) {
    if (c1.startsWith('switch') && p1.requestState !== 'switch') {
      b.__sw = (b.__sw ?? 0) + 1;
      // A to B to A: back to the Pokémon that left one or two turns ago.
      const to = p1.pokemon[Number(c1.split(' ')[1]) - 1]?.set.name;
      b.__out ??= {};
      if (b.turn - (b.__out[to] ?? -9) <= 2) b.__loop = (b.__loop ?? 0) + 1;
      b.__out[p1.active[0].set.name] = b.turn;
    }
    if (!b.choose('p1', c1)) { b.__fail = (b.__fail ?? 0) + 1; b.__why = c1 + ' ' + p1.choice.error; if (!b.choose('p1', 'default')) throw new Error('p1 ' + c1 + ' ' + p1.choice.error); }
  }
  if (!b.ended && n2 && need(p2) && !b.choose('p2', c2)) b.choose('p2', 'default');
}
const clone = (b: any) => { const c = Battle.fromJSON(b.toJSON()); c.restart?.(() => {}); return c; };
function rollout(json: any, T: any, first: string | null, foe: Pol, seed: number, me: Pol, bags: { me: Bag; foe: Bag }): number {
  const b = Battle.fromJSON(json);
  b.restart(() => {});
  b.prng = new PRNG([seed & 0xffff, (seed * 31) & 0xffff, (seed * 17) & 0xffff, 7] as any);
  const bg = { me: { ...bags.me }, foe: { ...bags.foe } };
  let q = seed * 2654435761;
  const r = () => { q = (Math.imul(q, 1664525) + 1013904223) | 0; return (q >>> 0) / 4294967296; };
  const pol: Pol = (x, side, t, rr) => healCmd(x, side, t, bg.me) ?? me(x, side, t, rr);
  let cmd: string | Pol = first ?? pol;
  for (let i = 0; i < 90 && !b.ended; i++) { step(b, T, cmd, foe, r, bg); cmd = pol; }
  return outcome(b);
}

const SCEN = ['plain', 'plain', 'plain', 'Rain', 'Sun', 'Sand', 'Snow', 'Electric', 'Grassy', 'Misty', 'Psychic', 'trickroom', 'reflect-foe', 'lightscreen-foe', 'reflect-own', 'rocks-own', 'spikes-own', 'tailwind-foe', 'tailwind-own'];
function inject(b: any, sc: string): any[] {
  const [p1, p2] = b.sides, a = p1.active[0], f = p2.active[0];
  const ev = (side: string, move: string) => [{ idx: 1, turn: 1, side, mon: side === 'player' ? a.set.name : f.set.name, move, stages: { attacker: {}, target: {} } }];
  const w: any = { Rain: 'raindance', Sun: 'sunnyday', Sand: 'sandstorm', Snow: 'snowscape' }, t: any = { Electric: 'electricterrain', Grassy: 'grassyterrain', Misty: 'mistyterrain', Psychic: 'psychicterrain' };
  if (w[sc]) { b.field.setWeather(w[sc], f); if (b.field.weatherState) b.field.weatherState.duration = 8; }
  if (t[sc]) { b.field.setTerrain(t[sc], f); if (b.field.terrainState) b.field.terrainState.duration = 8; }
  if (sc === 'trickroom') b.field.addPseudoWeather('trickroom', f);
  const side = (s: any, id: string) => s.addSideCondition(id, s.active[0]);
  if (sc === 'reflect-foe') { side(p2, 'reflect'); return ev('opponent', 'Reflect'); }
  if (sc === 'lightscreen-foe') { side(p2, 'lightscreen'); return ev('opponent', 'Light Screen'); }
  if (sc === 'reflect-own') { side(p1, 'reflect'); return ev('player', 'Reflect'); }
  if (sc === 'rocks-own') { side(p1, 'stealthrock'); return ev('opponent', 'Stealth Rock'); }
  if (sc === 'spikes-own') { side(p1, 'spikes'); side(p1, 'spikes'); return [...ev('opponent', 'Spikes'), ...ev('opponent', 'Spikes')]; }
  if (sc === 'tailwind-foe') { side(p2, 'tailwind'); return ev('opponent', 'Tailwind'); }
  if (sc === 'tailwind-own') { side(p1, 'tailwind'); return ev('player', 'Tailwind'); }
  return [];
}

if (MODE === 'selftest') {
  const set = (name: string, moves: string[], item = ''): MonSet => ({ species: byName[name], name, level: 50, moves, ability: 'Pressure', item, nature: 'Hardy', ivs: st(31), evs: st(0) });
  const T = { p1: [set('Snorlax', ['tackle', 'rest']), set('Pikachu', ['thunderbolt'])], p2: [set('Blissey', ['seismictoss']), set('Chansey', ['seismictoss'])] };
  const mk = () => { const b = new Battle({ formatid: 'gen9customgame', seed: [1, 2, 3, 4] as any, p1: { name: 'You', team: pack(T.p1) }, p2: { name: 'Foe', team: pack(T.p2) } } as any); b.choose('p1', 'default'); b.choose('p2', 'default'); return b; };
  const r = () => 0.5; const toss: Pol = (b, side) => side.requestState === 'switch' ? 'switch 2' : 'move 1';
  let ok = 0; const is = (n: string, x: any, y: any) => { if (JSON.stringify(x) !== JSON.stringify(y)) console.log('FAIL', n, x, y); else { ok++; } };
  { const b = mk(); const me = b.sides[0].active[0], f = b.sides[1].active[0]; me.hp = 60; const bags = { me: { hyperpotion: 1 }, foe: {} };
    step(b, T, 'item~hyperpotion~Snorlax', toss, r, bags); is('hyper potion: +120, then Seismic Toss 50', me.hp, 130); is('no move that turn', f.hp, f.maxhp); is('bag spent', bags.me.hyperpotion, 0); is('pp not used', me.moveSlots[0].pp, me.moveSlots[0].maxpp);
    step(b, T, 'move 1', toss, r, bags); is('can move the next turn', f.hp < f.maxhp, true); }
  { const b = mk(); const me = b.sides[0].active[0]; me.setStatus('par'); is('par on', me.status, 'par'); const bags = { me: { fullheal: 1 }, foe: {} }; step(b, T, 'item~fullheal~Snorlax', toss, r, bags); is('status cured', me.status, ''); }
  { const b = mk(); const pk = b.sides[0].pokemon[1]; pk.hp = 0; pk.fainted = true; b.sides[0].pokemonLeft--; const bags = { me: { revive: 1 }, foe: {} }; step(b, T, 'item~revive~Pikachu', toss, r, bags); is('revived at half', [pk.fainted, pk.hp, b.sides[0].pokemonLeft], [false, Math.floor(pk.maxhp / 2), 2]); step(b, T, 'switch 2', toss, r, bags); is('revived one can be sent in', b.sides[0].active[0].set.name, 'Pikachu');
    const j = Battle.fromJSON(b.toJSON()); is('survives save/load', j.sides[0].active[0].set.name, 'Pikachu'); }
  { const b = mk(); const f = b.sides[1].active[0], me = b.sides[0].active[0]; f.hp = 20; const bags = { me: {}, foe: { fullrestore: 1 } }; const before = me.hp; step(b, T, 'move 1', toss, r, bags); is('NPC used Full Restore and did not attack', [me.hp === before, f.hp > f.maxhp * 0.6, bags.foe.fullrestore], [true, true, 0]); }
  { const b = mk(); const me = b.sides[0].active[0]; me.moveSlots[0].pp = 0; const bags = { me: { ether: 1 }, foe: {} }; step(b, T, 'item~ether~Snorlax~tackle', toss, r, bags); is('ether +10', me.moveSlots[0].pp, 10); }
  { const b = mk(); const me = b.sides[0].active[0]; const bags = { me: { potion: 1 }, foe: {} }; step(b, T, 'item~potion~Snorlax', toss, r, bags); is('potion at full HP is refused', bags.me.potion, 1); }
  console.log('selftest ok', ok);
  process.exit(0);
}

const write = (o: any) => fs.appendFileSync(OUT, JSON.stringify(o) + '\n');
const rndBag = (): Bag => { const g: Bag = {}; if (!BAG) return g; for (const [id, n] of [['superpotion', 2], ['hyperpotion', 2], ['fullrestore', 1], ['fullheal', 1], ['revive', 1], ['maxrevive', 1], ['paralyzeheal', 1], ['awakening', 1], ['ether', 1], ['maxpotion', 1]] as any) if (rnd() < 0.5) g[id] = n; return g; };
for (let n = 0; n < BATTLES; n++) {
  const foe = await foeTeam(SIZE);
  const lv = Math.round(foe.team.reduce((x, m) => x + m.level, 0) / foe.team.length);
  const mine = await team(foe.team.length, lv, true);
  const T = { p1: mine, p2: foe.team };
  const seed = [Math.floor(rnd() * 65536), Math.floor(rnd() * 65536), Math.floor(rnd() * 65536), Math.floor(rnd() * 65536)];
  const sc = SCEN[(n + Number(process.argv[2])) % SCEN.length];
  const bag0 = rndBag();
  const medList = NPCMED ? foe.meds : [];
  const meds0: Bag = {}; for (const m of medList) meds0[m] = (meds0[m] ?? 0) + 1;
  const start = () => {
    const b = new Battle({ formatid: 'gen9customgame', seed: seed as any, p1: { name: 'You', team: pack(mine) }, p2: { name: 'Foe', team: pack(foe.team) } } as any);
    b.choose('p1', 'default'); b.choose('p2', 'default');
    return b;
  };
  const fresh = () => ({ me: { ...bag0 }, foe: { ...meds0 } });
  try {
    if (MODE === 'match') {
      const res: any = { n, sc, size: foe.team.length, meds: medList, bag: Object.keys(bag0).length };
      for (const k of (process.env.ONLY ?? 'advItems,advNoItems,greedy,greedyHeal,smartHeal').split(',')) {
        const b = start(); const extra = inject(b, sc); const bags = fresh();
        let q = seed[0]; const r = () => { q = (Math.imul(q, 1664525) + 1013904223) | 0; return (q >>> 0) / 4294967296; };
        const used: string[] = [];
        for (let i = 0; i < 150 && !b.ended; i++) {
          const p1 = b.sides[0];
          let c: any = 'default';
          if (p1.requestState && !p1.isChoiceDone()) {
            if (k === 'advItems') c = advise(b, T, foe.name, extra, bags.me, medList).choice.cmd;
            else if (k === 'advNoItems') c = advise(b, T, foe.name, extra, undefined, medList).choice.cmd;
            else if (k === 'greedy') c = greedy(b, p1, T, r);
            // Ablations (no items): which part of the advice costs wins? Moves, voluntary switches or replacements.
            else if (k === 'advNoSw') { const a = advise(b, T, foe.name, extra, undefined, medList); c = p1.requestState === 'switch' ? a.choice.cmd : topMove(a, () => greedy(b, p1, T, r)); }
            else if (k === 'advForced') c = p1.requestState === 'switch' ? advise(b, T, foe.name, extra, undefined, medList).choice.cmd : greedy(b, p1, T, r);
            else if (k === 'advSw') { c = advise(b, T, foe.name, extra, undefined, medList).choice.cmd; if (p1.requestState === 'switch' || !c.startsWith('switch')) c = greedy(b, p1, T, r); }
            else if (k === 'smart') c = smart(b, p1, T, r);
            else if (k === 'greedyHeal') c = healCmd(b, p1, T, bags.me) ?? greedy(b, p1, T, r);
            else c = healCmd(b, p1, T, bags.me) ?? smart(b, p1, T, r);
            if (c.startsWith('item~')) used.push(b.turn + ':' + c.slice(5));
          }
          step(b, T, c, npc, r, bags);
        }
        res[k] = outcome(b); res[k + 'Win'] = b.winner === 'You' ? 1 : 0; res[k + 'X'] = [b.ended, b.turn, b.__sw ?? 0, b.__fail ?? 0, b.__why, b.__it ?? 0, b.__badItem, used, b.__loop ?? 0];
      }
      write(res);
      continue;
    }
    if (MODE === 'flip') {
      // Same state, foe HP shown as 100% or as it is: logs the turns where the advice changes (plays the real one).
      const b = start(); const extra = inject(b, sc); const bags = fresh();
      let q = seed[0]; const r = () => { q = (Math.imul(q, 1664525) + 1013904223) | 0; return (q >>> 0) / 4294967296; };
      for (let i = 0; i < 150 && !b.ended; i++) {
        const p1 = b.sides[0];
        let c: any = 'default';
        if (p1.requestState && !p1.isChoiceDone()) {
          process.env.HPFULL = '1';
          const full = advise(b, T, foe.name, extra, undefined, medList);
          delete process.env.HPFULL;
          const real = advise(b, T, foe.name, extra, undefined, medList);
          c = real.choice.cmd;
          const a = p1.active[0], d = b.sides[1].active[0];
          const row = (x: any) => x.adv.actions.filter((y: any) => y.score !== null).slice(0, 4).map((y: any) => [y.label, y.score, y.ko ?? '', y.line ?? '']);
          write({ n, turn: b.turn, forced: p1.requestState === 'switch', real: real.choice, full: full.choice, g: greedy(b, p1, T, r), flip: real.choice.cmd !== full.choice.cmd,
            hp: a.hp / a.maxhp, foeHp: d.hp / d.maxhp, me: a.set.name, foe: d.set.name, benchHp: p1.pokemon.filter((x: any) => !x.isActive && !x.fainted).map((x: any) => +(x.hp / x.maxhp).toFixed(2)), left: b.sides[1].pokemonLeft, top: row(real), topFull: row(full), koNow: real.adv.actions.find((y: any) => y.kind === 'move' && y.ko === 'sure') ? 'sure' : real.adv.actions.find((y: any) => y.kind === 'move' && y.ko) ? 'chance' : '', threat: real.adv.threat && { ko: real.adv.threat.ko, first: real.adv.threat.youFirst, p: real.adv.threat.koChance } });
        }
        step(b, T, c, npc, r, bags);
      }
      continue;
    }
    const b = start(); const extra = inject(b, sc); const bags = fresh();
    let q = seed[1]; const r = () => { q = (Math.imul(q, 1664525) + 1013904223) | 0; return (q >>> 0) / 4294967296; };
    for (let i = 0; i < 80 && !b.ended; i++) {
      const p1 = b.sides[0];
      if (!p1.requestState || p1.isChoiceDone()) { step(b, T, 'default', npc, r, bags); continue; }
      const { opts, choice, noItem, itemOpt, adv } = advise(b, T, foe.name, extra, bags.me, medList);
      const g = greedy(b, p1, T, r), h = healCmd(b, p1, T, bags.me);
      if (itemOpt || h) {
        const json = b.toJSON();
        const cmds = [...new Set([choice.cmd, noItem.cmd, itemOpt?.cmd, g, h].filter(Boolean))] as string[];
        const val = Object.fromEntries(cmds.map((c) => [c, Array.from({ length: ROLL }, (_, k) => rollout(json, T, c, npc, 1000 + k * 77 + i, smart, bags))]));
        const snap = snapshot(b, T, foe.name, extra);
        write({ n, sc, size: foe.team.length, turn: b.turn, choice: choice.cmd, choiceLabel: choice.label, noItem: noItem.cmd, noItemLabel: noItem.label, noItemScore: noItem.score, item: itemOpt?.cmd, itemScore: itemOpt?.score, heal: h, greedy: g, val,
          me: { ...snap.player, ability: p1.active[0].ability, vol: Object.keys(p1.active[0].volatiles) }, foe: { ...snap.opponent, ability: b.sides[1].active[0].ability, moves: b.sides[1].active[0].moveSlots.map((m: any) => m.id) }, boosts: snap.boosts, meds: bags.foe, bag: { ...bags.me },
          reasons: adv.actions.filter((x: any) => x.score !== null).slice(0, 8).map((x: any) => [x.label, x.score, x.reason]) });
      }
      step(b, T, choice.cmd, npc, r, bags);
    }
  } catch (e: any) { write({ n, sc, error: String(e?.stack ?? e).slice(0, 700) }); }
}
if (MODE === 'match') fs.writeFileSync(OUT + '.items.json', JSON.stringify(itemStats));
