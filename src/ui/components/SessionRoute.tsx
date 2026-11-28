import { useMemo } from 'preact/hooks';
import type { Dataset } from '../../shared/types';
import { farmGroups, trainRow } from '../../engine/evRoles';
import { STAT_NAME, type StatKey } from '../../engine/evPlan';
import { mapAccess, passedStage } from '../../engine/hunt';
import { allTips } from '../../engine/tips';
import { sessionRoutes, EXP_WINDOW } from '../../engine/route';
import { box, selectedNpc } from '../store';
import { doneTips } from '../tipsStore';
import { allMapsOpen, hunt, seenMaps, setAllMapsOpen } from '../huntStore';
import { evRoles } from '../evRoleStore';

const ACCESS: Record<string, string> = { seen: 'Seen', ticked: 'Unlocked', open: 'Open', guess: 'Reachable?' };

/**
 * Wild → Maps: the maps that serve the most goals in one session: hunt-list catches, EVs the Farm list
 * needs (your own roles), and foes near your team's level. Reachability is the Hunt & Grind guess.
 */
export function SessionRoute({ ds }: { ds: Dataset }) {
  const stops = useMemo(() => {
    const rows = box.value.map((m) => trainRow(ds, m, 'own', evRoles.value));
    const needs = new Map<StatKey, number>(farmGroups(rows).map((g) => [g.stat, g.total]));
    const top = box.value.filter((b) => b.level).map((b) => b.level!).sort((a, b) => b - a).slice(0, 6);
    const progress = { tips: allTips(ds), done: new Set(doneTips.value), seenMaps: seenMaps.value, passed: passedStage(selectedNpc.value), allOpen: allMapsOpen.value };
    return sessionRoutes(ds, {
      hunt: new Set(hunt.value.list.map((e) => e.species)),
      needs,
      teamLevel: top.length ? Math.round(top.reduce((a, b) => a + b, 0) / top.length) : undefined,
      access: (id) => mapAccess(id, progress).access,
    });
  }, [ds, box.value, evRoles.value, hunt.value, doneTips.value, seenMaps.value, selectedNpc.value, allMapsOpen.value]);
  return (
    <div class="card">
      <p class="title">Best session now <span class="r">catch · EVs · EXP</span></p>
      {!stops.length && <div class="small muted">No map serves your hunt list, EV needs or EXP right now.</div>}
      {stops.map((s, i) => (
        <div class="routestop">
          <div class="row" style={{ justifyContent: 'space-between' }}>
            <b class="farmstat">{i + 1}. {s.map.name}</b>
            <span class={`pill ${s.access === 'guess' ? 'ok' : 'good'}`}>{ACCESS[s.access] ?? s.access}</span>
          </div>
          <div class="lanes">
            <div class="lanebox"><h4>Catch</h4>{s.catches.length ? s.catches.slice(0, 2).map((c) => <div>{c.name} <span class="muted">({c.rarity.replace('-', ' ')})</span></div>) : <div class="muted">—</div>}</div>
            <div class="lanebox"><h4>EVs</h4>{s.evs.length ? s.evs.slice(0, 2).map((e) => <div>{e.name}: {e.amount} {STAT_NAME[e.stat]}</div>) : <div class="muted">—</div>}</div>
            <div class="lanebox"><h4>EXP</h4><div class={s.exp ? '' : 'muted'}>Lv {s.map.levels[0]}–{s.map.levels[1]}{s.exp ? '' : ' (low)'}</div></div>
          </div>
        </div>
      ))}
      <label class="small row" style={{ gap: '6px', marginTop: '6px' }}>
        <input type="checkbox" checked={allMapsOpen.value} onChange={(e) => setAllMapsOpen(e.currentTarget.checked)} />
        All maps unlocked
      </label>
      <div class="small muted" style={{ marginTop: '4px' }}>
        Catch = your hunt list. EVs = what Train → Farm still needs (each Pokémon's own role). EXP = wild levels within {EXP_WINDOW} of your strongest six. {allMapsOpen.value ? 'Every map counts as unlocked (your switch).' : '"Reachable?" is a guess from Tips and your Prep NPC; tick "All maps unlocked" if you have them all.'} Maps only, not exact spots or time of day.
      </div>
    </div>
  );
}
