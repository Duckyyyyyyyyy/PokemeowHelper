import { useMemo, useState } from 'preact/hooks';
import type { BoxMon, Dataset, StatTable } from '../../shared/types';
import { box, dataset } from '../store';
import { lockedUids } from '../teamPrefs';
import { evRoles, trainFocus } from '../evRoleStore';
import { ROLES, ROLE_LABEL, trainRow, type EvRole, type EvState, type EvStatus, type TrainRow } from '../../engine/evRoles';
import { EV_BERRY, EV_MAX_STAT, STATS, STAT_NAME, VITAMIN_EVS, type StatKey } from '../../engine/evPlan';
import { TypeAvatar } from '../components/hud';
import { Empty, Types } from '../components/common';
import { BoxSyncCard } from '../components/BoxSync';
import { BuildCard } from '../components/BuildCard';
import { FarmView } from '../components/FarmView';
import { NoData } from './shared';

/**
 * Train: which EVs each Pokémon should grind, by role, for the team or the whole box.
 * Roles are a base-stat heuristic (evRoles.ts); scoring against an NPC stays in Prep → Team → EVs.
 */

type View = 'team' | 'box' | 'farm';
/** 'own' = each Pokémon's saved role, else its auto role. */
type Pick = EvRole | 'own';

const SHORT: Record<StatKey, string> = { hp: 'HP', atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe' };
const STATE: Record<EvState, { label: string; pill: string; order: number }> = {
  reset: { label: 'Reset first', pill: 'weak', order: 0 },
  grind: { label: 'Grind', pill: 'ok', order: 1 },
  unknown: { label: 'EVs unknown', pill: 'none', order: 2 },
  later: { label: 'Later', pill: 'none', order: 3 },
  done: { label: 'Done', pill: 'good', order: 4 },
};

/** Pokémon locked in Prep → Team, else the 6 highest-level ones (the same rule as Explore). */
function teamOf(all: BoxMon[], locked: string[]): { mons: BoxMon[]; fromLocks: boolean } {
  const picked = all.filter((b) => locked.includes(b.uid));
  if (picked.length) return { mons: picked, fromLocks: true };
  return { mons: all.filter((b) => b.level).sort((a, b) => (b.level ?? 0) - (a.level ?? 0)).slice(0, 6), fromLocks: false };
}

export function TrainTab() {
  const ds = dataset.value;
  if (!ds) return <NoData />;
  return <Board ds={ds} />;
}

function Board({ ds }: { ds: Dataset }) {
  const [view, setView] = useState<View>('team');
  const [pick, setPick] = useState<Pick>('own');
  const [hideDone, setHideDone] = useState(false);
  const [lv30, setLv30] = useState(false);
  const [filter, setFilter] = useState('');
  const [limit, setLimit] = useState(20);
  const open = trainFocus.value;
  const setOpen = (uid: string | null) => (trainFocus.value = uid);

  const all = box.value;
  const team = useMemo(() => teamOf(all, lockedUids.value), [all, lockedUids.value]);
  const rows = useMemo(() => {
    const list = view === 'team' ? team.mons : all; // Farm plans the whole box
    return list
      .map((m) => trainRow(ds, m, pick, evRoles.value))
      .sort((a, b) => STATE[a.status.state].order - STATE[b.status.state].order || a.status.need - b.status.need || (b.mon.level ?? 0) - (a.mon.level ?? 0));
  }, [ds, all, team, view, pick, evRoles.value]);

  const openMon = open ? all.find((b) => b.uid === open) : undefined;
  if (openMon) return <BuildCard ds={ds} mon={openMon} onBack={() => setOpen(null)} />;

  const needle = filter.trim().toLowerCase();
  const shown = rows.filter((r) => (!hideDone || r.status.state !== 'done') && (!lv30 || (r.mon.level ?? 0) >= 30) && (!needle || (ds.species[r.mon.species]?.name ?? '').toLowerCase().includes(needle)));
  const counts = rows.reduce((c, r) => ({ ...c, [r.status.state]: (c[r.status.state] ?? 0) + 1 }), {} as Partial<Record<EvState, number>>);

  return (
    <>
      <div class="seg" role="group" aria-label="Train view">
        <button class={view === 'team' ? 'on' : ''} aria-pressed={view === 'team'} onClick={() => { setView('team'); setLimit(20); }}>Team</button>
        <button class={view === 'box' ? 'on' : ''} aria-pressed={view === 'box'} onClick={() => { setView('box'); setLimit(20); }}>Box ({all.length})</button>
        <button class={view === 'farm' ? 'on' : ''} aria-pressed={view === 'farm'} onClick={() => setView('farm')}>Farm</button>
      </div>
      {!all.length ? (
        <>
          <BoxSyncCard compact />
          <Empty title="Your box is empty">Sync your box from the game to see which EVs each Pokémon should grind.</Empty>
        </>
      ) : (
        <>
          <div class="card">
            <p class="title">EV role <span class="r">{(['reset', 'grind', 'done'] as const).filter((k) => counts[k]).map((k) => `${counts[k]} ${STATE[k].label.toLowerCase()}`).join(' · ')}</span></p>
            <div class="chips" role="group" aria-label="EV role">
              <button class={`chip${pick === 'own' ? ' on' : ''}`} aria-pressed={pick === 'own'} onClick={() => setPick('own')} title="Each Pokémon's own role: the one you picked, else the auto one">Own role</button>
              {ROLES.map((r) => (
                <button class={`chip${pick === r ? ' on' : ''}`} aria-pressed={pick === r} onClick={() => setPick(r)} title={`Show every Pokémon as a ${ROLE_LABEL[r]}`}>{ROLE_LABEL[r]}</button>
              ))}
            </div>
            <div class="row" style={{ marginTop: '6px' }}>
              <label class="small row"><input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.currentTarget.checked)} /> Hide done</label>
              <label class="small row"><input type="checkbox" checked={lv30} onChange={(e) => setLv30(e.currentTarget.checked)} /> Lv 30+</label>
              {view === 'box' && all.length > 12 && (
                <input class="input grow" value={filter} onInput={(e) => { setFilter(e.currentTarget.value); setLimit(20); }} placeholder="Filter by name…" aria-label="Filter your box" />
              )}
            </div>
            <div class="small muted" style={{ marginTop: '4px' }}>
              {view === 'farm'
                ? 'Farm: the whole box, grouped by the stat each Pokémon still needs (role chips apply).'
                : view === 'team'
                ? team.fromLocks ? 'Team: the Pokémon you locked in Prep → Team.' : 'Team: your 6 highest-level Pokémon. Lock Pokémon in Prep → Team to choose them.'
                : 'Sorted: fix first, then least left to grind.'}
              {' '}Auto roles come from base stats (a guess). Tap a name to compare roles.
            </div>
          </div>
          {view === 'farm' ? <FarmView ds={ds} rows={shown} /> : <div class="card">
            {shown.slice(0, limit).map((r) => <Row ds={ds} r={r} onOpen={() => { setOpen(r.mon.uid); window.scrollTo(0, 0); }} />)}
            {!shown.length && <div class="small muted">{needle ? `No Pokémon match “${filter}”.` : 'Nothing left to grind here.'}</div>}
            {shown.length > limit && <button class="btn" style={{ width: '100%', marginTop: '8px' }} onClick={() => setLimit(limit + 40)}>Show more ({shown.length - limit})</button>}
          </div>}
        </>
      )}
    </>
  );
}

function Row({ ds, r, onOpen }: { ds: Dataset; r: TrainRow; onOpen: () => void }) {
  const s = ds.species[r.mon.species];
  const st = STATE[r.status.state];
  return (
    <div class="mon">
      <TypeAvatar name={s?.name ?? '?'} types={s?.types ?? []} size={34} />
      <span class="nm">
        <button class="link nmlink" onClick={onOpen} aria-label={`Compare EV roles for ${s?.name}`}>{s?.name ?? '?'}</button>
        <Types types={s?.types ?? []} />
      </span>
      <span class={`pill ${st.pill}`}>{st.label}</span>
      <div class="full small muted">
        {r.mon.level ? `Lv ${r.mon.level}` : 'Lv ?'}{r.mon.nature ? ` · ${r.mon.nature}` : ''} · {ROLE_LABEL[r.role]}{r.auto ? ' (auto)' : ''}
      </div>
      <div class="full"><EvStrip evs={r.mon.evs} target={r.target} /></div>
      <div class="full small">{detail(r)}</div>
      {r.nature && r.status.state !== 'unknown' && (
        <div class="full small" style={{ color: 'var(--warn)' }}>{r.mon.nature} lowers {STAT_NAME[r.nature]}, which this role trains: about 10% less there.</div>
      )}
    </div>
  );
}

const raiseText = (s: EvStatus) => s.raise.map((c) => `${SHORT[c.stat]} +${c.to - c.from}`).join(' · ');

function detail(r: TrainRow): string {
  const s = r.status;
  const lv = r.mon.level ?? 0;
  switch (s.state) {
    case 'unknown': return 'EVs not known for a Pokémon typed by hand: Box Sync reads them.';
    case 'done': return 'Matches this role.';
    case 'later': return `Lv ${lv}: 252 EVs add only ${Math.floor((63 * lv) / 100)} points now. Level it first; EVs it earns now still count. Left: ${raiseText(s)}`;
    case 'reset': {
      const cut = s.lower.map((c) => `${SHORT[c.stat]} −${c.from - c.to} (${Math.ceil((c.from - c.to) / VITAMIN_EVS)} ${EV_BERRY[c.stat]})`).join(', ');
      return `No room within 510: lower ${cut}, or reset all six with a Fresh-Start Mochi. Then ${raiseText(s)}.`;
    }
    default: return `${raiseText(s)} · ${s.need} EVs left`;
  }
}

/** Six bars: fill = EVs now, tick = the role's target. */
export function EvStrip({ evs, target }: { evs?: Partial<StatTable>; target: StatTable }) {
  return (
    <div class="evstrip" aria-label={STATS.map((k) => `${STAT_NAME[k]} ${evs ? evs[k] ?? 0 : '?'} of ${target[k]}`).join(', ')}>
      {STATS.map((k) => {
        const now = evs?.[k] ?? 0;
        const t = target[k];
        const cls = now > t ? ' over' : t && now >= t ? ' done' : '';
        return (
          <div class="evcell">
            <div class="evbar">
              <i class={`fill${cls}`} style={{ width: `${(now / EV_MAX_STAT) * 100}%` }} />
              {t > 0 && <i class="tick" style={{ left: `calc(${(t / EV_MAX_STAT) * 100}% - 2px)` }} />}
            </div>
            <span><span>{SHORT[k]}</span><b>{evs ? now : '?'}</b></span>
          </div>
        );
      })}
    </div>
  );
}
