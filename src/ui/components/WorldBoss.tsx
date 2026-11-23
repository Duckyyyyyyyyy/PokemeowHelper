import { useMemo } from 'preact/hooks';
import type { Dataset, Npc, NpcTeamVariant } from '../../shared/types';
import { bossLobby, bossPicks, clearBossPick, lobbyMovesFor, setBossPick, type ActiveBossMoves } from '../bossStore';
import { box } from '../store';
import { excludedUids, lockedUids } from '../teamPrefs';
import { typeColor, TypeBadge } from './common';
import { rulesFor } from '../../engine/rules';
import { bossForm, bossFormOfNpc, bossPool, bossRules, lootTier, maxMoveName, maxMovePower, suggestBossTeam, BOSS_TURN_CAP, type BossMember } from '../../engine/worldBoss';

const n0 = (x: number) => Math.round(x).toLocaleString('en-US');
/** Shares of a 10,000,000 HP pool are tiny: two significant digits below 1%. */
const pct = (x: number) => (x <= 0 ? '0%' : x < 1 ? `${Number(x.toPrecision(2))}%` : `${x.toFixed(1)}%`);

function when(iso?: string): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? undefined : d.toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
}

/**
 * The boss's move pool as chips you can tap. Pre-selected from the World Boss page when it listed
 * this boss's moves; otherwise you tap what the boss carries. Nothing picked = all moves counted.
 */
export function BossMovePicker({ ds, npc, pool, active }: { ds: Dataset; npc: Npc; pool: string[]; active: ActiveBossMoves | null }) {
  const lobby = lobbyMovesFor(ds, npc, bossLobby.value);
  const sel = active?.ids ?? [];
  const toggle = (id: string) => {
    const next = sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id];
    if (next.length) setBossPick(npc.id, pool.filter((p) => next.includes(p)));
    else clearBossPick(npc.id);
  };
  const source = !active
    ? null
    : active.source === 'lobby'
      ? (active.lobby?.isNext ? 'From lobby · next spawn' : `From lobby · ${active.lobby?.build.name} details`)
      : 'Your pick';
  const spawn = when(active?.lobby?.isNext ? active.lobby.startsAt : undefined);
  const maxMoves = bossRules(bossFormOfNpc(ds, npc)).maxMoves;
  return (
    <div class="card">
      <p class="title">
        Moves this spawn
        <span class="r">{active ? `${sel.length} of ${pool.length}` : `all ${pool.length}`}</span>
      </p>
      {source && <div class="small"><span class={`pill ${active!.source === 'lobby' ? 'good' : 'ok'}`}>{source}</span>{spawn && <span class="muted"> · appears {spawn}</span>}</div>}
      <div class="mvpick" role="group" aria-label="Boss moves this spawn">
        {pool.map((id) => {
          const m = ds.moves[id];
          const on = sel.includes(id);
          const state = !active ? '' : on ? ' on' : ' off';
          return (
            <button type="button" class={`mv${state}`} aria-pressed={on} onClick={() => toggle(id)}
              title={m ? `${m.type} · ${m.category}${m.power ? ` · ${m.power} BP` : ''}${maxMoves && m.category !== 'Status' ? ` → ${maxMoveName(m)} ${maxMovePower(m)} BP (assumed)` : ''}\n${m.description}` : id}>
              <i style={{ background: m ? typeColor(m.type) : undefined }} />
              {m?.name ?? id}
              {m && m.category !== 'Status' && m.power ? <span class="pw">{m.power}</span> : null}
            </button>
          );
        })}
      </div>
      <div class="small muted">
        {active
          ? 'Greyed-out moves are ignored below and in the Battle tab. Tap to change.'
          : 'A World Boss carries only part of this pool each time. Open the boss details on the game’s World Boss page (the next boss’s name or “About this boss”), or tap the moves it carries.'}
      </div>
      {lobby && lobby.unknown.length > 0 && <div class="small bad-t">Listed by the game but not in the wiki pool (not counted): {lobby.unknown.join(', ')}</div>}
      {(active?.source === 'manual' || (active && lobby)) && (
        <div class="btns">
          {active.source === 'manual' && lobby && <button class="btn sm" onClick={() => clearBossPick(npc.id)}>Use lobby moves</button>}
          {active.source === 'manual' && !lobby && <button class="btn sm" onClick={() => clearBossPick(npc.id)}>Clear (count all)</button>}
          {active.source === 'lobby' && bossPicks.value[npc.id] && <button class="btn sm" onClick={() => clearBossPick(npc.id)}>Drop my old pick</button>}
        </div>
      )}
    </div>
  );
}

function MemberRow({ ds, m }: { ds: Dataset; m: BossMember }) {
  const name = ds.species[m.mon.species]?.name ?? '?';
  const walls = m.turns >= BOSS_TURN_CAP;
  return (
    <div class="wbm">
      <div class="row">
        <b class="grow">{name}{m.mon.level ? <span class="muted small"> Lv {m.mon.level}</span> : null}</b>
        <span class="pill good" title="Boss HP per attacking turn once the Max Barrier is down (125x, per-action cap; accuracy included, shield not). About a fifth of this while the barrier is up.">{n0(m.perTurn)} HP/turn</span>
      </div>
      <div class="small">
        {m.moveName ? <>Best: <b>{m.moveName}</b> · {pct(m.perTurnPct)} of the shared HP per turn</> : <span class="bad-t">No damaging move that works here</span>}
      </div>
      <div class="small muted">
        {walls ? `Outlasts ${BOSS_TURN_CAP} turns` : `Survives ${m.turns} turn${m.turns === 1 ? '' : 's'}`} (takes ~{Math.round(m.takenPct)}%/turn{m.worst ? `, worst ${m.worst.maxName ?? m.worst.name} ${Math.round(m.worst.pct)}%` : ''})
        {' · '}total {n0(m.total)}–{n0(m.totalDown)} ({pct(m.totalPct)}+)
      </div>
      {m.plan.kind !== 'attack' && <div class="small">Plan: {m.plan.label}</div>}
      {m.notes.map((t) => <div class="small muted">{t}</div>)}
    </div>
  );
}

/** Your team's expected damage → loot tier (75k / 150k / 300k / 600k; Eternamax x10). Tiers also need a win. */
function LootLine({ low, high, form }: { low: number; high: number; form: ReturnType<typeof bossForm> }) {
  const a = lootTier(low, form);
  const b = lootTier(high, form);
  const tiers = bossRules(form).tiers.map((t) => `${t / 1000}k`).join(' / ');
  return (
    <div class="small">
      Expected damage ≈ <b>{n0(low)}–{n0(high)}</b> → loot tier <b>{a.tier === b.tier ? a.tier : `${a.tier}–${b.tier}`}</b> of {bossRules(form).tiers.length}
      {b.next ? <span class="muted"> · next at {n0(b.next)}</span> : null}
      <span class="muted"> ({tiers}, needs a win; not checked in a real raid)</span>
    </div>
  );
}

/** Counter-team for a World Boss: a damage race vs the selected moves. */
export function BossCounter({ ds, npc, v }: { ds: Dataset; npc: Npc; v: NpcTeamVariant }) {
  const rules = rulesFor(npc.category);
  const pool = bossPool(npc, ds);
  const form = bossFormOfNpc(ds, npc);
  const res = useMemo(
    () => (box.value.length ? suggestBossTeam(ds, box.value, v, { levelCap: v.levelCap, rules, pool, form, excluded: excludedUids.value, locked: lockedUids.value }) : null),
    [ds, box.value, v, pool, form, excludedUids.value, lockedUids.value],
  );
  return (
    <>
      <div class="card">
        <p class="title">Counter-team<span class="r">{res ? `${pct(res.totalPct)} of ${n0(pool)} HP` : ''}</span></p>
        {!res ? (
          <div class="small muted">Add or sync your box (Prep → Team) to get a counter-team.</div>
        ) : !res.team.length ? (
          <div class="small muted">No eligible Pokémon in your box.</div>
        ) : (
          <>
            <div class="small muted">Ranked by damage dealt before fainting against the moves above. Totals run from barrier up (only your own damage wears it down) to barrier down (busy raid, or after {res.form === 'eternamax' ? '30 s' : '2 min'}).</div>
            <LootLine low={res.total} high={res.totalDown} form={res.form} />
            {res.team.map((m) => <MemberRow ds={ds} m={m} />)}
          </>
        )}
      </div>
      {res && res.dangers.length > 0 && (
        <div class="card">
          <p class="title">Danger</p>
          {res.dangers.slice(0, 6).map((d) => (
            <div class="small">
              <TypeBadge type={d.hit.type} /> <b>{d.hit.maxName ?? d.hit.name}</b>{d.hit.maxName && <span class="muted"> from {d.hit.name}</span>}
              {' · '}{d.heavy ? <span class="bad-t">50%+ to {d.heavy} of your team</span> : <span class="muted">under 50% to your team</span>}
              {d.topName && <span class="muted"> · up to {Math.round(d.top)}% ({d.topName})</span>}
            </div>
          ))}
        </div>
      )}
      {res && (
        <div class="small muted foot">{res.notes.join(' ')}</div>
      )}
    </>
  );
}
