import { signal } from '@preact/signals';
import { useMemo, useState } from 'preact/hooks';
import type { Dataset, GameTip, TipCategory } from '../../shared/types';
import { Tip } from '../components/common';
import { METHOD_LABEL, whereToFind } from '../../engine/explore';
import { box, dataset, goPrep, loading, selectedNpcId, selectedVariant } from '../store';
import { doneTips, focusTipId, openTip, searchTipsFor, tipsQuery, toggleDone } from '../tipsStore';
import {
  allTips, CATEGORIES, CATEGORY_LABEL, mapNeeds, progressPath, searchTips, sourceLabel, sourceUrl, tipsForMap,
} from '../../engine/tips';

const view = signal<'all' | 'path'>('all');
const category = signal<TipCategory | ''>('');
const hideDone = signal(false);

export function TipsTab() {
  const ds = dataset.value;
  const tips = useMemo(() => allTips(ds), [ds]);
  if (loading.value) return null;

  const focus = focusTipId.value ? tips.find((t) => t.id === focusTipId.value) : undefined;
  if (focus) {
    return (
      <>
        <div class="row">
          <button class="btn sm" onClick={() => (focusTipId.value = null)}>← All tips</button>
        </div>
        <TipCard ds={ds} tip={focus} open />
      </>
    );
  }

  return (
    <>
      <label class="search">
        <span aria-hidden="true">⌕</span>
        <input
          value={tipsQuery.value}
          onInput={(e) => (tipsQuery.value = e.currentTarget.value)}
          placeholder="Where is… / How do I get… (Pokémon, NPC, item, map)"
          aria-label="Search tips"
        />
        {tipsQuery.value && <button class="link" onClick={() => (tipsQuery.value = '')} aria-label="Clear search">✕</button>}
      </label>
      {ds && <QuickHits ds={ds} q={tipsQuery.value} />}
      <div class="seg" role="tablist">
        <button class={view.value === 'all' ? 'on' : ''} role="tab" aria-selected={view.value === 'all'} onClick={() => (view.value = 'all')}>All tips</button>
        <button class={view.value === 'path' ? 'on' : ''} role="tab" aria-selected={view.value === 'path'} onClick={() => (view.value = 'path')}>Progress path</button>
      </div>
      {!ds?.tips && (
        <Tip kind="info">
          {ds ? 'Sync the wiki data again (⚙) to add tips built from the game data: HM givers, Key Items, Legendary unlocks, League order and more.' : 'Showing the hand-written tips only. Sync the wiki data (⚙) for many more.'}
        </Tip>
      )}
      {view.value === 'all' ? <AllTips ds={ds} tips={tips} /> : <PathView ds={ds} tips={tips} />}
      <div class="foot">Tips summarise the game wiki; each links its source. "Unconfirmed" marks our own inference.</div>
    </>
  );
}

/** One search box for the whole Guide: NPCs and Pokémon (where to find them) above the matching tips. */
function QuickHits({ ds, q }: { ds: Dataset; q: string }) {
  const needle = q.trim().toLowerCase();
  const hits = useMemo(() => {
    if (needle.length < 2) return null;
    const npcs = ds.npcs.filter((n) => n.name.toLowerCase().includes(needle)).slice(0, 3);
    const species = Object.values(ds.species).filter((s) => s.name.toLowerCase().includes(needle)).slice(0, 3)
      .map((s) => ({ s, where: ds.wild ? whereToFind(ds, s.id)[0] : undefined }));
    return { npcs, species };
  }, [ds, needle]);
  if (!hits || (!hits.npcs.length && !hits.species.length)) return null;
  return (
    <div class="card">
      {hits.npcs.map((n) => (
        <button class="res" onClick={() => { selectedNpcId.value = n.id; selectedVariant.value = 0; goPrep('npc'); }}>
          <span class="grow"><span class="k">NPC · open in Prep</span><b>{n.name}</b> <span class="muted small">{n.title}</span></span>
        </button>
      ))}
      {hits.species.map(({ s, where }) => (
        <div class="res">
          <span class="grow">
            <span class="k">Pokémon · where to find</span>
            <b>{s.name}</b>{' '}
            <span class="muted small">{where ? `${where.map.name} · ${METHOD_LABEL[where.enc.method] ?? where.enc.method} · Lv ${where.enc.levels[0]}–${where.enc.levels[1]}` : ds.wild ? 'not found in the wild' : 'sync the wiki data for maps'}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

function AllTips({ ds, tips }: { ds: Dataset | null; tips: GameTip[] }) {
  const [limit, setLimit] = useState(30);
  const q = tipsQuery.value;
  const results = useMemo(() => searchTips(tips, ds, q, category.value), [tips, ds, q, category.value]);
  return (
    <>
      <div class="chips" role="group" aria-label="Filter by category">
        <button class={`chip${category.value === '' ? ' on' : ''}`} aria-pressed={category.value === ''} onClick={() => (category.value = '')}>All</button>
        {CATEGORIES.map((c) => (
          <button class={`chip${category.value === c ? ' on' : ''}`} aria-pressed={category.value === c} onClick={() => { category.value = c; setLimit(30); }}>
            {CATEGORY_LABEL[c]}
          </button>
        ))}
      </div>
      <div class="small muted">{results.length} tips</div>
      <div class="list">
        {results.slice(0, limit).map((t) => <TipCard key={t.id} ds={ds} tip={t} open={results.length === 1} />)}
        {results.length > limit && <button class="btn" onClick={() => setLimit(limit + 30)}>Show more ({results.length - limit})</button>}
        {!results.length && <div class="small muted">No tip matches. Try a single word such as an item, map or move name.</div>}
      </div>
    </>
  );
}

function PathView({ ds, tips }: { ds: Dataset | null; tips: GameTip[] }) {
  const q = tipsQuery.value;
  const filtered = useMemo(() => (q.trim() ? searchTips(tips, ds, q) : tips), [tips, ds, q]);
  const stages = useMemo(() => progressPath(filtered, ds), [filtered, ds]);
  const done = new Set(doneTips.value);
  const total = stages.reduce((n, s) => n + s.tips.length, 0);
  const doneCount = stages.reduce((n, s) => n + s.tips.filter((t) => done.has(t.id)).length, 0);
  return (
    <>
      <div class="row small">
        <span class="muted grow">{doneCount} / {total} done · a suggested order, not a game rule</span>
        <label><input type="checkbox" checked={hideDone.value} onChange={(e) => (hideDone.value = e.currentTarget.checked)} /> Hide done</label>
      </div>
      {stages.map((s) => {
        const list = hideDone.value ? s.tips.filter((t) => !done.has(t.id)) : s.tips;
        const n = s.tips.filter((t) => done.has(t.id)).length;
        return (
          <div class="card">
            <p class="title">{s.label}<span class="r small muted">{n}/{s.tips.length}</span></p>
            {list.map((t) => <PathRow ds={ds} tip={t} done={done.has(t.id)} />)}
            {!list.length && <div class="small muted">All done here.</div>}
          </div>
        );
      })}
      {!stages.length && <div class="small muted">Nothing on the path matches this search.</div>}
    </>
  );
}

function PathRow({ ds, tip, done }: { ds: Dataset | null; tip: GameTip; done: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div class="tiprow">
      <div class="row">
        <input type="checkbox" checked={done} onChange={() => toggleDone(tip.id)} aria-label={`Mark "${tip.title}" done`} />
        <button class={`link grow tl${done ? ' done' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open}>{tip.title}</button>
        <span class="chip sm">{CATEGORY_LABEL[tip.category]}</span>
      </div>
      {open && <TipBody ds={ds} tip={tip} />}
    </div>
  );
}

export function TipCard({ ds, tip, open: initial = false }: { ds: Dataset | null; tip: GameTip; open?: boolean }) {
  const [open, setOpen] = useState(initial);
  const done = doneTips.value.includes(tip.id);
  return (
    <div class="card tipcard">
      <div class="row">
        <button class={`link grow tl${done ? ' done' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open}>{tip.title}</button>
        <span class="chip sm">{CATEGORY_LABEL[tip.category]}</span>
      </div>
      {!open && tip.requires && <div class="small muted">Needs: {tip.requires.join(' · ')}</div>}
      {open && <TipBody ds={ds} tip={tip} />}
    </div>
  );
}

function TipBody({ ds, tip }: { ds: Dataset | null; tip: GameTip }) {
  const done = doneTips.value.includes(tip.id);
  const learners = useMemo(() => boxLearners(ds, tip), [ds, tip, box.value]);
  const mapName = (id: string) => ds?.wild?.maps.find((m) => m.id === id)?.name ?? id;
  return (
    <div class="tipbody">
      {tip.unconfirmed && <span class="chip sm warn">Unconfirmed</span>}
      {tip.requires && <div class="small"><b>Needs:</b> {tip.requires.join(' · ')}</div>}
      <ol class="steps">{tip.steps.map((s) => <li>{s}</li>)}</ol>
      {learners.length > 0 && <div class="small"><b>In your box, can learn {learners[0].move}:</b> {learners.map((l) => l.name).join(', ')}</div>}
      {(tip.maps?.length || tip.npcs?.length || tip.items?.length) ? (
        <div class="chips">
          {tip.maps?.slice(0, 8).map((id) => <button class="chip sm" title="Search tips for this map" onClick={() => searchTipsFor(mapName(id))}>🗺 {mapName(id)}</button>)}
          {tip.npcs?.slice(0, 6).map((id) => {
            const n = ds?.npcs.find((x) => x.id === id);
            return n ? <button class="chip sm" title="Open in Prep" onClick={() => { selectedNpcId.value = id; selectedVariant.value = 0; goPrep('npc'); }}>⚔ {n.name}</button> : null;
          })}
          {tip.items && tip.items.length <= 6 && tip.items.map((id) => {
            const name = ds?.items[id]?.name;
            return name ? <button class="chip sm" title="Search tips for this item" onClick={() => searchTipsFor(name)}>🎒 {name}</button> : null;
          })}
        </div>
      ) : null}
      <div class="row small wrap">
        <label><input type="checkbox" checked={done} onChange={() => toggleDone(tip.id)} /> Done</label>
        <span class="muted grow" style={{ textAlign: 'right' }}>
          Source: {tip.source.map((s, i) => {
            const url = sourceUrl(s);
            return <>{i > 0 && ' · '}{url ? <a href={url} target="_blank" rel="noreferrer">{sourceLabel(s)}</a> : sourceLabel(s)}</>;
          })}
        </span>
      </div>
    </div>
  );
}

function boxLearners(ds: Dataset | null, tip: GameTip): { name: string; move: string }[] {
  if (!ds || !tip.moves?.length) return [];
  const out: { name: string; move: string }[] = [];
  for (const moveId of tip.moves) {
    const move = ds.moves[moveId]?.name ?? moveId;
    const seen = new Set<number>();
    for (const m of box.value) {
      const s = ds.species[m.species];
      if (!s || seen.has(s.id)) continue;
      if (m.moves.includes(moveId) || s.machineMoves.includes(moveId) || s.levelMoves.some(([id]) => id === moveId)) {
        seen.add(s.id);
        out.push({ name: s.name, move });
      }
    }
  }
  return out.slice(0, 12);
}

/**
 * Explore cross-link: what a map needs (Surf, rods – from the encounter data) and the tips
 * about reaching it. Self-contained so the Explore tab only renders <MapTips/>.
 */
export function MapTips({ ds, mapId }: { ds: Dataset; mapId: string }) {
  const tips = useMemo(() => tipsForMap(allTips(ds), mapId), [ds, mapId]);
  const needs = useMemo(() => mapNeeds(ds, mapId), [ds, mapId]);
  if (!tips.length && !needs.length) return null;
  return (
    <div class="card">
      <p class="title">Getting there &amp; what you need</p>
      {needs.map((n) => (
        <div class="small">Needs {n.label} – <button class="link" onClick={() => (ds.tips?.some((t) => t.id === n.tipId) ? openTip(n.tipId) : searchTipsFor(n.query))}>how to get it</button></div>
      ))}
      {tips.slice(0, 6).map((t) => (
        <div class="small"><button class="link" onClick={() => openTip(t.id)}>{t.title} →</button></div>
      ))}
      {tips.length > 6 && <div class="small"><button class="link" onClick={() => searchTipsFor(ds.wild?.maps.find((m) => m.id === mapId)?.name ?? '')}>All {tips.length} tips for this map →</button></div>}
    </div>
  );
}
