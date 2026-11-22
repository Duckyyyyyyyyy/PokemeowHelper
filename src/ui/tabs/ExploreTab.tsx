import { effect, signal } from '@preact/signals';
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { Dataset } from '../../shared/types';
import { Empty, Tip, Types } from '../components/common';
import { NoData } from './shared';
import { box, dataset, selectedNpc, selectedVariant } from '../store';
import { battle } from '../battleStore';
import { loadSampleWild, wild } from '../wildStore';
import type { WildSnapshot } from '../../shared/wild';
import { ownedItems, bag } from '../bagStore';
import {
  fightOrCatch, filterEncounters, isFishing, mapForCard, speciesByCardName, METHOD_LABEL, ownedSpecies, RARITY_LABEL, wantedSpecies, whereToFind, wildHeldItems,
  type EncounterRow,
} from '../../engine/explore';
import { ballItems, BALL_RULES, isUltraBeast, NOT_AWARDED, rankBalls, type BallAdvice, type BallOption } from '../../engine/catching';
import { afterPlan, STATUS_LABEL, type CatchPlan, type StatusOption, type WeakenOption } from '../../engine/catchPlan';
import { teamCatchPlan } from '../../engine/catchTeam';
import type { RosterMon } from '../../shared/battle';
import { defeatPlan } from '../../engine/wildDefeat';
import { Action } from './BattleTab';
import type { BoxMon } from '../../shared/types';
import { matchNpc, lc } from '../../engine/turnAdvisor';
import { ALL_TYPES } from '../../engine/typeChart';
import { MapTips } from './TipsTab';
import { huntBySpecies } from '../huntStore';

type View = 'maps' | 'encounter' | 'balls';
const view = signal<View>('maps');

/** The wild Pokémon being advised on (kept across tab switches). */
interface Target {
  species: number;
  level: number;
  mapId: string;
  method: string;
  item: string;
  shiny: boolean;
  goodIvs: boolean;
  status: string;
  hpPct: number;
  turn: number;
  throws: number;
  /** Filled from the game's encounter card (live). */
  inBox?: number;
  registered?: boolean;
  catchlist?: boolean;
  myLevel?: number;
  /** Quick-catch ball counts shown on the card, by item id. */
  cardBalls?: [string, number][];
  /** Encounter identity when it came from the card (name|level|map). */
  liveKey?: string;
}
const target = signal<Target | null>(null);

/* ---------- live encounter from the game's Explore page ---------- */

export function targetFromWild(ds: Dataset, snap: WildSnapshot, prev: Target | null): Target | null {
  const s = speciesByCardName(ds, snap.name);
  if (!s) return null;
  const key = `${snap.name}|${snap.level ?? ''}|${snap.map ?? ''}`;
  const same = prev?.liveKey === key;
  const m = same ? undefined : mapForCard(ds, snap.map, s.id);
  const hpPct = snap.hp !== undefined && snap.maxHp ? Math.max(1, Math.round((snap.hp / snap.maxHp) * 100)) : snap.hpPct !== undefined ? Math.max(1, Math.round(snap.hpPct)) : 100;
  const cardBalls: [string, number][] = [];
  for (const b of snap.balls) {
    const it = Object.values(ds.items).find((i) => lc(i.name) === lc(b.name));
    if (it) cardBalls.push([it.id, b.count]);
  }
  const base: Target = same && prev ? prev : {
    species: s.id, level: snap.level ?? m?.top ?? 20, mapId: m?.mapId ?? '', method: m?.method ?? 'walking',
    item: '', shiny: false, goodIvs: false, status: '', hpPct: 100, turn: 1, throws: 0,
  };
  return {
    ...base,
    species: s.id,
    level: snap.level ?? base.level,
    item: snap.item ?? base.item,
    shiny: snap.shiny || base.shiny,
    status: snap.status ?? (same ? base.status : ''),
    hpPct,
    inBox: snap.inBox,
    registered: snap.registered,
    catchlist: snap.catchlist,
    myLevel: snap.lead?.level,
    cardBalls,
    liveKey: key,
  };
}

let lastWildAt = 0;
effect(() => {
  const snap = wild.value;
  const ds = dataset.value;
  if (!snap || !ds?.wild || snap.at === lastWildAt) return;
  lastWildAt = snap.at;
  const prev = target.peek();
  const next = targetFromWild(ds, snap, prev);
  if (!next) return;
  if (prev?.liveKey !== next.liveKey) view.value = 'encounter';
  target.value = next;
});
const charm = signal(false);

const pct = (x: number) => (x >= 0.0995 ? `${Math.round(x * 100)}%` : x >= 0.001 ? `${(x * 100).toFixed(1)}%` : x > 0 ? '<0.1%' : '–');
const nightNow = () => {
  const h = new Date().getUTCHours();
  return h >= 18 || h < 6;
};

export function ExploreTab() {
  const ds = dataset.value;
  if (!ds) return <NoData />;
  if (!ds.wild) {
    return (
      <Empty title="No map data yet">
        <p class="small">Your saved wiki data is from an older MeowRPGAdvisor. Sync the data again in ⚙ Settings to load explore maps, catch rates and balls.</p>
      </Empty>
    );
  }
  return (
    <>
      <div class="seg" role="tablist">
        {(['maps', 'encounter', 'balls'] as View[]).map((v) => (
          <button class={view.value === v ? 'on' : ''} role="tab" aria-selected={view.value === v} onClick={() => (view.value = v)}>
            {v === 'maps' ? 'Maps' : v === 'encounter' ? 'Encounter' : 'Balls'}
          </button>
        ))}
      </div>
      {view.value === 'maps' && <Maps ds={ds} />}
      {view.value === 'encounter' && <Encounter ds={ds} />}
      {view.value === 'balls' && <Balls ds={ds} />}
    </>
  );
}

function useWanted(ds: Dataset) {
  const npc = selectedNpc.value;
  const v = npc?.variants[selectedVariant.value] ?? npc?.variants[0];
  return useMemo(() => {
    const list = v ? wantedSpecies(ds, v, box.value) : [];
    return { npc, list, ids: new Set(list.filter((w) => !w.owned).map((w) => w.species.id)) };
  }, [ds, v, box.value]);
}

function openEncounter(row: EncounterRow) {
  target.value = {
    species: row.enc.species, level: row.enc.levels[1], mapId: row.map.id, method: row.enc.method,
    item: '', shiny: false, goodIvs: false, status: '', hpPct: 100, turn: 1, throws: 0,
  };
  view.value = 'encounter';
}

/* ---------- Maps ---------- */

function Maps({ ds }: { ds: Dataset }) {
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [mapId, setMapId] = useState('');
  const [findable, setFindable] = useState(true);
  const [onlyMarked, setOnlyMarked] = useState(false);
  const [limit, setLimit] = useState(60);
  const wanted = useWanted(ds);
  const owned = useMemo(() => ownedSpecies(box.value), [box.value]);
  const hunted = huntBySpecies.value;
  const maps = ds.wild!.maps.filter((m) => m.encounters.length);

  const rows = useMemo(() => {
    let r = filterEncounters(ds, { query: q, type: type || undefined, mapId: mapId || undefined, findableOnly: findable && !q.trim() });
    if (onlyMarked) r = r.filter((x) => wanted.ids.has(x.enc.species) || !owned.has(x.enc.species) || hunted.has(x.enc.species));
    return r;
  }, [ds, q, type, mapId, findable, onlyMarked, wanted, owned, hunted]);

  return (
    <>
      <label class="search">
        <span aria-hidden="true">⌕</span>
        <input placeholder="Where do I find… (species name)" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
      </label>
      <div class="row wrap">
        <select class="input grow" value={mapId} onChange={(e) => setMapId((e.target as HTMLSelectElement).value)} aria-label="Map">
          <option value="">All maps</option>
          {maps.map((m) => <option value={m.id}>{m.name} (Lv {m.levels[0]}–{m.levels[1]})</option>)}
        </select>
        <select class="input" value={type} onChange={(e) => setType((e.target as HTMLSelectElement).value)} aria-label="Type">
          <option value="">Any type</option>
          {ALL_TYPES.map((t) => <option value={t}>{t}</option>)}
        </select>
      </div>
      {mapId && <MapTips ds={ds} mapId={mapId} />}
      <div class="row wrap small">
        <label><input type="checkbox" checked={findable} onChange={(e) => setFindable((e.target as HTMLInputElement).checked)} /> Common/rare only (when not searching)</label>
        <label><input type="checkbox" checked={onlyMarked} onChange={(e) => setOnlyMarked((e.target as HTMLInputElement).checked)} /> Only wanted / new / hunt list</label>
      </div>

      {wanted.npc ? (
        <div class="card">
          <p class="title">Wanted vs {wanted.npc.name}</p>
          <div class="small muted">Findable species whose types hit this team (type matchup of the catchable form). ★ = not in your box.</div>
          <div class="chips" style={{ marginTop: '6px' }}>
            {wanted.list.slice(0, 16).map((w) => (
              <button class={`chip${w.owned ? '' : ' on'}`} title={`Hits with ${w.attackTypes.join('/')}; resists ${w.resists}, weak to ${w.weakTo} NPC moves`} onClick={() => setQ(w.species.name)}>
                {w.owned ? '' : '★ '}{w.species.name}
              </button>
            ))}
            {!wanted.list.length && <span class="small muted">No findable counters on these maps.</span>}
          </div>
        </div>
      ) : (
        <div class="small muted">Pick an NPC in Prep to highlight species that counter it.</div>
      )}

      <div class="card">
        <p class="title">{rows.length} encounters<span class="r small muted">per encounter, best spot · day / night</span></p>
        {rows.slice(0, limit).map((r) => (
          <button class="mon" style={{ width: '100%', textAlign: 'left', background: 'none', border: 0, borderBottom: '1px solid var(--border)', gridTemplateColumns: '1fr auto' }} onClick={() => openEncounter(r)}>
            <span>
              <span class="nm">{wanted.ids.has(r.enc.species) ? '🎯 ' : ''}{r.species?.name ?? `#${r.enc.species}`}</span>
              {!owned.has(r.enc.species) && <span class="chip on" style={{ marginLeft: '6px' }}>new</span>}
              {hunted.has(r.enc.species) && <span class="chip on" style={{ marginLeft: '6px' }} title="On your hunt list (Prep → Hunt & grind)">hunt: {hunted.get(r.enc.species)}</span>}
              <Types types={r.species?.types ?? []} />
              <div class="small muted">
                {r.map.name} · {METHOD_LABEL[r.enc.method] ?? r.enc.method} · Lv {r.enc.levels[0]}–{r.enc.levels[1]} · {RARITY_LABEL[r.enc.rarity] ?? r.enc.rarity}
                {r.species?.spawnRequirement ? ` · ${r.species.spawnRequirement}` : ''}
              </div>
            </span>
            <span class="lv">{pct(r.enc.day)} / {pct(r.enc.night)}</span>
          </button>
        ))}
        {rows.length > limit && <button class="btn" style={{ width: '100%', marginTop: '6px' }} onClick={() => setLimit(limit + 60)}>Show more</button>}
        {!rows.length && <div class="small muted">Nothing matches. Untick "Common/rare only" to include extremely rare and legendary spawns.</div>}
      </div>
      <div class="foot">Rates are the wiki's chance per wild encounter in the best spot of the map (sub-areas differ).</div>
    </>
  );
}

/* ---------- Encounter ---------- */

function liveWild(ds: Dataset) {
  const snap = battle.value;
  if (!snap || snap.status !== 'active' || !snap.opponent) return null;
  if (matchNpc(ds, snap)) return null; // a known NPC battle, not a wild one
  if (snap.opponentTeam.length > 1) return null;
  const s = Object.values(ds.species).find((x) => lc(x.name) === lc(snap.opponent!.name));
  if (!s) return null;
  return { species: s.id, level: snap.opponent.level, item: snap.opponent.item, status: snap.opponent.status, hp: snap.opponent.hp, maxHp: snap.opponent.maxHp, turn: snap.turn, myLevel: snap.player?.level, myName: snap.player?.name };
}

function Encounter({ ds }: { ds: Dataset }) {
  const t = target.value;
  const live = liveWild(ds);
  const isLive = !!(wild.value && t?.liveKey);
  const [pickName, setPickName] = useState('');
  const speciesList = useMemo(() => Object.values(ds.species).filter((s) => whereToFind(ds, s.id).length).sort((a, b) => a.name.localeCompare(b.name)), [ds]);

  const pickSpecies = (name: string) => {
    const s = speciesList.find((x) => lc(x.name) === lc(name));
    if (!s) return;
    const where = whereToFind(ds, s.id)[0];
    target.value = {
      species: s.id, level: where?.enc.levels[1] ?? 20, mapId: where?.map.id ?? '', method: where?.enc.method ?? 'walking',
      item: '', shiny: false, goodIvs: false, status: '', hpPct: 100, turn: 1, throws: 0,
    };
  };
  const useLive = () => {
    if (!live) return;
    const where = whereToFind(ds, live.species)[0];
    target.value = {
      species: live.species, level: live.level ?? where?.enc.levels[1] ?? 20, mapId: where?.map.id ?? '', method: where?.enc.method ?? 'walking',
      item: live.item ?? '', shiny: false, goodIvs: false, status: live.status ?? '',
      hpPct: live.hp && live.maxHp ? Math.max(1, Math.round((live.hp / live.maxHp) * 100)) : 100, turn: live.turn ?? 1, throws: 0,
    };
  };

  return (
    <>
      {wild.value && !speciesByCardName(ds, wild.value.name) && <Tip kind="warn">The game shows a wild {wild.value.name}, but it is not in the synced wiki data. Sync the data again in ⚙ Settings.</Tip>}
      {(!isLive && !t) && (
        <>
          {live && (
            <Tip kind="info">
              The battle screen shows a possible wild <b>{ds.species[live.species]?.name}</b>{live.level ? ` Lv ${live.level}` : ''}.{' '}
              <button class="link" onClick={useLive}>Use it</button> (check it matches).
            </Tip>
          )}
          <div class="row">
            <input class="input grow" list="md-wild-species" placeholder="Wild Pokémon you met…" value={pickName}
              onInput={(e) => setPickName((e.target as HTMLInputElement).value)}
              onChange={(e) => pickSpecies((e.target as HTMLInputElement).value)} />
            <datalist id="md-wild-species">{speciesList.map((s) => <option value={s.name} />)}</datalist>
            <button class="btn" style={{ flex: '0 0 auto' }} onClick={() => pickSpecies(pickName)}>Set</button>
          </div>
          {import.meta.env.DEV && !wild.value && <button class="btn" style={{ width: '100%' }} onClick={loadSampleWild}>Load sample wild encounter (dev)</button>}
          {!t && <div class="small muted">Meet a wild Pokémon on the game's Explore page and it shows up here by itself, or pick it above (or tap a row in Maps). MeowRPGAdvisor never acts in the game.</div>}
        </>
      )}
      {t && <EncounterDetail ds={ds} t={t} myLevel={t.myLevel ?? live?.myLevel} isLive={isLive} />}
    </>
  );
}

const usable = (o: BallOption) => !o.unavailable && !o.saveIt && !o.effect.unknown;

/** The ball to throw, plus a runner-up worth knowing about (best overall, or a cheaper one that is close). */
function headlineBalls(adv: BallAdvice): { main: BallOption | null; alt: BallOption | null; altLabel: string } {
  const main = adv.bestOwned ?? adv.best;
  if (!main) return { main: null, alt: null, altLabel: '' };
  if (adv.bestOwned && adv.best && adv.best.id !== adv.bestOwned.id && adv.best.chance > adv.bestOwned.chance + 0.005) return { main, alt: adv.best, altLabel: 'Best overall' };
  const owned = adv.ranked.filter((o) => usable(o) && o.id !== main.id && (o.count === undefined || o.count > 0));
  const close = owned.find((o) => o.chance >= main.chance - 0.1);
  if (close) return { main, alt: close, altLabel: close.chance >= main.chance ? 'Also' : 'Close' };
  return { main, alt: owned[0] ?? null, altLabel: 'Next' };
}

const STATUS_SHORT: Record<string, string> = { slp: 'SLP', frz: 'FRZ', par: 'PAR', brn: 'BRN', psn: 'PSN', tox: 'TOX' };

/** One chance as a bar with its % beside it (never under it, so nothing gets clipped). */
function PctBar({ x, after }: { x: number | undefined; after?: boolean }) {
  if (x === undefined) return <span class="muted small">–</span>;
  return (
    <span class={`pbar${after ? ' after' : ''}`}>
      <span class="tr" aria-hidden="true"><i style={{ width: `${Math.max(2, Math.min(100, x * 100))}%` }} /></span>
      <b>{pct(x)}</b>
    </span>
  );
}

/** Balls to throw: chance per throw now, and after the catch plan (when the plan helps). */
function BallTable({ ds, rows, altLabel, after, afterLabel }: {
  ds: Dataset; rows: (BallOption | null | undefined)[]; altLabel: string; after: BallAdvice | null; afterLabel?: string;
}) {
  const list = rows.filter((r): r is BallOption => !!r);
  return (
    <div class="btable" style={after ? undefined : { gridTemplateColumns: 'minmax(0, 1.25fr) minmax(0, 1.2fr)' }} role="table" aria-label="Catch chance per throw">
      <span class="bh" role="columnheader">Ball</span>
      <span class="bh" role="columnheader">Now</span>
      {after && <span class="bh" role="columnheader" title={`After ${afterLabel}`}>After plan</span>}
      {list.map((o, i) => (
        <>
          <span class={`bn${i === 0 ? ' main' : ''}`} role="cell" title={i === 1 ? altLabel : undefined}>
            <BallIcon ds={ds} id={o.id} size={18} />
            <span>{o.name}</span>
            {o.count !== undefined && <small>×{o.count}</small>}
          </span>
          <span role="cell"><PctBar x={o.chance} /></span>
          {after && <span role="cell"><PctBar x={after.ranked.find((r) => r.id === o.id)?.chance} after /></span>}
        </>
      ))}
    </div>
  );
}

function EncounterDetail({ ds, t, myLevel, isLive }: { ds: Dataset; t: Target; myLevel?: number; isLive: boolean }) {
  const s = ds.species[t.species];
  const set = (patch: Partial<Target>) => (target.value = { ...t, ...patch });
  const [adjust, setAdjust] = useState(false);
  const [modePick, setModePick] = useState<{ key: string; mode: 'catch' | 'defeat' } | null>(null);
  const [moreWeaken, setMoreWeaken] = useState(false);
  const [moreStatus, setMoreStatus] = useState(false);
  const headTop = useHeadHeight();
  const wanted = useWanted(ds);
  const map = ds.wild!.maps.find((m) => m.id === t.mapId);
  const night = nightNow();
  const snap = isLive ? wild.value : null;
  const decision = useMemo(() => fightOrCatch(ds, { species: t.species, level: t.level, item: t.item || null, shiny: t.shiny, goodIvs: t.goodIvs, inBox: t.inBox, registered: t.registered, catchlist: t.catchlist }, box.value, wanted.ids, { npcName: wanted.npc?.name, hunt: huntBySpecies.value }), [ds, t, box.value, wanted, huntBySpecies.value]);
  const held = useMemo(() => wildHeldItems(ds, t.species, t.mapId || undefined), [ds, t.species, t.mapId]);
  // Weaken / Status from the team you carry (active first); the box only as a swap-in list.
  const tplan = useMemo(() => teamCatchPlan(ds, box.value, snap, { species: t.species, level: t.level }, { hpPct: t.hpPct }), [ds, box.value, snap, t.species, t.level, t.hpPct]);
  const plan = tplan.source === 'team' ? tplan.team : tplan.box;
  const dexCount = ownedSpecies(box.value).size;
  // Ball counts on the game's quick-catch row are fresher than the last Bag read.
  const owned = useMemo(() => {
    if (!bag.value && !t.cardBalls?.length) return null;
    const m = new Map(bag.value ? ownedItems.value : []);
    for (const [id, n] of t.cardBalls ?? []) m.set(id, n);
    return m as ReadonlyMap<string, number>;
  }, [bag.value, ownedItems.value, t.cardBalls]);
  const ctx = useMemo(() => ({
    speciesId: t.species, types: s?.types ?? [], catchRate: s?.catchRate ?? 45, level: t.level, baseSpeed: s?.baseStats.spe ?? 0,
    mapId: t.mapId, mapTheme: map?.theme, fishing: isFishing(t.method), night, turn: t.turn, throwsSoFar: t.throws, myLevel,
    registered: t.registered ?? ownedSpecies(box.value).has(t.species), moonStone: ds.wild!.moonStone.includes(t.species),
  }), [ds, t, s, map, night, myLevel, box.value]);
  const rankOpts = { dexCount, charm: charm.value, owned, precious: t.shiny || s?.rarity === 'legendary' };
  const advice = useMemo(() => rankBalls(ds, { ...ctx, status: t.status }, { ...rankOpts, hpFrac: t.hpPct / 100 }), [ds, ctx, t.status, t.hpPct, owned, charm.value]);
  const after = useMemo(() => afterPlan(plan, { hpPct: t.hpPct, status: t.status }), [plan, t.hpPct, t.status]);
  // The plan takes a couple of turns (and throws come after it): Quick Ball no longer applies.
  const afterAdvice = useMemo(() => rankBalls(ds, { ...ctx, status: after.status, turn: t.turn + 2 }, { ...rankOpts, hpFrac: after.hpFrac }), [ds, ctx, after, owned, charm.value]);
  if (!s) return null;
  const { main, alt, altLabel } = headlineBalls(advice);
  const afterMain = afterAdvice.bestOwned ?? afterAdvice.best;
  // Catch / Defeat: every new encounter opens on Defeat (the user's choice); the CATCH/FIGHT stamp still shows the
  // verdict, and a tab you pick sticks for that encounter.
  const encKey = t.liveKey ?? `${t.species}|${t.level}`;
  const mode = modePick?.key === encKey ? modePick.mode : 'defeat';
  const catching = mode === 'catch';
  const hpClass = t.hpPct > 50 ? 'g' : t.hpPct > 20 ? 'y' : 'r';
  const gender = snap?.gender === 'F' ? '♀' : snap?.gender === 'M' ? '♂' : '';
  const rarity = snap?.rarity ?? (s.rarity ? RARITY_LABEL[s.rarity] : undefined);
  const weaken = plan.weaken.slice(0, moreWeaken ? 8 : 3);
  const status = plan.status.slice(0, moreStatus ? 8 : 3);

  return (
    <>
      <section class="enc-head" style={{ top: `${headTop}px` }} aria-label="Wild encounter">
        <div class="row">
          <span class="grow enc-id">
            {t.shiny && <span title="Shiny">✨</span>}<b class="enc-name">{s.name}</b>
            {gender && <span class="muted"> {gender}</span>}
            <span class="lv"> Lv {t.level}</span>
            {rarity && <span class="chip enc-chip">{rarity}</span>}
          </span>
          <span class={`stamp ${decision.verdict}`} title={decision.reasons.join(' ')}>{decision.summary}</span>
        </div>
        <div class="row enc-hp">
          <Types types={s.types} />
          <div class="hpbar grow" role="meter" aria-label={`${s.name} HP`} aria-valuenow={t.hpPct} aria-valuemax={100}><i class={hpClass} style={{ width: `${t.hpPct}%` }} /></div>
          <span class="lv">{snap?.hp !== undefined && snap.maxHp ? `${snap.hp}/${snap.maxHp}` : `${t.hpPct}%`}</span>
          {t.status && <span class={`enc-status st-${t.status}`}>{STATUS_SHORT[t.status] ?? t.status}</span>}
        </div>
        {main ? (
          <BallTable ds={ds} rows={[main, alt, afterMain && afterMain.id !== main.id && afterMain.id !== alt?.id ? afterMain : null]} altLabel={altLabel}
            after={catching && after.label && afterMain && afterMain.chance > main.chance + 0.005 ? afterAdvice : null} afterLabel={after.label} />
        ) : <div class="small muted">No usable ball found.</div>}
        {main && <div class="small muted">{main.name}: {main.effect.why}</div>}
        <div class="row small enc-foot">
          <span class="grow muted enc-reason" title={decision.reasons.join(' ')}>{decision.reasons[0]}</span>
          <button class="link" onClick={() => setAdjust(!adjust)} aria-expanded={adjust}>{adjust ? 'Done' : 'Adjust'}</button>
        </div>
        {decision.verdict === 'fight' && decision.hints.length > 0 && (
          <div class="small c-y enc-hint">Worth a catch anyway? {decision.hints.join(' / ')}</div>
        )}
        <div class="seg enc-mode" role="tablist" aria-label="Catch or defeat">
          {(['catch', 'defeat'] as const).map((m) => (
            <button class={mode === m ? 'on' : ''} role="tab" aria-selected={mode === m} onClick={() => setModePick({ key: encKey, mode: m })}>
              {m === 'catch' ? 'Catch it' : 'Defeat it (EXP)'}
            </button>
          ))}
        </div>
      </section>

      {adjust && (
        <div class="card small">
          <div class="muted" style={{ marginBottom: '4px' }}>Manual encounter settings.</div>
          <div class="row wrap">
            <label>Lv <input class="input" type="number" min={1} max={100} style={{ width: '58px' }} value={t.level} onInput={(e) => set({ level: Math.max(1, Number((e.target as HTMLInputElement).value) || 1) })} /></label>
            <select class="input" value={t.mapId} onChange={(e) => set({ mapId: (e.target as HTMLSelectElement).value })} aria-label="Map">
              <option value="">Map?</option>
              {ds.wild!.maps.filter((m) => m.encounters.length).map((m) => <option value={m.id}>{m.name}</option>)}
            </select>
            <select class="input" value={t.method} onChange={(e) => set({ method: (e.target as HTMLSelectElement).value })} aria-label="Method">
              {Object.entries(METHOD_LABEL).map(([k, v]) => <option value={k}>{v}</option>)}
            </select>
          </div>
          <div class="row wrap" style={{ marginTop: '6px' }}>
            <label class="grow" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>HP <input class="grow" type="range" min={1} max={100} value={t.hpPct} onInput={(e) => set({ hpPct: Number((e.target as HTMLInputElement).value) })} /> {t.hpPct}%</label>
            <select class="input" value={t.status} onChange={(e) => set({ status: (e.target as HTMLSelectElement).value })} aria-label="Its status">
              <option value="">No status</option>
              <option value="slp">Asleep</option><option value="frz">Frozen</option><option value="par">Paralyzed</option>
              <option value="brn">Burned</option><option value="psn">Poisoned</option>
            </select>
          </div>
          <div class="row wrap" style={{ marginTop: '6px' }}>
            <label>Turn <input class="input" type="number" min={1} style={{ width: '50px' }} value={t.turn} onInput={(e) => set({ turn: Math.max(1, Number((e.target as HTMLInputElement).value) || 1) })} /></label>
            <label>Throws <input class="input" type="number" min={0} style={{ width: '50px' }} value={t.throws} onInput={(e) => set({ throws: Math.max(0, Number((e.target as HTMLInputElement).value) || 0) })} /></label>
            <input class="input grow" placeholder="Held item" value={t.item} onInput={(e) => set({ item: (e.target as HTMLInputElement).value })} />
          </div>
          <div class="row wrap" style={{ marginTop: '6px' }}>
            <label><input type="checkbox" checked={t.shiny} onChange={(e) => set({ shiny: (e.target as HTMLInputElement).checked })} /> Shiny</label>
            <label><input type="checkbox" checked={t.goodIvs} onChange={(e) => set({ goodIvs: (e.target as HTMLInputElement).checked })} /> Good IVs</label>
          </div>
        </div>
      )}

      {catching && (
        <div class="card">
          <p class="title">Plan{tplan.source === 'team' ? <span class="r small muted">your team</span> : null}</p>
          <div class="enc-step"><span class="enc-n">1</span><b>Weaken</b><span class="muted small"> without a KO</span></div>
          {weaken.map((w) => <WeakenLine w={w} member={tplan.memberOf[w.uid]} />)}
          {plan.weaken.length > 3 && <button class="link small enc-opt" onClick={() => setMoreWeaken(!moreWeaken)}>{moreWeaken ? 'less' : `more (${plan.weaken.length - 3})`}</button>}
          {tplan.weakenHint && <div class="small c-y enc-opt">{tplan.weakenHint}</div>}
          {tplan.source === 'box' && !plan.weaken.length && <div class="small muted enc-opt">No safe hit in your box{plan.notes.some((n) => /Ghost/.test(n)) ? ' (Ghost: False Swipe does nothing)' : ''}. Sync your box (⚙) so MeowRPGAdvisor knows your moves.</div>}

          <div class="enc-step"><span class="enc-n">2</span><b>Status</b><span class="muted small"> sleep ×2.5 › paralysis ×1.5 › burn/poison</span></div>
          {status.map((o) => <StatusLine o={o} member={tplan.memberOf[o.uid]} />)}
          {plan.status.length > 3 && <button class="link small enc-opt" onClick={() => setMoreStatus(!moreStatus)}>{moreStatus ? 'less' : `more (${plan.status.length - 3})`}</button>}
          {tplan.statusHint && <div class="small c-y enc-opt">{tplan.statusHint}</div>}
          {tplan.source === 'box' && !plan.status.length && <div class="small muted enc-opt">No status move that works on it in your box.</div>}
          {[...tplan.notes, ...plan.notes.filter((n) => !/Ghost/.test(n))].map((n) => <div class="small muted enc-opt">• {n}</div>)}
          {tplan.source === 'team' && <BoxPicks plan={tplan.box} />}
        </div>
      )}

      {!catching && <DefeatView ds={ds} t={t} snap={snap} />}

      {(held.length > 0 || ((s.rarity === 'legendary' || isUltraBeast(s.id)) && s.spawnRequirement)) && (
        <div class="small muted" style={{ padding: '0 4px' }}>
          {held.length > 0 && <>May hold: {held.map((h, i) => <>{i > 0 && ' · '}{h.name} {pct(h.chance)}</>)}{t.mapId ? '' : ' (depends on the map)'}</>}
          {(s.rarity === 'legendary' || isUltraBeast(s.id)) && s.spawnRequirement ? <div>{s.spawnRequirement}</div> : null}
        </div>
      )}

      <details class="card small enc-more">
        <summary><b>All balls</b> <span class="muted">({advice.ranked.filter((o) => !o.unavailable).length})</span></summary>
        {advice.ranked.filter((o) => !o.unavailable).map((o) => (
          <div class="row" style={{ padding: '3px 0' }}>
            <BallIcon ds={ds} id={o.id} size={16} />
            <span class="grow">{o.name}{o.count !== undefined ? <span class="muted"> ×{o.count}</span> : ''} <span class="muted">{o.effect.why}{o.saveIt ? ' · save it for legendaries' : ''}</span></span>
            <b>{o.effect.unknown ? '?' : pct(o.chance)}</b>
          </div>
        ))}
        {!owned && <div class="muted">Open the game's Bag page once so MeowRPGAdvisor can prefer balls you have.</div>}
      </details>

      <details class="card small enc-more">
        <summary><span aria-hidden="true">ⓘ</span> <b>How these odds work</b></summary>
        <p>Estimate: ball, status and level bonuses are the wiki's; the HP and shake math is the mainline games'. Weaken hits are sized against the weakest possible {s.name} (IV 0, worst nature and ability) at its current HP.</p>
        <p>Critical captures assume {dexCount} species registered (counted from your box). <label><input type="checkbox" checked={charm.value} onChange={(e) => (charm.value = (e.target as HTMLInputElement).checked)} /> I have the Catching Charm</label></p>
        <p>After a failed 2nd throw it can flee (5%, then 10%, 20%); sleep or freeze stops that. {night ? 'It is night (UTC): Dusk Ball ×3.' : 'Daytime (UTC).'}</p>
      </details>
    </>
  );
}

function WeakenLine({ w, member }: { w: WeakenOption; member?: RosterMon }) {
  return (
    <div class="small enc-opt">
      <b>{w.monName}</b>{w.level ? <span class="muted"> Lv {w.level}</span> : ''}
      {member?.active ? <span class="chip on enc-chip">active</span> : ''}
      {member?.hp !== undefined && member.maxHp ? <span class="muted"> {member.hp}/{member.maxHp} HP</span> : ''} · {w.moveName}{' '}
      {w.safe ? <span class="ok-t">never KOs</span> : <span>{Math.round(w.minPct)}–{Math.round(w.maxPct)}%{w.critSafe ? '' : <span class="c-y"> crit could KO</span>}</span>}
      {w.guessed && <span class="muted"> · guessed</span>}
    </div>
  );
}

function StatusLine({ o, member }: { o: StatusOption; member?: RosterMon }) {
  return (
    <div class="small enc-opt">
      <b>{o.monName}</b>{member?.active ? <span class="chip on enc-chip">active</span> : ''} · {o.moveName} <span class="muted">{STATUS_LABEL[o.status]} · {o.accuracy}%</span>
      {o.note ? <span class="muted"> · {o.note}</span> : ''}{o.mayFail ? <span class="c-y"> · {o.mayFail}</span> : ''}
      {o.guessed && <span class="muted"> · guessed</span>}
    </div>
  );
}

/** Box picks, collapsed: useful only before the next exploration, when you can change the team. */
function BoxPicks({ plan }: { plan: CatchPlan }) {
  if (!plan.weaken.length && !plan.status.length) return null;
  return (
    <details class="small enc-opt enc-box">
      <summary class="muted">From your box (swap in before exploring)</summary>
      {plan.weaken.slice(0, 3).map((w) => <WeakenLine w={w} />)}
      {plan.status.slice(0, 3).map((o) => <StatusLine o={o} />)}
    </details>
  );
}

/** No live card: the wild Pokémon from the manual fields, and your strongest box Pokémon as the team. */
function manualWild(ds: Dataset, t: Target, boxMons: BoxMon[]): WildSnapshot {
  const top = [...boxMons].filter((b) => b.level).sort((a, b) => (b.level ?? 0) - (a.level ?? 0)).slice(0, 6);
  return {
    v: 1, at: 0, view: 'manual', name: ds.species[t.species]?.name ?? '', level: t.level, shiny: t.shiny, balls: [],
    hpPct: t.hpPct, status: t.status || undefined,
    party: top.map((b, i) => ({ name: ds.species[b.species]?.name ?? '?', level: b.level, active: i === 0, fainted: false })),
  };
}

/** "Defeat it": the Battle tab's move ranking for each healthy team member vs this wild Pokémon. */
function DefeatView({ ds, t, snap }: { ds: Dataset; t: Target; snap: WildSnapshot | null }) {
  const w = useMemo(() => (snap ? { ...snap, hpPct: snap.hp !== undefined ? undefined : t.hpPct, status: snap.status ?? (t.status || undefined), level: snap.level ?? t.level } : manualWild(ds, t, box.value)), [ds, snap, t, box.value]);
  const plan = useMemo(() => defeatPlan(ds, box.value, w), [ds, box.value, w]);
  const [all, setAll] = useState(false);
  const shown = plan.options.slice(0, all ? 6 : 3);
  return (
    <div class="card">
      <p class="title">Defeat it<span class="r small muted">{snap ? 'your team' : 'your strongest box Pokémon'}</span></p>
      {shown.map((o, i) => (
        <div class="enc-member">
          <div class="row small">
            <b class="grow">{o.member.name}{o.member.level ? <span class="muted"> Lv {o.member.level}</span> : ''}{o.member.active ? <span class="chip on enc-chip">active</span> : ''}{o.guessed && o.moves.length ? <span class="muted small"> · moves guessed (not in your box)</span> : ''}</b>
            {o.member.hp !== undefined && o.member.maxHp ? <span class="lv">{o.member.hp}/{o.member.maxHp} HP</span> : null}
          </div>
          {o.moves.map((a, j) => (
            <Action top={i === 0 && j === 0} a={{
              ...a,
              label: a.eff && a.eff !== '×1' ? `${a.label} ${a.eff}` : a.label,
              // Way past its HP (a Lv 56 vs a Lv 6): the KO chip says it all.
              ...((a.minPct ?? 0) >= 100 ? { minPct: undefined, maxPct: undefined } : {}),
            }} />
          ))}
          {!o.moves.length && <div class="small muted">No known damaging moves{o.guessed ? ' (not found in your box: sync it in ⚙)' : ''}.</div>}
          {o.threat && (
            <div class={`small ${o.threat.ko ? 'c-y' : 'muted'}`}>
              Its best hit: {o.threat.name} {Math.round(o.threat.minPct)}–{Math.round(o.threat.maxPct)}%{o.threat.ko === 'sure' ? ' – KOs it' : o.threat.ko ? ' – can KO it' : ''}
              {o.threat.youFirst === null ? ' · speed tie' : o.threat.youFirst ? ' · you move first' : ' · it moves first'}
            </div>
          )}
        </div>
      ))}
      {plan.options.length > 3 && <button class="link small" onClick={() => setAll(!all)}>{all ? 'less' : `more (${plan.options.length - 3})`}</button>}
      {!plan.options.length && <div class="small muted">No healthy Pokémon to fight with.</div>}
      {plan.notes.map((n) => <div class="small muted">• {n}</div>)}
    </div>
  );
}

/** Height of the panel's sticky header, so the encounter header sticks right below it. */
function useHeadHeight(): number {
  const [h, setH] = useState(0);
  useEffect(() => {
    const head = document.querySelector('.hud') as HTMLElement | null;
    if (!head) return;
    const update = () => setH(head.offsetHeight);
    update();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    ro?.observe(head);
    return () => ro?.disconnect();
  }, []);
  return h;
}

/** Colours for the drawn ball when the game's icon can't be shown: [top, band]. */
const BALL_COLORS: Record<string, [string, string]> = {
  pokeball: ['#e3350d', '#1d2433'], premierball: ['#ffffff', '#e3350d'], greatball: ['#2a75bb', '#e3350d'], ultraball: ['#2b2b2b', '#ffcb05'],
  masterball: ['#7a3fb0', '#e8559c'], safariball: ['#4f7a3a', '#c9b56a'], fastball: ['#f2a900', '#e3350d'], levelball: ['#c0392b', '#f2c200'],
  lureball: ['#1f8fb4', '#e3350d'], heavyball: ['#6b7a8a', '#2b2b2b'], loveball: ['#f06aa6', '#ffffff'], friendball: ['#46a04a', '#e3350d'],
  moonball: ['#2f4a7a', '#f2c200'], sportball: ['#e88a2a', '#c0392b'], netball: ['#21a6a0', '#1d2433'], diveball: ['#2a8fd6', '#9fd8f5'],
  nestball: ['#9bbf3a', '#e8b84a'], repeatball: ['#e8752a', '#f2c200'], timerball: ['#e3350d', '#ffffff'], luxuryball: ['#1d2433', '#e3350d'],
  duskball: ['#2f6b3a', '#1d2433'], healball: ['#f19ac4', '#ffffff'], quickball: ['#2a75bb', '#f2c200'], dreamball: ['#e8a0c8', '#8a5ab0'],
  beastball: ['#3a56b0', '#a0c8f0'], cherishball: ['#c0392b', '#e3350d'],
};

/** The game's own ball icon (wiki item sprite), or a drawn ball in its colours. */
function BallIcon({ ds, id, size }: { ds: Dataset; id: string; size: number }) {
  const [broken, setBroken] = useState(false);
  const sprite = ds.items[id]?.sprite;
  if (sprite && !broken) {
    return <img class="bico" src={`https://pokemeowrpg.com${sprite}`} width={size} height={size} alt="" loading="lazy" onError={() => setBroken(true)} />;
  }
  const [top, band] = BALL_COLORS[id] ?? (/hisuian|feather|wing|jet|leaden|gigaton|origin/.test(id) ? ['#8a6a4a', '#c9b08a'] : ['#e3350d', '#1d2433']);
  return <span class="ball bico" aria-hidden="true" style={{ width: `${size - 4}px`, height: `${size - 4}px`, background: `linear-gradient(${top} 0 43%, ${band} 43% 57%, #fff 57%)` }} />;
}

/* ---------- Ball reference ---------- */

function Balls({ ds }: { ds: Dataset }) {
  const owned = bag.value ? ownedItems.value : null;
  const balls = ballItems(ds);
  return (
    <div class="card">
      <p class="title">Ball reference<span class="r small muted">{owned ? 'count = in your bag' : 'bag not read yet'}</span></p>
      {balls.map((b) => (
        <div style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
          <div class="row">
            <b class="grow">{b.name}</b>
            {owned && <span class="lv">×{owned.get(b.id) ?? 0}</span>}
            {NOT_AWARDED.has(b.id) && <span class="chip">not awarded</span>}
            {!BALL_RULES[b.id] && <span class="chip">no rule</span>}
          </div>
          <div class="small">{b.description ?? b.effect}</div>
          {b.notes?.map((n) => <div class="small muted">{n}</div>)}
          {b.wildRule && <div class="small muted">Wild holders: {b.wildRule.split('\n')[0]}</div>}
        </div>
      ))}
      <div class="small muted" style={{ marginTop: '6px' }}>Heavy Ball needs the Pokémon's weight, which the wiki data does not include, so MeowRPGAdvisor never picks it.</div>
    </div>
  );
}

