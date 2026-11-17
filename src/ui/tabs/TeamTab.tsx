import { useMemo, useState } from 'preact/hooks';
import type { BoxMon, Dataset, Species } from '../../shared/types';
import { activeTab, box, dataset, selectedNpc, selectedVariant, setBox } from '../store';
import { Empty, MoveChip, Tip, Types, scoreClass } from '../components/common';
import { suggestTeam, type Candidate } from '../../engine/teamSuggest';
import { formatMult } from '../../engine/typeChart';
import { NoData } from './shared';
import { BoxSyncCard } from '../components/BoxSync';

export function TeamTab() {
  const ds = dataset.value;
  if (!ds) return <NoData />;
  return (
    <>
      <Suggestion ds={ds} />
      <BoxSyncCard compact />
      <BoxEditor ds={ds} />
    </>
  );
}

/* ---------------- suggestion ---------------- */

function Suggestion({ ds }: { ds: Dataset }) {
  const npc = selectedNpc.value;
  const v = npc ? npc.variants[Math.min(selectedVariant.value, npc.variants.length - 1)] : null;
  const res = useMemo(() => (v ? suggestTeam(ds, box.value, v, { levelCap: v.levelCap }) : null), [ds, v, box.value, npc]);
  const name = (c: Candidate) => ds.species[c.mon.species]?.name ?? '?';

  return (
    <>
      <div class="card row">
        <div class="grow">
          <div class="title" style={{ margin: 0 }}>Opponent</div>
          <b>{npc ? `${v!.trainerName ?? npc.name}${npc.variants.length > 1 ? ` · ${v!.label}` : ''}` : 'No NPC selected'}</b>
          {v && <div class="small muted">{v.format === 'doubles' ? 'Doubles' : 'Singles'} · {v.levelCap ? `Cap Lv ${v.levelCap}` : 'No level cap'}</div>}
        </div>
        <button class="btn sm" onClick={() => (activeTab.value = 'npc')}>{npc ? 'Change' : 'Pick NPC'}</button>
      </div>

      {!npc || !v ? (
        <Tip>Pick an NPC in the NPC tab, then tap “Suggest team”.</Tip>
      ) : !box.value.length ? (
        <Tip>Add the Pokémon you own to “Your box” below to get suggestions.</Tip>
      ) : res && (
        <>
          <div class="card">
            <p class="title">Suggested team <span class="r">Coverage {res.coverage}/100</span></p>
            {res.team.map((c) => {
              const s = ds.species[c.mon.species];
              const bi = c.pairs.reduce((a, p, i) => (p.bestHit.mult > c.pairs[a].bestHit.mult ? i : a), 0);
              const best = c.pairs[bi];
              return (
                <div class="mon">
                  <div class="av">{s?.name.slice(0, 2).toUpperCase()}</div>
                  <span class="nm">{s?.name}<Types types={s?.types ?? []} /></span>
                  <span class={`score ${scoreClass(c.avg)}`}>{c.avg}</span>
                  <div class="full small muted">
                    {c.mon.level ? `Lv ${c.mon.level} · ` : ''}
                    Best hit: {best?.bestHit.option?.moveName ?? `${best?.bestHit.option?.type ?? ''} move`} {formatMult(best?.bestHit.mult ?? 1)} on {v.team[bi]?.name}
                  </div>
                </div>
              );
            })}
            {!res.team.length && <div class="small muted">No eligible Pokémon (check the level cap).</div>}
          </div>

          {res.team.length > 0 && (
            <div class="card">
              <p class="title">Matchup matrix</p>
              {/* Rows = NPC Pokémon (can be 20 in towers), columns = your team (max 6). */}
              <div class="grid" style={{ gridTemplateColumns: `minmax(64px, 1.4fr) repeat(${res.team.length}, minmax(34px, 1fr))` }}>
                <span class="small muted" style={{ textAlign: 'left' }}>NPC ↓ · You →</span>
                {res.team.map((c) => <b title={name(c)}>{name(c).slice(0, 5)}</b>)}
                {v.team.map((m, j) => (
                  <>
                    <b class="rn" title={m.name}>{m.name}</b>
                    {res.team.map((c) => {
                      const p = c.pairs[j];
                      return (
                        <span class={`cell c-${p.score >= 70 ? 'g' : p.score >= 45 ? 'y' : 'r'}`} title={`${name(c)} vs ${m.name}: deals ${formatMult(p.bestHit.mult)} · takes up to ${formatMult(p.worstTaken.mult)}${p.worstTaken.moveName ? ` (${p.worstTaken.moveName})` : ''}`}>
                          {p.score}
                        </span>
                      );
                    })}
                  </>
                ))}
              </div>
              <div class="small muted" style={{ marginTop: '6px' }}>Hover a cell to see damage dealt/taken.</div>
            </div>
          )}

          {res.lead && (
            <Tip kind="info">
              Lead with <b>{name(res.lead)}</b>: scores {res.lead.pairs[0]?.score} vs the NPC's first Pokémon ({v.team[0]?.name}).
            </Tip>
          )}
          {res.ranked.filter((c) => c.eligible && !res.team.includes(c)).length > 0 && (
            <div class="small muted">
              Bench (adds no type coverage): {res.ranked.filter((c) => c.eligible && !res.team.includes(c)).map(name).join(', ')}
            </div>
          )}
          {v.format === 'doubles' && res.team.length < 2 && (
            <Tip kind="warn">Doubles battles need at least 2 eligible Pokémon.</Tip>
          )}
          {res.ranked.some((c) => !c.eligible) && (
            <Tip kind="warn">Excluded: {res.ranked.filter((c) => !c.eligible).map((c) => `${name(c)} (${c.reason})`).join(', ')}</Tip>
          )}
          <div class="foot">Based on types, your Pokémon's moves and known abilities. No stats, speed or damage yet.</div>
        </>
      )}
    </>
  );
}

/* ---------------- box editor ---------------- */

function BoxEditor({ ds }: { ds: Dataset }) {
  const [name, setName] = useState('');
  const [level, setLevel] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState('');
  const [limit, setLimit] = useState(12);
  const speciesList = useMemo(() => Object.values(ds.species).sort((a, b) => a.name.localeCompare(b.name)), [ds]);
  const byName = useMemo(() => new Map(speciesList.map((s) => [s.name.toLowerCase(), s])), [speciesList]);

  function add(e: Event) {
    e.preventDefault();
    const s = byName.get(name.trim().toLowerCase());
    if (!s) {
      setErr('Pokémon not found – pick one from the list.');
      return;
    }
    const lv = level ? Math.max(1, Math.min(120, parseInt(level, 10) || 0)) : undefined;
    setBox([...box.value, { uid: crypto.randomUUID(), species: s.id, level: lv, moves: [], source: 'manual' }]);
    setName('');
    setLevel('');
    setErr('');
  }

  const needle = filter.trim().toLowerCase();
  const shown = needle
    ? box.value.filter((b) => {
        const s = ds.species[b.species];
        return [s?.name, ...(s?.types ?? []), ...b.moves.map((id) => ds.moves[id]?.name)].join(' ').toLowerCase().includes(needle);
      })
    : box.value;

  const update = (uid: string, patch: Partial<BoxMon>) => setBox(box.value.map((b) => (b.uid === uid ? { ...b, ...patch } : b)));
  const remove = (uid: string) => setBox(box.value.filter((b) => b.uid !== uid));

  return (
    <div class="card">
      <p class="title">Your box <span class="r">{box.value.length} Pokémon</span></p>
      <form class="row" onSubmit={add}>
        <input class="input grow" list="md-species" value={name} onInput={(e) => setName(e.currentTarget.value)} placeholder="Pokémon name" aria-label="Pokémon name" />
        <input class="input" style={{ width: '62px' }} inputMode="numeric" value={level} onInput={(e) => setLevel(e.currentTarget.value)} placeholder="Lv" aria-label="Level" />
        <button class="btn sm primary" type="submit">Add</button>
      </form>
      <datalist id="md-species">{speciesList.map((s) => <option value={s.name} />)}</datalist>
      {err && <div class="small" style={{ color: 'var(--red)', marginTop: '4px' }}>{err}</div>}

      {!box.value.length && <Empty title="Your box is empty">Sync your box from the game above, or add Pokémon by hand (level and moves are optional).</Empty>}
      {box.value.length > 12 && (
        <input class="input" style={{ width: '100%', marginTop: '8px' }} value={filter} onInput={(e) => { setFilter(e.currentTarget.value); setLimit(12); }} placeholder={`Filter ${box.value.length} Pokémon…`} aria-label="Filter your box" />
      )}
      {shown.slice(0, limit).map((b) => {
        const s = ds.species[b.species];
        const fromGame = b.source === 'game';
        const itemName = b.item ? ds.items[b.item]?.name ?? b.item : null;
        return (
          <div class="mon">
            <div class="av">{s?.name.slice(0, 2).toUpperCase()}</div>
            <span class="nm">{s?.name ?? '?'}<Types types={s?.types ?? []} /></span>
            <span class="row">
              <span class="lv">{b.level ? `Lv ${b.level}` : 'Lv ?'}</span>
              {fromGame ? (
                <span class="chip" title="Synced from the game – changes on the next sync">game</span>
              ) : (
                <>
                  <button class="btn sm" onClick={() => setEditing(editing === b.uid ? null : b.uid)} aria-expanded={editing === b.uid} aria-label={`Edit ${s?.name}`}>✎</button>
                  <button class="btn sm" onClick={() => remove(b.uid)} aria-label={`Remove ${s?.name}`}>✕</button>
                </>
              )}
            </span>
            <div class="full">
              {b.moves.length ? b.moves.map((id) => <MoveChip ds={ds} id={id} />) : <span class="small muted">No moves entered – using STAB types.</span>}
            </div>
            {fromGame && (b.ability || itemName || b.nature) && (
              <div class="full small muted">{[b.ability, itemName && `@ ${itemName}`, b.nature].filter(Boolean).join(' · ')}</div>
            )}
            {editing === b.uid && s && <MoveEditor ds={ds} s={s} mon={b} onChange={(p) => update(b.uid, p)} />}
          </div>
        );
      })}
      {shown.length > limit && <button class="btn" style={{ width: '100%', marginTop: '8px' }} onClick={() => setLimit(limit + 24)}>Show more ({shown.length - limit})</button>}
      {needle && !shown.length && <div class="small muted" style={{ marginTop: '6px' }}>No Pokémon match “{filter}”.</div>}
    </div>
  );
}

function MoveEditor({ ds, s, mon, onChange }: { ds: Dataset; s: Species; mon: BoxMon; onChange: (p: Partial<BoxMon>) => void }) {
  const learnable = useMemo(() => {
    const ids = new Set([...s.levelMoves.map(([id]) => id), ...s.machineMoves, ...s.eggMoves]);
    return [...ids].map((id) => ds.moves[id]).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
  }, [ds, s]);
  const byName = new Map(learnable.map((m) => [m.name.toLowerCase(), m.id]));
  const listId = `md-moves-${mon.uid}`;
  const slots = [0, 1, 2, 3];

  return (
    <div class="full" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginTop: '6px' }}>
      <datalist id={listId}>{learnable.map((m) => <option value={m.name}>{m.type} · {m.category}</option>)}</datalist>
      {slots.map((i) => (
        <input
          class="input"
          list={listId}
          aria-label={`Move ${i + 1}`}
          placeholder={`Move ${i + 1}`}
          value={ds.moves[mon.moves[i]]?.name ?? ''}
          onChange={(e) => {
            const id = byName.get(e.currentTarget.value.trim().toLowerCase());
            const next = [...mon.moves];
            if (id) next[i] = id;
            else next.splice(i, 1);
            onChange({ moves: next.filter(Boolean).slice(0, 4) });
          }}
        />
      ))}
      <label class="small muted" style={{ gridColumn: '1 / 3' }}>
        Level:{' '}
        <input class="input" style={{ width: '70px' }} inputMode="numeric" value={mon.level ?? ''} onChange={(e) => {
          const n = parseInt(e.currentTarget.value, 10);
          onChange({ level: Number.isFinite(n) ? Math.max(1, Math.min(120, n)) : undefined });
        }} />
        {' '}· Only moves this Pokémon can learn are suggested (level, TM, egg).
      </label>
    </div>
  );
}
