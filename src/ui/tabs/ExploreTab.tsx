import { signal } from '@preact/signals';
import { useMemo, useState } from 'preact/hooks';
import type { Dataset } from '../../shared/types';
import { Empty, Tip, Types } from '../components/common';
import { NoData } from './shared';
import { box, dataset, selectedNpc, selectedVariant } from '../store';
import { battle } from '../battleStore';
import { ownedItems, bag } from '../bagStore';
import {
  fightOrCatch, filterEncounters, isFishing, METHOD_LABEL, ownedSpecies, RARITY_LABEL, wantedSpecies, whereToFind, wildHeldItems,
  type EncounterRow,
} from '../../engine/explore';
import { ballItems, BALL_RULES, catchChance, isUltraBeast, NOT_AWARDED, rankBalls, type BallOption } from '../../engine/catching';
import { planCatch, STATUS_LABEL } from '../../engine/catchPlan';
import { matchNpc, lc } from '../../engine/turnAdvisor';
import { ALL_TYPES } from '../../engine/typeChart';

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
}
const target = signal<Target | null>(null);
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
        <p class="small">Your saved wiki data is from an older MeowHelper. Sync the data again in ⚙ Settings to load explore maps, catch rates and balls.</p>
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
  const maps = ds.wild!.maps.filter((m) => m.encounters.length);

  const rows = useMemo(() => {
    let r = filterEncounters(ds, { query: q, type: type || undefined, mapId: mapId || undefined, findableOnly: findable && !q.trim() });
    if (onlyMarked) r = r.filter((x) => wanted.ids.has(x.enc.species) || !owned.has(x.enc.species));
    return r;
  }, [ds, q, type, mapId, findable, onlyMarked, wanted, owned]);

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
      <div class="row wrap small">
        <label><input type="checkbox" checked={findable} onChange={(e) => setFindable((e.target as HTMLInputElement).checked)} /> Common/rare only (when not searching)</label>
        <label><input type="checkbox" checked={onlyMarked} onChange={(e) => setOnlyMarked((e.target as HTMLInputElement).checked)} /> Only wanted / new</label>
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
        <div class="small muted">Pick an NPC in the NPC tab to highlight species that counter it.</div>
      )}

      <div class="card">
        <p class="title">{rows.length} encounters<span class="r small muted">per encounter, best spot · day / night</span></p>
        {rows.slice(0, limit).map((r) => (
          <button class="mon" style={{ width: '100%', textAlign: 'left', background: 'none', border: 0, borderBottom: '1px solid var(--border)', gridTemplateColumns: '1fr auto' }} onClick={() => openEncounter(r)}>
            <span>
              <span class="nm">{wanted.ids.has(r.enc.species) ? '🎯 ' : ''}{r.species?.name ?? `#${r.enc.species}`}</span>
              {!owned.has(r.enc.species) && <span class="chip on" style={{ marginLeft: '6px' }}>new</span>}
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
      {live && (
        <Tip kind="info">
          The battle screen shows a possible wild <b>{ds.species[live.species]?.name}</b>{live.level ? ` Lv ${live.level}` : ''}.{' '}
          <button class="link" onClick={useLive}>Use it</button> (live wild detection is untested – check it matches).
        </Tip>
      )}
      <div class="row">
        <input class="input grow" list="md-wild-species" placeholder="Wild Pokémon you met…" value={pickName}
          onInput={(e) => setPickName((e.target as HTMLInputElement).value)}
          onChange={(e) => pickSpecies((e.target as HTMLInputElement).value)} />
        <datalist id="md-wild-species">{speciesList.map((s) => <option value={s.name} />)}</datalist>
        <button class="btn" style={{ flex: '0 0 auto' }} onClick={() => pickSpecies(pickName)}>Set</button>
      </div>
      {t ? <EncounterDetail ds={ds} t={t} myLevel={live?.myLevel} /> : <div class="small muted">Pick the species you met (or tap a row in Maps). MeowHelper never acts in the game: you throw and attack yourself.</div>}
    </>
  );
}

function EncounterDetail({ ds, t, myLevel }: { ds: Dataset; t: Target; myLevel?: number }) {
  const s = ds.species[t.species];
  const set = (patch: Partial<Target>) => (target.value = { ...t, ...patch });
  const wanted = useWanted(ds);
  const map = ds.wild!.maps.find((m) => m.id === t.mapId);
  const night = nightNow();
  const decision = useMemo(() => fightOrCatch(ds, { species: t.species, level: t.level, item: t.item || null, shiny: t.shiny, goodIvs: t.goodIvs }, box.value, wanted.ids), [ds, t, box.value, wanted]);
  const held = useMemo(() => wildHeldItems(ds, t.species, t.mapId || undefined), [ds, t.species, t.mapId]);
  const plan = useMemo(() => planCatch(ds, box.value, { species: t.species, level: t.level }, { hpPct: t.hpPct }), [ds, box.value, t.species, t.level, t.hpPct]);
  const dexCount = ownedSpecies(box.value).size;
  const owned = bag.value ? ownedItems.value : null;
  const advice = useMemo(() => rankBalls(ds, {
    speciesId: t.species, types: s?.types ?? [], catchRate: s?.catchRate ?? 45, level: t.level, baseSpeed: s?.baseStats.spe ?? 0,
    mapId: t.mapId, mapTheme: map?.theme, fishing: isFishing(t.method), night, turn: t.turn, throwsSoFar: t.throws, myLevel,
    registered: ownedSpecies(box.value).has(t.species), status: t.status, moonStone: ds.wild!.moonStone.includes(t.species),
  }, { hpFrac: t.hpPct / 100, dexCount, charm: charm.value, owned, precious: t.shiny || s?.rarity === 'legendary' }), [ds, t, map, night, myLevel, box.value, owned, charm.value]);
  if (!s) return null;
  const base = catchChance({ catchRate: s.catchRate ?? 45, hpFrac: t.hpPct / 100, level: t.level, status: t.status, ballMul: 1, dexCount, charm: charm.value });
  const lowSleep = catchChance({ catchRate: s.catchRate ?? 45, hpFrac: 0.05, level: t.level, status: 'slp', ballMul: 1, dexCount, charm: charm.value });

  return (
    <>
      <div class="card">
        <p class="title" style={{ margin: 0 }}>
          {s.name} <Types types={s.types} />
          <span class="r">catch rate {s.catchRate ?? '?'}</span>
        </p>
        <div class="row wrap small" style={{ marginTop: '6px' }}>
          <label>Lv <input class="input" type="number" min={1} max={100} style={{ width: '58px' }} value={t.level} onInput={(e) => set({ level: Math.max(1, Number((e.target as HTMLInputElement).value) || 1) })} /></label>
          <select class="input" value={t.mapId} onChange={(e) => set({ mapId: (e.target as HTMLSelectElement).value })} aria-label="Map">
            <option value="">Map?</option>
            {ds.wild!.maps.filter((m) => m.encounters.length).map((m) => <option value={m.id}>{m.name}</option>)}
          </select>
          <select class="input" value={t.method} onChange={(e) => set({ method: (e.target as HTMLSelectElement).value })} aria-label="Method">
            {Object.entries(METHOD_LABEL).map(([k, v]) => <option value={k}>{v}</option>)}
          </select>
        </div>
        <div class="row wrap small" style={{ marginTop: '6px' }}>
          <input class="input grow" placeholder="Held item shown (optional)" value={t.item} onInput={(e) => set({ item: (e.target as HTMLInputElement).value })} />
          <label><input type="checkbox" checked={t.shiny} onChange={(e) => set({ shiny: (e.target as HTMLInputElement).checked })} /> Shiny</label>
          <label><input type="checkbox" checked={t.goodIvs} onChange={(e) => set({ goodIvs: (e.target as HTMLInputElement).checked })} /> Good IVs</label>
        </div>
      </div>

      <Tip kind={decision.verdict === 'catch' ? 'ok' : 'info'} icon={decision.verdict === 'catch' ? '◓' : '⚔'}>
        <b>{decision.summary}</b> – {decision.reasons.join(' ')}
      </Tip>

      {held.length > 0 && (
        <div class="small muted" style={{ padding: '0 4px' }}>
          May hold: {held.map((h, i) => <>{i > 0 && ' · '}{h.name} {pct(h.chance)}</>)}
          {t.mapId ? '' : ' (depends on the map)'}
        </div>
      )}
      {(s.rarity === 'legendary' || isUltraBeast(s.id)) && <div class="small muted" style={{ padding: '0 4px' }}>{s.spawnRequirement ?? ''}</div>}

      {decision.verdict === 'catch' && (
        <>
          <div class="card">
            <p class="title">1 · Weaken it (no KO)</p>
            {plan.weaken.slice(0, 5).map((w) => (
              <div class="small" style={{ padding: '3px 0' }}>
                <b>{w.monName}</b>{w.level ? ` Lv ${w.level}` : ''}: {w.moveName}{' '}
                {w.safe ? <span class="ok-t">never KOs</span> : <>{Math.round(w.minPct)}–{Math.round(w.maxPct)}%{w.critSafe ? '' : <span class="c-y"> (a crit could KO)</span>}</>}
                {w.guessed && <span class="muted"> · move guessed from level-up list</span>}
              </div>
            ))}
            {!plan.weaken.length && <div class="small muted">No safe hit found in your box. Sync your box (⚙) so MeowHelper knows your Pokémon's moves.</div>}
            <div class="small muted" style={{ marginTop: '4px' }}>Sized against the weakest possible {s.name} at Lv {t.level} (IV 0, worst nature and ability) at {t.hpPct}% HP. Set its HP in the Ball box below after each hit.</div>
          </div>
          <div class="card">
            <p class="title">2 · Status it</p>
            {plan.status.slice(0, 5).map((o) => (
              <div class="small" style={{ padding: '3px 0' }}>
                <b>{STATUS_LABEL[o.status]}</b> ×{o.bonus}: {o.monName} – {o.moveName} ({o.accuracy}%)
                {o.note ? ` · ${o.note}` : ''}{o.mayFail ? <span class="c-y"> · {o.mayFail}</span> : ''}
                {o.guessed && <span class="muted"> · guessed</span>}
              </div>
            ))}
            {!plan.status.length && <div class="small muted">No sleep / paralysis / burn / poison move that works on it in your box.</div>}
            {plan.notes.map((n) => <div class="small muted">• {n}</div>)}
          </div>
        </>
      )}

      <div class="card">
        <p class="title">{decision.verdict === 'catch' ? '3 · ' : ''}Ball</p>
        <div class="row wrap small">
          <label>HP <input type="range" min={1} max={100} value={t.hpPct} onInput={(e) => set({ hpPct: Number((e.target as HTMLInputElement).value) })} /> {t.hpPct}%</label>
          <select class="input" value={t.status} onChange={(e) => set({ status: (e.target as HTMLSelectElement).value })} aria-label="Its status">
            <option value="">No status</option>
            <option value="slp">Asleep</option><option value="frz">Frozen</option><option value="par">Paralyzed</option>
            <option value="brn">Burned</option><option value="psn">Poisoned</option>
          </select>
          <label>Turn <input class="input" type="number" min={1} style={{ width: '50px' }} value={t.turn} onInput={(e) => set({ turn: Math.max(1, Number((e.target as HTMLInputElement).value) || 1) })} /></label>
          <label>Throws <input class="input" type="number" min={0} style={{ width: '50px' }} value={t.throws} onInput={(e) => set({ throws: Math.max(0, Number((e.target as HTMLInputElement).value) || 0) })} /></label>
        </div>
        {advice.bestOwned && <BallLine o={advice.bestOwned} label="Best in your bag" />}
        {advice.best && (!advice.bestOwned || advice.best.id !== advice.bestOwned.id) && <BallLine o={advice.best} label={owned ? 'Best overall' : 'Best ball'} />}
        {!owned && <div class="small muted">Open the game's Bag page once so MeowHelper can prefer balls you have.</div>}
        {owned && !advice.bestOwned && <div class="small muted">Your last bag read has no usable balls.</div>}
        <details class="small" style={{ marginTop: '4px' }}>
          <summary>All balls for this encounter</summary>
          {advice.ranked.filter((o) => !o.unavailable).map((o) => (
            <div class="row" style={{ padding: '2px 0' }}>
              <span class="grow">{o.name}{o.count !== undefined ? <span class="muted"> ×{o.count}</span> : ''} <span class="muted">{o.effect.why}{o.saveIt ? ' · save it for legendaries' : ''}</span></span>
              <b>{o.effect.unknown ? '?' : pct(o.chance)}</b>
            </div>
          ))}
        </details>
        <div class="small muted" style={{ marginTop: '6px' }}>
          Poké Ball now {pct(base)} per throw; at ~5% HP and asleep {pct(lowSleep)}. {night ? 'It is night (UTC): Dusk Ball ×3.' : 'Daytime (UTC).'}
          {' '}Critical captures assume {dexCount} species registered (from your box).{' '}
          <label><input type="checkbox" checked={charm.value} onChange={(e) => (charm.value = (e.target as HTMLInputElement).checked)} /> Catching Charm</label>
        </div>
        <div class="small muted">Estimate: ball, status and level bonuses are the wiki's; the HP and shake math is the mainline games'. A failed 2nd throw can let it flee (5%, then 10%, 20%).</div>
      </div>
    </>
  );
}

function BallLine({ o, label }: { o: BallOption; label: string }) {
  return (
    <div class="row" style={{ padding: '4px 0' }}>
      <span class="grow"><b>{label}: {o.name}</b>{o.count !== undefined ? <span class="muted"> ×{o.count}</span> : ''} <span class="small muted">{o.effect.why}</span></span>
      <b>{pct(o.chance)}</b>
    </div>
  );
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
      <div class="small muted" style={{ marginTop: '6px' }}>Heavy Ball needs the Pokémon's weight, which the wiki data does not include, so MeowHelper never picks it.</div>
    </div>
  );
}

