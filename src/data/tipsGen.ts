import type { GameTip, TipCategory, TipSource } from '../shared/types';
import { KEY_ITEM_STAGE, REGION_STAGE } from './tips';

/**
 * Builds progression tips from the wiki's own data file at sync time, so they stay
 * current when the game updates. Every step here is either a wiki data string or a
 * fact assembled from structured fields (ids, chances, level caps); each tip names
 * the data field it came from. Nothing is invented: when a field is missing, the
 * tip (or step) is simply left out.
 */

type Raw = Record<string, any>;

const D = (ref: string): TipSource => ({ kind: 'data', ref });

function lines(s: unknown): string[] {
  if (typeof s !== 'string') return [];
  return s.split('\n').map((l) => l.trim()).filter(Boolean);
}

function pct(x: number): string {
  const v = x * 100;
  return `${v >= 1 ? +v.toFixed(1) : +v.toPrecision(2)}%`;
}

function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

function namesList(names: string[], per = 24): string[] {
  const out: string[] = [];
  for (let i = 0; i < names.length; i += per) out.push(names.slice(i, i + per).join(', '));
  return out;
}

/** Shared lookups over the raw wiki data. */
class Ctx {
  items = new Map<string, Raw>();
  species = new Map<number, Raw>();
  challenges = new Map<string, Raw>();
  champions = new Map<string, Raw>(); // region id -> champion
  moves = new Map<string, Raw>();
  /** [lower-case name, map id], longest first – for tagging maps named in prose. */
  mapNames: [string, string][] = [];
  mapName = new Map<string, string>();

  constructor(raw: Raw) {
    for (const i of raw.items ?? []) this.items.set(i.id, i);
    for (const s of raw.species ?? []) this.species.set(s.id, s);
    for (const m of raw.moves ?? []) this.moves.set(m.id, m);
    for (const c of raw.challenges ?? []) {
      this.challenges.set(c.id, c);
      if (c.category === 'champion' && c.region) this.champions.set(c.region, c);
    }
    const names: [string, string][] = [];
    for (const m of raw.maps ?? []) {
      this.mapName.set(m.id, String(m.name ?? m.id).split(' · ')[0]);
      for (const part of String(m.name ?? '').split(' · ')) if (part.length > 3) names.push([part.toLowerCase(), m.id]);
      for (const s of m.sections ?? []) {
        const n = String(s.name ?? '');
        if (n.length > 5 && !/^section/i.test(n)) names.push([n.toLowerCase(), m.id]);
      }
    }
    this.mapNames = names.sort((a, b) => b[0].length - a[0].length);
  }

  itemName(id: string): string {
    return this.items.get(id)?.name ?? id;
  }

  /** Map ids whose names appear in a text (longest name wins, so "Upper Caves" is not also "Caves"). */
  mapsIn(text: string): string[] {
    let t = text.toLowerCase().replace(/’/g, "'");
    const out: string[] = [];
    for (const [name, id] of this.mapNames) {
      const n = name.replace(/’/g, "'");
      if (t.includes(n)) {
        out.push(id);
        t = t.split(n).join(' ');
      }
    }
    return uniq(out);
  }

  /** League trainers named in a text together with their region ("Defeat Misty in the Kanto League"). */
  npcsIn(text: string): Raw[] {
    const out: Raw[] = [];
    for (const c of this.challenges.values()) {
      if (!c.name || !c.regionName) continue;
      const re = new RegExp(`(^|[^\\w])${c.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\w]|$)`);
      if (re.test(text) && text.includes(c.regionName)) out.push(c);
    }
    return out;
  }

  label(c: Raw): string {
    return `${c.regionName} ${c.title} ${c.name}`;
  }

  stage(c: Raw | undefined): number | undefined {
    return c ? REGION_STAGE[c.region] : undefined;
  }

  /** "Where to get it" lines for an item, from every source field the wiki data has. */
  whereToGet(i: Raw): string[] {
    const out: string[] = [];
    const first = (f: string, prefix = '') => {
      const l = lines(i[f]);
      if (l.length) out.push(prefix + l.join(' '));
    };
    first('keyItemSource');
    first('challengeSource');
    if (Array.isArray(i.gymSources) && i.gymSources.length) {
      const who = i.gymSources.map((id: string) => this.challenges.get(id)).filter((c: Raw | undefined): c is Raw => !!c).map((c: Raw) => this.label(c));
      if (who.length) out.push(`League reward: ${who.join(', ')}.`);
    }
    for (const t of (this.towersByReward.get(i.id) ?? [])) out.push(`${t.name}: ${pct(t.rewardChance ?? 0)} per clear.`);
    for (const f of ['rematchSource', 'rivalsSource', 'questSource', 'catchlistSource', 'starterTasksSource', 'achievementSource', 'npcGiftSource', 'hikerSource', 'wanderingSource', 'mapItemSource', 'dowsingSource', 'miningSource', 'berrySource', 'pickupSource', 'honeyGatherSource']) {
      const l = lines(i[f]);
      if (l.length) out.push(l[0]);
    }
    first('universalWildSource');
    if (Array.isArray(i.wildSources) && i.wildSources.length) {
      const top = [...i.wildSources].sort((a, b) => (b.chance ?? 0) - (a.chance ?? 0)).slice(0, 4);
      out.push(`Held by wild ${top.map((w: Raw) => `${this.species.get(w.species)?.name ?? `#${w.species}`} (${pct(w.chance ?? 0)})`).join(', ')}${i.wildSources.length > 4 ? ` and ${i.wildSources.length - 4} more` : ''} – catch it to keep the item.`);
    }
    if (typeof i.shopPrice === 'number') out.push(`Shop: ${i.shopPrice.toLocaleString('en-US')} Pokécoins.`);
    if (typeof i.tokenShopPrice === 'number') out.push(`Pokétoken Shop: ${i.tokenShopPrice.toLocaleString('en-US')} Pokétokens.`);
    if (typeof i.battlePointShopPrice === 'number') out.push(`Battle Point shop: ${i.battlePointShopPrice} BP.`);
    return uniq(out);
  }

  towersByReward = new Map<string, Raw[]>();
}

/* ---------- league order ---------- */

function leagueTips(raw: Raw, ctx: Ctx): GameTip[] {
  const byRegion = new Map<string, Raw[]>();
  for (const c of raw.challenges ?? []) {
    if (!c.region) continue;
    if (!byRegion.has(c.region)) byRegion.set(c.region, []);
    byRegion.get(c.region)!.push(c);
  }
  const out: GameTip[] = [];
  for (const [region, list] of byRegion) {
    const steps = new Map<number, Raw[]>();
    for (const c of list) {
      const n = (c.prerequisiteTrainerIds ?? []).length;
      if (!steps.has(n)) steps.set(n, []);
      steps.get(n)!.push(c);
    }
    const ordered = [...steps.entries()].sort((a, b) => a[0] - b[0]).map(([, cs]) => cs);
    const lineFor = (cs: Raw[]) => {
      const c = cs[0];
      const who = cs.map((x) => x.name).join(' or ');
      const bits = [c.title];
      const badges = uniq(cs.map((x) => x.badge).filter(Boolean));
      if (badges.length) bits.push(`${badges.join('/')} Badge`);
      if (c.levelCap) bits.push(`team cap Lv ${c.levelCap}`);
      const special = uniq(cs.flatMap((x) => (x.rewardItems ?? []).filter((id: string) => /^hm/.test(id) || ctx.items.get(id)?.category === 'key-items')));
      if (special.length) bits.push(`gives ${special.map((id) => ctx.itemName(id).replace(' · ', ' ')).join(', ')}`);
      return `${who} – ${bits.join(' · ')}`;
    };
    const champ = ctx.champions.get(region);
    const regionName = list[0].regionName ?? region;
    out.push({
      id: `league:${region}`,
      title: `${regionName} League: who to beat, in order`,
      category: 'battling',
      steps: ordered.map(lineFor),
      npcs: list.map((c) => `challenge:${c.id}`),
      items: uniq(list.flatMap((c) => c.rewardItems ?? [])),
      source: [D('challenges[].prerequisiteTrainerIds, levelCap, badge, rewardItems')],
      stage: REGION_STAGE[region],
      order: -1,
      keywords: ['league', 'gym', 'badge', 'elite four', 'champion', 'level cap', regionName],
      ...(champ ? {} : { requires: ['This region has no Champion in the current data.'] }),
    });
  }
  return out;
}

/* ---------- HMs ---------- */

function hmTips(raw: Raw, ctx: Ctx): GameTip[] {
  const out: GameTip[] = [];
  for (const i of raw.items ?? []) {
    if (!/^hm/.test(i.id) || i.category !== 'tms') continue;
    const givers = (raw.challenges ?? []).filter((c: Raw) => (c.rewardItems ?? []).includes(i.id));
    const moveName = ctx.moves.get(i.moveId)?.name ?? String(i.name ?? '').split(' · ').pop() ?? i.moveId ?? '';
    const learners = (raw.species ?? []).filter((s: Raw) => (s.machineMoves ?? []).includes(i.moveId)).length;
    const steps = [
      ...givers.map((c: Raw) => `Defeat ${ctx.label(c)}${c.levelCap ? ` (team cap Lv ${c.levelCap})` : ''}.`),
      ...lines(i.challengeSource),
      ...(learners ? [`${learners} species can learn ${moveName}; the HM is reusable.`] : []),
    ];
    out.push({
      id: `hm:${i.id}`,
      title: `Get ${String(i.name).replace(' · ', ' ')}`,
      category: 'hm',
      steps: uniq(steps),
      requires: givers.map((c: Raw) => `Defeat ${ctx.label(c)}`),
      items: [i.id],
      moves: i.moveId ? [i.moveId] : [],
      npcs: givers.map((c: Raw) => `challenge:${c.id}`),
      source: [D('challenges[].rewardItems'), D('items[].challengeSource')],
      stage: ctx.stage(givers[0]),
      order: 1,
      keywords: ['hm', 'field move', moveName],
    });
  }
  return out;
}

/* ---------- key items and exploration items ---------- */

const CATCHING_ITEMS = new Set(['repel', 'superrepel', 'maxrepel', 'incense', 'honey', 'guardianangel', 'safariticket']);

function itemTips(raw: Raw, ctx: Ctx): GameTip[] {
  const out: GameTip[] = [];
  for (const i of raw.items ?? []) {
    const isKey = i.category === 'key-items';
    const isExplore = i.category === 'exploration' || i.category === 'breeding';
    if (!isKey && !isExplore) continue;
    const how = isKey ? lines(i.keyItemSource) : [];
    const where = ctx.whereToGet(i).filter((l) => !how.includes(l));
    const usage: string[] = (i.usageSections?.[0]?.points ?? []).slice(0, 2);
    const text = [...how, ...where].join(' ');
    const gyms = (i.gymSources ?? []).map((id: string) => ctx.challenges.get(id)).filter(Boolean) as Raw[];
    const givers = (raw.challenges ?? []).filter((c: Raw) => (c.rewardItems ?? []).includes(i.id));
    const named = ctx.npcsIn(text);
    const npcs = uniq([...gyms, ...givers, ...named]);
    const champ = npcs.find((c) => c.category === 'champion') ?? npcs[0];
    const stage = KEY_ITEM_STAGE[i.id] ?? (isKey ? ctx.stage(champ) : undefined);
    const steps = [...how, ...where];
    if (!steps.length) continue;
    out.push({
      id: `item:${i.id}`,
      title: isKey ? `Get the ${i.name}` : `${i.name}: what it does and where to get it`,
      category: CATCHING_ITEMS.has(i.id) ? 'catching' : 'key',
      steps: [...steps, ...(i.description ? [`What it does: ${i.description}`] : []), ...usage],
      requires: champ?.category === 'champion' ? [`Defeat ${ctx.label(champ)}`] : undefined,
      items: [i.id],
      maps: ctx.mapsIn(text),
      npcs: npcs.map((c) => `challenge:${c.id}`),
      source: [D(isKey ? 'items[].keyItemSource' : 'items[] sources and description')],
      stage,
      // Path placements we chose ourselves go after that stage's map tips.
      order: KEY_ITEM_STAGE[i.id] !== undefined ? 20 : 2,
      keywords: [isKey ? 'key item' : 'item'],
    });
  }
  return out;
}

/* ---------- wild spawn unlocks ---------- */

function spawnTips(raw: Raw, ctx: Ctx): GameTip[] {
  const groups = new Map<string, { title: string; stage?: number; npc?: Raw; species: Raw[]; category: TipCategory; head: string[] }>();
  const out: GameTip[] = [];
  const mapsOf = (s: Raw) => uniq<string>((s.locations ?? []).map((l: Raw) => l.mapId).filter(Boolean));
  const where = (s: Raw) => mapsOf(s).map((id) => ctx.mapName.get(id) ?? id).join(', ') || 'no map listed';

  for (const s of raw.species ?? []) {
    const req: string | undefined = s.spawnRequirement ? String(s.spawnRequirement) : undefined;
    if (!req) continue;
    const champM = req.match(/^Defeat (\w+) (?:Champion|League challenger) ([^\s.]+) to unlock this spawn\.(.*)$/);
    const champ = champM ? [...ctx.champions.values()].find((c) => c.regionName === champM[1] && c.name === champM[2]) : undefined;
    const extra = champM ? champM[3].trim() : req;
    if (champM && !extra) {
      const key = `champ:${champ?.id ?? champM[1]}`;
      const who = champ ? ctx.label(champ) : `${champM[1]} ${champM[2]}`;
      if (!groups.has(key)) groups.set(key, { title: `Wild spawns unlocked by ${who}`, stage: ctx.stage(champ), npc: champ, species: [], category: 'catching', head: [`Defeat ${who}; then these can appear in the wild:`] });
      groups.get(key)!.species.push(s);
      continue;
    }
    if (/only ·/.test(req)) {
      const key = 'season';
      if (!groups.has(key)) groups.set(key, { title: 'Seasonal wild spawns', species: [], category: 'catching', head: ['Some forms only spawn in one season (UTC dates):'] });
      groups.get(key)!.species.push(s);
      continue;
    }
    if (!s.spawnItem && /ribbons|not available/i.test(req)) {
      const key = /not available/i.test(req) ? 'unavailable' : 'all-champions';
      if (!groups.has(key)) groups.set(key, { title: /not available/i.test(req) ? 'Spawns that cannot appear yet' : 'Spawns that need every regional Champion', species: [], category: 'catching', head: [req] });
      groups.get(key)!.species.push(s);
      continue;
    }
    // A spawn with its own extra condition (item, team) gets its own tip.
    const item = s.spawnItem ? ctx.items.get(s.spawnItem) : undefined;
    const itemWhere = item ? ctx.whereToGet(item) : [];
    out.push({
      id: `spawn:${s.id}`,
      title: `Make ${s.name} appear`,
      category: 'catching',
      steps: [req, ...(item ? itemWhere.map((l) => `${item.name}: ${l}`) : []), `Spawns in: ${where(s)}.`],
      requires: champ ? [`Defeat ${ctx.label(champ)}`] : undefined,
      species: [s.id],
      maps: mapsOf(s),
      items: item ? [item.id] : [],
      npcs: champ ? [`challenge:${champ.id}`] : [],
      source: [D('species[].spawnRequirement'), ...(item ? [D('species[].spawnItem + items[] sources')] : [])],
      stage: ctx.stage(champ),
      order: 4,
      keywords: ['legendary', 'spawn', 'unlock', s.name],
    });
  }
  for (const [key, g] of groups) {
    const lines2 = g.species.map((s) => `${s.name}${key === 'season' ? ` – ${s.spawnRequirement}` : ''} (${where(s)})`);
    out.push({
      id: `spawns:${key}`,
      title: g.title,
      category: g.category,
      steps: [...g.head, ...lines2],
      requires: g.npc ? [`Defeat ${ctx.label(g.npc)}`] : undefined,
      species: g.species.map((s) => s.id),
      maps: uniq(g.species.flatMap(mapsOf)),
      npcs: g.npc ? [`challenge:${g.npc.id}`] : [],
      source: [D('species[].spawnRequirement, locations')],
      stage: g.stage,
      order: 3,
      keywords: ['legendary', 'spawn', 'unlock'],
    });
  }
  return out;
}

/* ---------- battle towers ---------- */

function towerTips(raw: Raw, ctx: Ctx): GameTip[] {
  return (raw.battleTowers ?? []).map((t: Raw): GameTip => {
    const champ = t.championId ? ctx.challenges.get(t.championId) : undefined;
    const reward = t.reward ? ctx.itemName(t.reward) : undefined;
    return {
      id: `tower:${t.id}`,
      title: `Unlock ${t.name}`,
      category: 'battling',
      steps: [
        ...(t.requirement ? [String(t.requirement)] : []),
        `${t.guardian ?? 'Guardian'}${t.type ? ` · ${t.type} theme` : ''} · ${(t.team ?? []).length} Pokémon in one battle.`,
        ...(reward ? [`Reward: ${reward} (${pct(t.rewardChance ?? 0)} per clear)${t.coins ? `, ${Number(t.coins).toLocaleString('en-US')} coins` : ''}${t.tm ? `, ${ctx.itemName(t.tm)}` : ''}.`] : []),
      ],
      requires: champ ? [`Defeat ${ctx.label(champ)}`] : undefined,
      npcs: [`tower:${t.id}`, ...(champ ? [`challenge:${champ.id}`] : [])],
      items: [t.reward, t.tm].filter(Boolean),
      source: [D('battleTowers[].requirement, reward, rewardChance')],
      stage: ctx.stage(champ),
      order: 5,
      keywords: ['battle tower', 'tower'],
    };
  });
}

/* ---------- "which activity gives which items" ---------- */

const SOURCE_GROUPS: { field: string; id: string; title: string; category: TipCategory; stage?: number }[] = [
  { field: 'catchlistSource', id: 'catchlist', title: 'Weekly Catchlist rewards', category: 'daily' },
  { field: 'questSource', id: 'quests', title: 'Items from Daily and Weekly Quests', category: 'daily' },
  { field: 'starterTasksSource', id: 'tasks', title: 'Task tier rewards (Starter to Master)', category: 'start' },
  { field: 'achievementSource', id: 'achievements', title: 'Achievement rewards', category: 'start' },
  { field: 'mapItemSource', id: 'chests', title: 'Map chest loot', category: 'daily' },
  { field: 'dowsingSource', id: 'dowsing', title: 'Dowsing Machine finds', category: 'daily' },
  { field: 'miningSource', id: 'mining', title: 'Underground mining finds', category: 'daily' },
  { field: 'hikerSource', id: 'hikers', title: 'Underground hiker shops', category: 'daily' },
  { field: 'wanderingSource', id: 'wandering', title: 'Wandering trainer trade items', category: 'daily' },
  { field: 'berrySource', id: 'berries', title: 'Berry patches', category: 'daily' },
  { field: 'pickupSource', id: 'pickup', title: 'Items found by Pickup', category: 'catching' },
  { field: 'rivalsSource', id: 'rivals', title: 'Rival battle drops', category: 'battling' },
  { field: 'rematchSource', id: 'rematch', title: 'Champion rematch exclusives', category: 'battling' },
];

function sourceTips(raw: Raw, ctx: Ctx): GameTip[] {
  const out: GameTip[] = [];
  const all: Raw[] = raw.items ?? [];
  for (const g of SOURCE_GROUPS) {
    const list = all.filter((i) => typeof i[g.field] === 'string' && i[g.field].trim());
    if (!list.length) continue;
    // Rule lines shared by at least half of the items describe the activity itself.
    const count = new Map<string, number>();
    for (const i of list) for (const l of uniq(lines(i[g.field]))) count.set(l, (count.get(l) ?? 0) + 1);
    const shared = [...count.entries()].filter(([, n]) => n >= Math.max(2, list.length / 2)).map(([l]) => l).slice(0, 4);
    out.push({
      id: `source:${g.id}`,
      title: g.title,
      category: g.category,
      steps: [...(shared.length ? shared : lines(list[0][g.field]).slice(0, 1)), ...namesList(list.map((i) => i.name)).map((n, k) => (k ? n : `Items (${list.length}): ${n}`))],
      items: list.map((i) => i.id),
      source: [D(`items[].${g.field}`)],
      keywords: [g.title],
    });
  }
  const priced = (field: string, id: string, title: string, unit: string, category: TipCategory) => {
    const list = all.filter((i) => typeof i[field] === 'number').sort((a, b) => a[field] - b[field]);
    if (!list.length) return;
    out.push({
      id: `source:${id}`,
      title,
      category,
      steps: namesList(list.map((i) => `${i.name} ${Number(i[field]).toLocaleString('en-US')} ${unit}`), 12),
      items: list.map((i) => i.id),
      source: [D(`items[].${field}`)],
      keywords: [title, 'shop', 'buy'],
    });
  };
  priced('shopPrice', 'shop', 'Shop prices', 'coins', 'start');
  priced('tokenShopPrice', 'tokenshop', 'Pokétoken Shop prices', 'tokens', 'start');
  priced('battlePointShopPrice', 'bpshop', 'Battle Point shop prices', 'BP', 'battling');
  const gymTms = all.filter((i) => i.category === 'tms' && Array.isArray(i.gymSources) && i.gymSources.length);
  if (gymTms.length) {
    out.push({
      id: 'source:leaguetms',
      title: 'TMs from League trainers',
      category: 'battling',
      steps: gymTms.map((i) => `${i.name}: ${i.gymSources.map((id: string) => ctx.challenges.get(id)?.name ?? id).join(', ')}`),
      items: gymTms.map((i) => i.id),
      npcs: uniq(gymTms.flatMap((i) => i.gymSources.map((id: string) => `challenge:${id}`))),
      source: [D('items[].gymSources')],
      keywords: ['tm', 'league'],
    });
  }
  return out;
}

/* ---------- special evolution methods ---------- */

const EVO_GROUPS: { method: string; title: string }[] = [
  { method: 'trade', title: 'Trade evolutions' },
  { method: 'held-item', title: 'Evolutions that need a held item' },
  { method: 'friendship', title: 'Friendship evolutions' },
  { method: 'time', title: 'Day or night evolutions' },
  { method: 'move', title: 'Evolutions that need a known move' },
  { method: 'battle', title: 'Evolutions earned in battle' },
  { method: 'walking', title: 'Walking evolutions' },
  { method: 'party', title: 'Evolutions that need a team member' },
  { method: 'gender', title: 'Gender-based evolutions' },
  { method: 'stats', title: 'Stat-based evolutions' },
  { method: 'coins', title: 'Evolutions that cost Pokécoins' },
  { method: 'bonus', title: 'Bonus Pokémon from evolving' },
  { method: 'branch', title: 'Branching evolutions' },
];

function evolutionTips(raw: Raw, ctx: Ctx): GameTip[] {
  const out: GameTip[] = [];
  const list: Raw[] = raw.evolutionMethods ?? [];
  const name = (id: number) => ctx.species.get(id)?.name ?? `#${id}`;
  for (const g of EVO_GROUPS) {
    const rows = list.filter((e) => (e.methods ?? []).includes(g.method) && !(e.methods ?? []).includes('mega'));
    if (!rows.length) continue;
    out.push({
      id: `evo:${g.method}`,
      title: g.title,
      category: 'evolution',
      steps: ['Evolve from My Pokémon → Evolve once the condition is met.', ...rows.map((e) => `${name(e.from)} → ${name(e.to)}: ${e.requirement ?? (e.methods ?? []).join(', ')}`)],
      species: uniq(rows.flatMap((e) => [e.from, e.to])),
      source: [D('evolutionMethods[]')],
      keywords: ['evolve', 'evolution', g.method],
    });
  }
  return out;
}

/** All data-derived tips. Safe on partial data: missing sections are skipped. */
export function generateTips(raw: Raw): GameTip[] {
  const ctx = new Ctx(raw);
  for (const t of raw.battleTowers ?? []) {
    if (!t.reward) continue;
    if (!ctx.towersByReward.has(t.reward)) ctx.towersByReward.set(t.reward, []);
    ctx.towersByReward.get(t.reward)!.push(t);
  }
  const tips = [
    ...leagueTips(raw, ctx),
    ...hmTips(raw, ctx),
    ...itemTips(raw, ctx),
    ...spawnTips(raw, ctx),
    ...towerTips(raw, ctx),
    ...sourceTips(raw, ctx),
    ...evolutionTips(raw, ctx),
  ];
  // Drop empty optional arrays to keep the cached dataset small.
  for (const t of tips) {
    for (const k of ['maps', 'items', 'npcs', 'moves', 'species', 'requires'] as const) {
      const v = t[k] as unknown[] | undefined;
      if (v && !v.length) delete t[k];
    }
  }
  return tips;
}
