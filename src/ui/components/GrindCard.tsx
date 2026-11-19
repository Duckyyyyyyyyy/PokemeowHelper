import { useEffect, useMemo, useState } from 'preact/hooks';
import type { Dataset, NpcTeamVariant } from '../../shared/types';
import type { BattleRules } from '../../engine/rules';
import type { Suggestion } from '../../engine/teamSuggest';
import { targetLevel, versatility, worthGrinding, type GrindTeamPick, type Versatility } from '../../engine/potential';
import { ownedTms } from '../bagStore';
import { TypeBadge, Types, scoreClass } from './common';

/** Versatility is ~0.5 ms per NPC Pokémon: cache it per dataset + Pokémon + bag. */
const versCache = new Map<string, Versatility>();

/**
 * "Worth grinding": a full team of low-level Pokémon from your box to train for this fight (scored
 * as if trained to its level), plus more candidates. Shown under the ready-now team; never changes it.
 */
export function GrindCard({ ds, v, ready, rules, locked, excluded, size }: {
  ds: Dataset;
  v: NpcTeamVariant;
  ready: Suggestion;
  rules: BattleRules;
  locked: readonly string[];
  excluded: readonly string[];
  /** Team size (Battle Frontier: 3). */
  size?: number;
}) {
  const tms = ownedTms.value;
  const grind = useMemo(
    () => worthGrinding(ds, v, ready, { levelCap: v.levelCap, rules, locked, excluded, ownedTms: tms, size }),
    [ds, v, ready, tms, excluded, size],
  );
  // Team first, so its versatility is rated first.
  const list = useMemo(() => [...grind.team, ...grind.more], [grind]);
  const [vers, setVers] = useState<Record<string, Versatility>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [showMore, setShowMore] = useState(false);

  // Versatility across every NPC: one Pokémon per tick so the panel stays responsive.
  useEffect(() => {
    let cancelled = false;
    const tmKey = tms ? [...tms].sort().join(',') : '-';
    const byUid = new Map(list.map((r) => [r.mon.uid, r.mon]));
    // Level and moves in the key: a re-synced Pokémon gets a fresh rating.
    const keyOf = (uid: string) => { const m = byUid.get(uid)!; return `${ds.version}:${uid}:${m.level}:${m.moves.join(',')}:${tmKey}`; };
    const todo = list.filter((r) => !versCache.has(keyOf(r.mon.uid)));
    const publish = () => setVers(Object.fromEntries(list.filter((r) => versCache.has(keyOf(r.mon.uid))).map((r) => [r.mon.uid, versCache.get(keyOf(r.mon.uid))!])));
    publish();
    const step = () => {
      if (cancelled || !todo.length) return;
      const r = todo.shift()!;
      versCache.set(keyOf(r.mon.uid), versatility(ds, r.mon, ds.npcs, { ownedTms: tms }));
      publish();
      setTimeout(step, 0);
    };
    const t = setTimeout(step, 50);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [ds, list, tms]);

  const lv = targetLevel(v);
  // Average over NPC Pokémon of the best grind-team answer, like the ready-now coverage.
  const coverage = grind.team.length && v.team.length
    ? Math.round(v.team.reduce((sum, _n, j) => sum + Math.max(...grind.team.map((r) => r.pairs[j]?.score ?? 0)), 0) / v.team.length)
    : 0;

  const row = (r: GrindTeamPick) => {
    const s = ds.species[r.mon.species];
    const vs = vers[r.mon.uid];
    const isOpen = open === r.mon.uid;
    return (
      <div class="mon">
        <div class="av">{s?.name.slice(0, 2).toUpperCase()}</div>
        <span class="nm">{s?.name}<Types types={s?.types ?? []} /></span>
        <span class="row" title={`Now ${r.current} → ${r.potential} at Lv ${r.targetLevel}`}>
          {r.filler && <span class="chip" title="Doesn't clearly beat the ready-now team: only here so the grind team has 6">filler</span>}
          <span class={`score ${scoreClass(r.current)}`}>{r.current}</span>
          <span class="muted">→</span>
          <span class={`score ${scoreClass(r.potential)}`}>{r.potential}</span>
        </span>
        <div class="full small muted">
          Lv {r.mon.level} → {r.targetLevel} (+{r.levelsNeeded}) · {r.ivs.text}
        </div>
        <div class={`full small${r.filler ? ' muted' : ''}`}>{r.why}</div>
        <div class="full small muted" title="Share of NPC Pokémon it beats 1v1 when trained to each NPC's level, over the whole NPC list">
          Versatility: {vs ? <><b>{vs.score}</b>/100 · good pick vs {vs.good}/{vs.total} NPCs</> : 'rating…'}
        </div>
        <div class="full">
          <button class="link small" onClick={() => setOpen(isOpen ? null : r.mon.uid)} aria-expanded={isOpen}>
            {isOpen ? 'Hide moveset' : 'Moveset by then →'}
          </button>
        </div>
        {isOpen && (
          <div class="full">
            {r.moves.length ? r.moves.map((m) => (
              <div class="row small" style={{ padding: '2px 0' }}>
                <TypeBadge type={m.type} />
                <b>{m.name}</b>
                <span class={`chip${m.source === 'known' ? '' : ' on'}`} style={{ padding: '0 7px' }}>
                  {m.source === 'level' ? `learns Lv ${m.level}` : m.source === 'tm' ? 'TM (in bag)' : m.source === 'known' ? 'Known' : 'Egg'}
                </span>
                <span class="muted grow" style={{ textAlign: 'right' }}>{m.bestAgainst.length ? `best vs ${m.bestAgainst.slice(0, 2).join(', ')}${m.bestAgainst.length > 2 ? '…' : ''}` : ''}</span>
              </div>
            )) : <span class="small muted">No damaging moves by then.</span>}
          </div>
        )}
      </div>
    );
  };

  return (
    <div class="card">
      <p class="title">Worth grinding · team of {grind.team.length} <span class="r">at Lv {lv}{grind.team.length ? ` · coverage ${coverage}/100` : ''}</span></p>
      {!grind.team.length && <div class="small muted">None of your Pokémon are below Lv {lv}, so there's nothing to train for this fight.</div>}
      {grind.team.map(row)}
      {grind.note && <div class="small muted" style={{ marginTop: '4px' }}>{grind.note}</div>}
      {grind.more.length > 0 && (
        <>
          <button class="link small" style={{ marginTop: '6px' }} onClick={() => setShowMore(!showMore)} aria-expanded={showMore}>
            {showMore ? 'Hide more candidates' : `More candidates (${grind.more.length}) →`}
          </button>
          {showMore && grind.more.map(row)}
        </>
      )}
      <div class="small muted" style={{ marginTop: '4px' }}>
        Picked like the team above: best potential first, then whoever covers NPC Pokémon the others don't. Score now → at Lv {lv}, with its real IVs and nature and the moves it learns on the way
        {tms ? ' plus TMs in your bag' : ' (open your Bag page once to include your TMs)'}. Current EVs only and no evolution, so it may do even better.
      </div>
    </div>
  );
}
