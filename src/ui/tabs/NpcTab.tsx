import { useMemo, useState } from 'preact/hooks';
import type { Dataset, Npc, NpcMon } from '../../shared/types';
import { activeTab, dataset, selectedNpc, selectedNpcId, selectedVariant } from '../store';
import { Avatar, Empty, MoveChip, Tip, TypeBadge, Types } from '../components/common';
import { bestAttackTypes, bestDefensiveTypes, monTypes, teamNotes } from '../../engine/analysis';
import { NoData } from './shared';
import { ASSUMED_NPC_LEVEL, npcToCalc } from '../../engine/damage';

const FILTERS: { id: string; label: string; cats: string[] }[] = [
  { id: 'all', label: 'All', cats: [] },
  { id: 'gym', label: 'Gym', cats: ['gym'] },
  { id: 'league', label: 'Elite 4 · Champion', cats: ['elite-four', 'champion'] },
  { id: 'tower', label: 'Tower · Frontier', cats: ['tower', 'frontier'] },
  { id: 'mega', label: 'Mega', cats: ['mega'] },
  { id: 'rival', label: 'Rival · Rocket', cats: ['rival', 'rocket'] },
  { id: 'boss', label: 'World Boss', cats: ['boss'] },
];

function maxLevel(n: Npc) {
  return Math.max(0, ...n.variants[0].team.map((m) => m.level ?? 0));
}

function difficulty(n: Npc): [string, string] {
  const lv = n.levelCap ?? maxLevel(n);
  if (!lv) return ['mid', 'Lv ?'];
  if (lv <= 30) return ['easy', 'Easy'];
  if (lv <= 60) return ['mid', 'Medium'];
  return ['hard', 'Hard'];
}

function subtitle(n: Npc) {
  const v = n.variants[0];
  const lv = n.levelCap ? `Cap Lv ${n.levelCap}` : maxLevel(n) ? `Lv ${maxLevel(n)}` : '';
  return [n.group, n.location, v.format === 'doubles' ? 'Doubles' : 'Singles', lv].filter(Boolean).join(' · ');
}

export function NpcTab() {
  const ds = dataset.value;
  if (!ds) return <NoData />;
  return selectedNpc.value ? <NpcDetail ds={ds} npc={selectedNpc.value} /> : <NpcList ds={ds} />;
}

function NpcList({ ds }: { ds: Dataset }) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [limit, setLimit] = useState(60);

  const results = useMemo(() => {
    const cats = FILTERS.find((f) => f.id === filter)!.cats;
    const needle = q.trim().toLowerCase();
    return ds.npcs.filter((n) => {
      if (cats.length && !cats.includes(n.category)) return false;
      if (!needle) return true;
      const hay = [n.name, n.title, n.group, n.location, n.specialty, ...n.variants.flatMap((v) => v.team.map((m) => m.name))].join(' ').toLowerCase();
      return hay.includes(needle);
    });
  }, [ds, q, filter]);

  return (
    <>
      <label class="search">
        🔍
        <input value={q} onInput={(e) => { setQ(e.currentTarget.value); setLimit(60); }} placeholder="Search NPC, area or Pokémon…" aria-label="Search NPCs" />
      </label>
      <div class="chips" role="group" aria-label="Filter by category">
        {FILTERS.map((f) => (
          <button class={`chip${filter === f.id ? ' on' : ''}`} onClick={() => { setFilter(f.id); setLimit(60); }} aria-pressed={filter === f.id}>
            {f.label}
          </button>
        ))}
      </div>
      <div class="small muted">{results.length} results</div>
      <div class="list">
        {results.slice(0, limit).map((n) => {
          const [cls, label] = difficulty(n);
          return (
            <button class="npc" onClick={() => { selectedNpcId.value = n.id; selectedVariant.value = 0; }}>
              <Avatar name={n.name} src={n.trainerSprite} />
              <div class="grow">
                <b>{n.name} {n.specialty && !n.specialty.includes('/') ? <TypeBadge type={n.specialty} /> : null}</b>
                <small>{n.title} · {subtitle(n)}</small>
              </div>
              <span class={`diff ${cls}`}>{label}</span>
            </button>
          );
        })}
        {results.length > limit && <button class="btn" onClick={() => setLimit(limit + 60)}>Show more ({results.length - limit})</button>}
        {!results.length && <Empty title="No matching NPCs">Try another search or clear the filter.</Empty>}
      </div>
    </>
  );
}

function MonRow({ ds, m }: { ds: Dataset; m: NpcMon }) {
  const types = monTypes(ds, m);
  const item = m.item ? ds.items[m.item]?.name ?? m.item : null;
  const ability = m.ability ?? (m.possibleAbilities ? m.possibleAbilities.join(' / ') : null);
  const evs = m.evs ? Object.entries(m.evs).filter(([, v]) => v).map(([k, v]) => `${v} ${k.toUpperCase()}`).join(', ') : '';
  const stats = useMemo(() => {
    try {
      return npcToCalc(ds, m).stats;
    } catch {
      return null;
    }
  }, [ds, m]);
  return (
    <div class="mon">
      <div class="av">{m.name.slice(0, 2).toUpperCase()}</div>
      <span class="nm">{m.name}<Types types={types} /></span>
      <span class="lv" title={m.level ? undefined : `Level not listed – stats assume Lv ${ASSUMED_NPC_LEVEL}`}>{m.level ? `Lv ${m.level}` : `Lv ${ASSUMED_NPC_LEVEL}?`}</span>
      <div class="full">{m.moves.map((id) => <MoveChip ds={ds} id={id} />)}</div>
      <div class="full small muted">
        {[ability && `${ability}`, item && `@ ${item}`, m.nature, evs && `EV ${evs}`].filter(Boolean).join(' · ')}
      </div>
      {stats && (
        <div class="full small muted statline" title="HP / Atk / Def / SpA / SpD / Spe at this level">
          Stats {stats.hp} / {stats.atk} / {stats.def} / {stats.spa} / {stats.spd} / {stats.spe}
        </div>
      )}
    </div>
  );
}

function NpcDetail({ ds, npc }: { ds: Dataset; npc: Npc }) {
  const vi = Math.min(selectedVariant.value, npc.variants.length - 1);
  const v = npc.variants[vi];
  const attack = bestAttackTypes(ds, v);
  const defense = bestDefensiveTypes(ds, v).slice(0, 5);
  const notes = teamNotes(ds, v);
  const goodHits = attack.filter((a) => a.score > 0).slice(0, 6);
  const avoid = attack.filter((a) => a.score < 0).slice(-4).reverse();

  return (
    <>
      <button class="link" onClick={() => (selectedNpcId.value = null)}>← NPC list</button>
      <div class="card row">
        <Avatar name={npc.name} src={npc.trainerSprite} />
        <div class="grow">
          <b style={{ fontSize: '15px' }}>{npc.name}</b>
          <div class="small muted">{npc.title} · {subtitle(npc)}</div>
        </div>
        {npc.specialty && !npc.specialty.includes('/') && <TypeBadge type={npc.specialty} />}
      </div>

      {npc.variants.length > 1 && (
        <div class="seg" role="tablist">
          {npc.variants.map((x, i) => (
            <button class={i === vi ? 'on' : ''} role="tab" aria-selected={i === vi} onClick={() => (selectedVariant.value = i)}>{x.label}</button>
          ))}
        </div>
      )}

      <div class="card">
        <p class="title">
          {v.trainerName ? `${v.trainerName}'s team` : 'Team'}
          <span class="r">{v.team.length} Pokémon · {v.format === 'doubles' ? 'Doubles' : 'Singles'}{v.levelCap ? ` · Cap Lv ${v.levelCap}` : npc.variants.length > 1 && v.label === 'Rematch' ? ' · No cap' : ''}</span>
        </p>
        {v.team.map((m) => <MonRow ds={ds} m={m} />)}
      </div>

      <div class="card">
        <p class="title">Best attacking types</p>
        {goodHits.length ? goodHits.map((a) => (
          <span class="typescore"><TypeBadge type={a.type} /> super effective {a.superEffective}/{v.team.length}</span>
        )) : <span class="small muted">No standout type – this team has good coverage.</span>}
        {avoid.length > 0 && (
          <div class="small muted" style={{ marginTop: '2px' }}>
            Avoid: {avoid.map((a) => <><TypeBadge type={a.type} />{' '}</>)}
          </div>
        )}
      </div>

      <div class="card">
        <p class="title">Best defensive types</p>
        {defense.map((d) => (
          <span class="typescore"><TypeBadge type={d.type} /> resists {d.resisted}{d.weak ? ` · weak ${d.weak}` : ''}</span>
        ))}
        <div class="small muted">Based on the NPC's damaging moves (counted per Pokémon using them).</div>
      </div>

      {notes.length > 0 && (
        <Tip kind="warn">
          {notes.slice(0, 6).map((n) => <div>{n.text}</div>)}
        </Tip>
      )}
      {(v.requirements ?? npc.requirements).length > 0 && (
        <Tip kind="info">
          {(v.requirements ?? npc.requirements).map((r) => <div>{r}</div>)}
        </Tip>
      )}

      <div class="btns">
        <button class="btn primary" onClick={() => (activeTab.value = 'team')}>Suggest team →</button>
      </div>
      <div class="foot">Uses the game's type chart and known abilities. Stats/damage not included yet (Phase 2).</div>
    </>
  );
}
