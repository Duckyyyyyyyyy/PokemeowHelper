import { useMemo, useState } from 'preact/hooks';
import type { Dataset, Npc, NpcMon } from '../../shared/types';
import { box, dataset, goPrep, selectedNpc, selectedNpcId, selectedVariant } from '../store';
import { Avatar, Empty, MoveChip, Tip, TypeBadge, Types } from '../components/common';
import { bestAttackTypes, bestDefensiveTypes, monTypes, teamNotes } from '../../engine/analysis';
import { RULES_TEXT, dsFor, rulesFor } from '../../engine/rules';
import { FacilityRules, LevelModeSeg } from '../components/FacilityRules';
import { frontierVariant, levelMode } from '../frontierPrefs';
import { NoData } from './shared';
import { ASSUMED_NPC_LEVEL, npcToCalc } from '../../engine/damage';
import { observedByOthersForNpc, observedForNpc, seenFor } from '../../engine/observed';
import { lc } from '../../engine/turnAdvisor';
import { observed } from '../battleStore';
import { allTips, tipsForNpc } from '../../engine/tips';
import { openTip } from '../tipsStore';
import { activeBossMoves, bossLobby, bossPicks } from '../bossStore';
import { bossVariant, isWorldBoss } from '../../engine/worldBoss';
import { BossCounter, BossMovePicker } from '../components/WorldBoss';

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

/** "Boulder Badge · gives HM01 Cut, Exp. Charm" – badge and HM/Key Item rewards (schema 5+ data). */
function gives(ds: Dataset, n: Npc): string {
  const special = (n.rewardItems ?? []).filter((id) => /^hm/.test(id) || ds.items[id]?.category === 'key-items').map((id) => ds.items[id]?.name ?? id);
  return [n.badge && `${n.badge} Badge`, special.length && `gives ${special.join(', ')}`].filter(Boolean).join(' · ');
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
                {gives(ds, n) && <small class="gives">{gives(ds, n)}</small>}
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

function MonRow({ ds, m, seen, others, hideMoves }: { ds: Dataset; m: NpcMon; seen?: string[]; others?: Record<string, number>; hideMoves?: boolean }) {
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
      {!hideMoves && <div class="full">{m.moves.map((id) => <MoveChip ds={ds} id={id} />)}</div>}
      {seen && seen.length > 0 && (
        <div class="full small muted" title="Moves this Pokémon actually used in your battles">
          Seen in battle: {seen.map((id, i) => <>{i > 0 && ', '}{m.moves.includes(id) ? (ds.moves[id]?.name ?? id) : <b class="bad-t">{ds.moves[id]?.name ?? id} (not in wiki)</b>}{others?.[id] ? ` (seen by others ${others[id]})` : ''}</>)}
        </div>
      )}
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

function NpcDetail({ ds: base, npc }: { ds: Dataset; npc: Npc }) {
  const vi = Math.min(selectedVariant.value, npc.variants.length - 1);
  // Battle Frontier: Gen III types/stats and the Brain's real level (Level 50 / Open Level).
  const ds = dsFor(base, rulesFor(npc.category));
  const frontier = npc.category === 'frontier' ? frontierVariant(base, box.value, npc, npc.variants[vi], levelMode.value) : null;
  const vFull = frontier?.v ?? npc.variants[vi];
  // World Boss: only the moves this spawn carries (World Boss page or your pick) drive everything below.
  const boss = isWorldBoss(npc);
  const bossSel = boss ? activeBossMoves(base, npc, bossLobby.value, bossPicks.value) : null;
  const v = boss ? bossVariant(vFull, bossSel?.ids) : vFull;
  const attack = bestAttackTypes(ds, v);
  const defense = bestDefensiveTypes(ds, v).slice(0, 5);
  const notes = teamNotes(ds, v);
  const goodHits = attack.filter((a) => a.score > 0).slice(0, 6);
  const avoid = attack.filter((a) => a.score < 0).slice(-4).reverse();
  const seen = observedForNpc(observed.value, npc, v);
  const seenOthers = observedByOthersForNpc(observed.value, npc, v);

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

      {frontier && <LevelModeSeg level={frontier.level} estimated={frontier.estimated} />}

      <div class="card">
        <p class="title">
          {v.trainerName ? `${v.trainerName}'s team` : 'Team'}
          <span class="r">{v.team.length} Pokémon · {v.format === 'doubles' ? 'Doubles' : 'Singles'}{v.levelCap ? ` · Cap Lv ${v.levelCap}` : npc.variants.length > 1 && v.label === 'Rematch' ? ' · No cap' : ''}</span>
        </p>
        {(boss ? vFull : v).team.map((m) => <MonRow ds={ds} m={m} hideMoves={boss} seen={seenFor(seen.get(lc(m.name)) ?? [], m, v.team, true)} others={seenOthers.get(lc(m.name))} />)}
      </div>

      {boss && vFull.team[0] && <BossMovePicker ds={ds} npc={npc} pool={vFull.team[0].moves} active={bossSel} />}

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
        <div class="small muted">{boss ? (bossSel ? `Based on the ${bossSel.ids.length} moves picked for this spawn (as Max Moves, same types).` : 'Based on its whole move pool: pick this spawn’s moves above.') : "Based on the NPC's damaging moves (counted per Pokémon using them)."}</div>
      </div>

      {boss && <BossCounter ds={ds} npc={npc} v={v} />}

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

      <NpcUnlocks ds={ds} npc={npc} />
      {rulesFor(npc.category).npcIgnoresWonderGuard && <Tip kind="info"><b>Special rules:</b> {RULES_TEXT}</Tip>}
      <FacilityRules npc={npc} />
      <div class="btns">
        <button class="btn primary" onClick={() => goPrep('team')}>Suggest team →</button>
      </div>
      <div class="foot">Types use the {frontier ? 'Gen III' : "game's"} type chart and known abilities. Damage numbers are in step 2, Team.</div>
    </>
  );
}

/** Rewards and what beating this trainer unlocks, linked to the Tips tab. */
function NpcUnlocks({ ds, npc }: { ds: Dataset; npc: Npc }) {
  const unlocks = useMemo(() => tipsForNpc(allTips(ds), npc.id), [ds, npc.id]);
  const rewards = (npc.rewardItems ?? []).map((id) => ds.items[id]?.name ?? id);
  if (!npc.badge && !rewards.length && !unlocks.length) return null;
  return (
    <div class="card">
      <p class="title">Rewards &amp; unlocks</p>
      {(npc.badge || rewards.length > 0) && (
        <div class="small">{[npc.badge && `${npc.badge} Badge`, ...rewards].filter(Boolean).join(' · ')}</div>
      )}
      {unlocks.slice(0, 10).map((t) => (
        <div class="small"><button class="link" onClick={() => openTip(t.id)}>{t.title} →</button></div>
      ))}
    </div>
  );
}
