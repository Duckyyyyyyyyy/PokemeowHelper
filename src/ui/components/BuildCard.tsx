import { useMemo, useState } from 'preact/hooks';
import type { BoxMon, Dataset, StatTable } from '../../shared/types';
import { activeTab, goPrep, selectedNpc, selectedVariant } from '../store';
import { evRoles, setEvRole } from '../evRoleStore';
import {
  GOAL_LABEL, ROLES, ROLE_LABEL, autoRole, evStatus, foeSpeeds, hitsTaken, leanPlan, mainSide, natureAgainst, roleSpread, scoreGoal, speedVerdict,
  type EvGoal, type EvRole,
} from '../../engine/evRoles';
import { EV_BERRY, STATS, STAT_NAME, VITAMIN_EVS } from '../../engine/evPlan';
import { statsAtLevel, targetLevel } from '../../engine/potential';
import { dsFor, rulesFor } from '../../engine/rules';
import { TypeAvatar } from './hud';
import { Types } from './common';
import { FarmStat } from './EvPanel';

type Tab = EvRole | 'lean';
const SHORT = { hp: 'HP', atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe' } as const;

/**
 * One Pokémon: its roles side by side, by the stats they give and who it outspeeds in the Prep NPC's
 * team; what to grind, lower and where to farm. "Lean" (fewest Spe EVs to pass one foe) needs that NPC.
 */
export function BuildCard({ ds, mon, onBack }: { ds: Dataset; mon: BoxMon; onBack: () => void }) {
  const s = ds.species[mon.species];
  const auto = autoRole(ds, mon);
  const own = evRoles.value[mon.uid] ?? auto;
  const [tab, setTab] = useState<Tab>(own);
  const npc = selectedNpc.value;
  const v = npc?.variants[selectedVariant.value] ?? npc?.variants[0];
  const fight = v ? targetLevel(v) : undefined;
  // Scored at the fight's level when it is below it (EVs are for that fight), else at its own level.
  const atFight = !!fight && (mon.level ?? 0) < fight;
  const level = atFight ? fight! : mon.level ?? 50;
  // Same gates as Prep → Team: over the cap it can't enter; Frontier levels are unknown and World Bosses
  // are raids, so no speed verdicts there. Frontier stats use the Gen III view like Prep.
  const overCap = !!v?.levelCap && (mon.level ?? 0) > v.levelCap;
  const noSpeed = npc?.category === 'frontier' || npc?.category === 'boss';
  const fightDs = useMemo(() => dsFor(ds, rulesFor(npc?.category)), [ds, npc]);
  const foes = useMemo(() => (v && !overCap && !noSpeed ? foeSpeeds(fightDs, v) : []), [fightDs, v, overCap, noSpeed]);
  const lean = useMemo(() => (foes.length ? leanPlan(fightDs, mon, level, foes) : null), [fightDs, mon, level, foes]);
  const side = mainSide(ds, mon);
  const shownTab: Tab = tab === 'lean' && !lean ? own : tab;
  const spread: StatTable = shownTab === 'lean' ? lean!.spread : roleSpread(shownTab, side);
  const now = statsAtLevel(fightDs, { ...mon, evs: mon.evs ?? {} }, level);
  const next = statsAtLevel(fightDs, { ...mon, evs: spread }, level);
  const max = Math.max(...STATS.map((k) => Math.max(now[k], next[k]))) * 1.05;
  // `spread` is rebuilt every render; it only changes with `shownTab` and `lean`.
  const hits = useMemo(() => (v && foes.length ? hitsTaken(fightDs, mon, spread, level, v) : []), [fightDs, mon, shownTab, lean, level, v, foes]);
  const status = evStatus(mon, spread);
  const nature = natureAgainst(mon.nature, spread);
  const hasYields = useMemo(() => Object.values(ds.species).some((x) => x.evYield), [ds]);
  const total = STATS.reduce((a, k) => a + spread[k], 0);

  return (
    <>
      <div class="row small">
        <button class="link" onClick={onBack}>← Back</button>
        {npc && <span class="muted">· vs {npc.name}{fight ? ` (Lv ${fight})` : ''}</span>}
      </div>
      <div class="card">
        <div class="mon" style={{ borderBottom: 0, paddingTop: 0 }}>
          <TypeAvatar name={s?.name ?? '?'} types={s?.types ?? []} size={34} />
          <span class="nm">{s?.name ?? '?'}<Types types={s?.types ?? []} /></span>
          <span class="pill none">Auto: {ROLE_LABEL[auto]}</span>
          <div class="full small muted">
            {mon.level ? `Lv ${mon.level}` : 'Lv ?'}{mon.nature ? ` · ${mon.nature}` : ''}{mon.ability ? ` · ${mon.ability}` : ''}
          </div>
        </div>
        <div class="seg" role="tablist" aria-label="EV role">
          {ROLES.map((r) => (
            <button role="tab" class={shownTab === r ? 'on' : ''} aria-selected={shownTab === r} onClick={() => setTab(r)} title={ROLE_LABEL[r]}>{ROLE_LABEL[r].split(' ')[0]}</button>
          ))}
          {lean && <button role="tab" class={shownTab === 'lean' ? 'on' : ''} aria-selected={shownTab === 'lean'} onClick={() => setTab('lean')} title={`Lean: fewest Spe EVs to move before ${lean.foe.name}`}>Lean</button>}
        </div>
        <div class="small" style={{ margin: '6px 0 4px' }}>
          <b>{shownTab === 'lean' ? `Lean: pass ${lean!.foe.name}` : ROLE_LABEL[shownTab]}</b>: {STATS.filter((k) => spread[k]).map((k) => `${spread[k]} ${SHORT[k]}`).join(' / ')} ({total})
          <span class="muted"> · stats at Lv {level}{atFight ? " (the fight's level)" : mon.level === undefined ? ' (level not known: 50 assumed)' : ''}</span>
        </div>
        {STATS.map((k) => {
          const d = next[k] - now[k];
          return (
            <div class="statrow">
              <span class="k">{SHORT[k]} <span class="muted">{spread[k]}</span></span>
              <div class="sbar"><i class="b" style={{ width: `${(next[k] / max) * 100}%` }} />{mon.evs && <i class="a" style={{ width: `${(now[k] / max) * 100}%` }} />}</div>
              <span class="v">{next[k]}{d && mon.evs ? <b class={d > 0 ? 'up' : 'dn'}> {d > 0 ? '+' : ''}{d}</b> : null}</span>
            </div>
          );
        })}
        <div class="small muted" style={{ marginTop: '4px' }}>{mon.evs ? 'Grey = now, blue = with this spread.' : 'Blue = with this spread (its EVs now are not known).'}</div>
        <div class="btns" style={{ marginTop: '8px' }}>
          {shownTab !== 'lean' && shownTab !== own && <button class="btn primary sm" onClick={() => setEvRole(mon.uid, shownTab === auto ? null : shownTab)}>Use {ROLE_LABEL[shownTab]}</button>}
          {shownTab !== 'lean' && shownTab === own && <span class="small muted">This is its role{evRoles.value[mon.uid] ? ' (your pick)' : ' (auto)'}.</span>}
          {shownTab === 'lean' && <span class="small muted">Lean depends on the Prep opponent, so it isn't saved as the role.</span>}
        </div>
      </div>

      <div class="card">
        <p class="title">Speed {npc ? <span class="r">vs {npc.name}</span> : null}</p>
        {npc && overCap ? (
          <div class="small">Lv {mon.level} is over {npc.name}'s level cap ({v!.levelCap}), so it can't enter this fight. Speed {next.spe} at Lv {level}.</div>
        ) : npc && noSpeed ? (
          <div class="small">Speed {next.spe} at Lv {level}. No speed check for {npc.category === 'boss' ? 'World Boss raids' : 'the Battle Frontier (its levels are not known)'}; EVs aren't earned there either.</div>
        ) : npc && foes.length ? (
          <>
            {foes.map((f, i) => {
              const vd = speedVerdict(next.spe, f.spe);
              const h = hits[i];
              return (
                <div class="small" style={{ padding: '2px 0' }}>
                  <b style={{ color: vd === 'faster' ? 'var(--good)' : vd === 'tie' ? 'var(--warn)' : 'var(--bad)' }}>{vd === 'faster' ? '✓ Faster than' : vd === 'tie' ? '~ Ties with' : '✕ Slower than'}</b> {f.name} ({next.spe} vs {f.spe})
                  {h && h.maxPct > 0 && (
                    <span style={{ color: h.maxPct >= 100 ? 'var(--bad)' : 'inherit' }}> · takes {Math.round(h.minPct)}–{Math.round(h.maxPct)}% from {h.move}{h.minPct >= 100 ? ' (knocked out)' : h.maxPct >= 100 ? ' (may be knocked out)' : ''}</span>
                  )}
                </div>
              );
            })}
            <div class="small muted" style={{ marginTop: '4px' }}>NPC Speed and moves from its wiki set; hits from full HP with this spread, no crit. Not counted: Choice Scarf, paralysis, stat stages, Trick Room, weather. A tie is a coin flip.</div>
          </>
        ) : (
          <div class="small">
            Speed {next.spe} at Lv {level}. <button class="link small" onClick={() => { goPrep('npc'); activeTab.value = 'prep'; }}>Pick an opponent in Prep</button> to see who it outspeeds and to get the Lean option.
          </div>
        )}
      </div>

      <GoalCard ds={ds} mon={mon} own={own} auto={auto} />

      <div class="card">
        <p class="title">To grind</p>
        {status.state === 'unknown' && <div class="small">EVs not known for a Pokémon typed by hand. Box Sync reads them, then this lists what to grind.</div>}
        {status.state === 'done' && <div class="small">Already matches this spread.</div>}
        {status.state === 'later' && <div class="small">Lv {mon.level}: 252 EVs add only {Math.floor((63 * (mon.level ?? 0)) / 100)} points now. Level it first; EVs it earns now still count.</div>}
        {nature && <div class="small" style={{ color: 'var(--warn)' }}>{mon.nature} lowers {STAT_NAME[nature]}, which this spread trains: about 10% less there.</div>}
        {status.lower.length > 0 && (
          <div class="small">Lower first to fit 510: {status.lower.map((c) => `${STAT_NAME[c.stat]} −${c.from - c.to} (${Math.ceil((c.from - c.to) / VITAMIN_EVS)} ${EV_BERRY[c.stat]})`).join(', ')}, or reset all six with a Fresh-Start Mochi.</div>
        )}
        {status.raise.map((c) => <FarmStat ds={ds} stat={c.stat} need={c.to - c.from} hasYields={hasYields} maxLevel={(mon.level ?? level) + 10} />)}
        {status.raise.length > 1 && <div class="small muted" style={{ marginTop: '4px' }}>Tip: a teammate that holds an Exp. Share gets the same EVs while another Pokémon does the battling.</div>}
        <div class="small muted" style={{ marginTop: '4px' }}>Auto role: picked from base stats (a guess, not checked in battles). To score spreads against one NPC, use Prep → Team → EVs.</div>
      </div>
    </>
  );
}

/** Scores are slow (a damage duel per role × NPC Pokémon), so they run on tap and stay until the panel reloads. */
const goalCache = new Map<string, ReturnType<typeof scoreGoal>>();

function GoalCard({ ds, mon, own, auto }: { ds: Dataset; mon: BoxMon; own: EvRole; auto: EvRole }) {
  const [goal, setGoal] = useState<EvGoal | null>(null);
  const [busy, setBusy] = useState(false);
  const [, bump] = useState(0);
  const key = (g: EvGoal) => `${mon.uid}|${g}|${mon.level}|${JSON.stringify(mon.evs ?? null)}|${ds.version}`;
  const res = goal ? goalCache.get(key(goal)) : undefined;
  function run(g: EvGoal) {
    setGoal(g);
    if (goalCache.has(key(g))) return;
    setBusy(true);
    // Let "Scoring…" paint before the long synchronous run.
    setTimeout(() => {
      goalCache.set(key(g), scoreGoal(ds, mon, g));
      setBusy(false);
      bump((n) => n + 1);
    }, 30);
  }
  const best = res?.roles[0];
  return (
    <div class="card">
      <p class="title">Score roles vs a goal</p>
      <div class="chips" role="group" aria-label="Goal">
        {(Object.keys(GOAL_LABEL) as EvGoal[]).map((g) => (
          <button class={`chip${goal === g ? ' on' : ''}`} aria-pressed={goal === g} disabled={busy} onClick={() => run(g)}>{GOAL_LABEL[g]}</button>
        ))}
      </div>
      {busy && <div class="small muted" role="status" style={{ marginTop: '6px' }}>Scoring every role against {GOAL_LABEL[goal!]}…</div>}
      {!busy && res && (
        res.teams === 0 ? (
          <div class="small muted" style={{ marginTop: '6px' }}>No {GOAL_LABEL[goal!]} teams it can enter in your data.</div>
        ) : (
          <div class="small" style={{ marginTop: '6px' }}>
            <div class="muted">1v1 wins against {res.teams} team{res.teams > 1 ? 's' : ''} ({res.now.total} Pokémon), at each fight's level:</div>
            {[...res.roles, res.now].map((r) => (
              <div class="row" style={{ justifyContent: 'space-between' }}>
                <span>{r === best ? <b>{r.label}</b> : r.label}{r.role === own ? <span class="muted"> (its role)</span> : null}</span>
                <span class="num">{r.wins}/{r.total}</span>
              </div>
            ))}
            {best?.role && best.role !== own && best.wins > (res.roles.find((r) => r.role === own)?.wins ?? 0) && (
              <button class="btn sm primary" style={{ marginTop: '6px' }} onClick={() => setEvRole(mon.uid, best.role === auto ? null : best.role!)}>Use {best.label}</button>
            )}
          </div>
        )
      )}
      <div class="small muted" style={{ marginTop: '4px' }}>Same 1v1 scorer as Prep → Team. Teams whose level cap it is over are left out. Can take a few seconds.</div>
    </div>
  );
}
