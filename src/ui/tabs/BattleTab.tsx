import { useMemo, useState } from 'preact/hooks';
import { ownedItems } from '../bagStore';
import { doublesReason, type BattleMon, type BattleSnapshot, type Boosts } from '../../shared/battle';
import type { Dataset } from '../../shared/types';
import { Empty, Tip, Types, scoreClass } from '../components/common';
import { adviseTurn, matchNpc, type ActionAdvice } from '../../engine/turnAdvisor';
import { battle, damageChecks, doublesMoves, guessScore, loadSampleBattle, observed } from '../battleStore';
import { adviseDoubles, type DoublesAction, type DoublesAdvice } from '../../engine/doublesAdvisor';
import { box, dataset, isExtension } from '../store';
import { NoData } from './shared';
import { timeAgo } from '../boxStore';

const STATUS_LABEL: Record<string, string> = { par: 'PAR', brn: 'BRN', psn: 'PSN', tox: 'TOX', slp: 'SLP', frz: 'FRZ' };
const BOOST_LABEL: Record<string, string> = { atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe', accuracy: 'Acc', evasion: 'Eva' };

export function BattleTab() {
  const ds = dataset.value;
  const snap = battle.value;
  if (!ds) return <NoData />;
  if (!snap) {
    return (
      <>
        <Empty title="No battle open">
          <p class="small">Start a battle on pokemeowrpg.com. MeowHelper reads the battle screen (read-only) and ranks your options every turn.</p>
          {isExtension && <p class="small muted">Just installed or updated MeowHelper? Reload the game tab once so it can see the battle.</p>}
        </Empty>
        {import.meta.env.DEV && <button class="btn" style={{ width: '100%' }} onClick={() => loadSampleBattle()}>Load sample battle (dev)</button>}
        {import.meta.env.DEV && <button class="btn" style={{ width: '100%', marginTop: '6px' }} onClick={() => loadSampleBattle('doubles')}>Load sample doubles battle (dev)</button>}
        <Tip kind="info">MeowHelper only gives advice. You always pick your moves – it never clicks for you.</Tip>
      </>
    );
  }
  // Doubles layout read (per-position cards, seen live 2026-11-19): doubles advice, also once a side is down to one Pokémon.
  if (snap.actives && (snap.actives.player.length || snap.actives.opponent.length)) return <DoublesLive ds={ds} snap={snap} />;
  return <Live ds={ds} snap={snap} />;
}

function Live({ ds, snap }: { ds: Dataset; snap: BattleSnapshot }) {
  const doubles = useMemo(() => doublesReason(snap, matchNpc(ds, snap)?.variant.format), [ds, snap]);
  const [forceSingles, setForceSingles] = useState(false);
  // Singles advice in a doubles battle would look right and be wrong: hide it unless asked for.
  const hideAdvice = !!doubles && !forceSingles;
  const advice = useMemo(() => (snap.status === 'active' && !hideAdvice ? adviseTurn(ds, snap, box.value, { observed: observed.value, items: ownedItems.value }) : null), [ds, snap, box.value, observed.value, ownedItems.value, hideAdvice]);
  const ended = snap.status === 'won' || snap.status === 'lost';
  const ranked = advice?.actions.filter((a) => a.score !== null) ?? [];
  const unscored = advice?.actions.filter((a) => a.score === null) ?? [];

  return (
    <>
      <div class="card">
        <p class="title" style={{ margin: 0 }}>
          vs {snap.opponentName ?? 'opponent'}
          <span class="r">{snap.turn ? `Turn ${snap.turn}` : ''}{advice?.variant && advice.npc && advice.npc.variants.length > 1 ? ` · ${advice.variant.label}` : ''}</span>
        </p>
        {snap.player && <Side ds={ds} label="You" mon={snap.player} boosts={snap.boosts.player} />}
        {snap.opponent && <Side ds={ds} label="Them" mon={snap.opponent} boosts={snap.boosts.opponent} foe />}
      </div>

      {doubles && !ended && (
        <Tip kind="warn">
          <b>Doubles: not fully supported yet.</b> MeowHelper only reads one Pokémon per side and scores a 1v1, so its advice would be wrong here ({doubles}).{' '}
          {hideAdvice
            ? <button class="btn" style={{ marginTop: '6px' }} onClick={() => setForceSingles(true)}>Show 1v1 advice anyway</button>
            : <>Showing 1v1 advice for the first Pokémon on each side – treat it as a rough guide. <button class="btn" style={{ marginTop: '6px' }} onClick={() => setForceSingles(false)}>Hide it</button></>}
        </Tip>
      )}
      {ended ? (
        <Tip kind={snap.status === 'won' ? 'ok' : 'danger'}>{snap.status === 'won' ? 'You won the battle!' : 'You lost this one.'} Pick the next NPC in the NPC tab to plan a team.</Tip>
      ) : snap.status !== 'active' ? (
        <Tip kind="info">Battle state: {snap.status}. Advice shows while the battle is active.</Tip>
      ) : advice && (
        <>
          {advice.forcedSwitch && (
            <Tip kind="warn">
              <b>{snap.player?.name ?? 'Your Pokémon'}</b> {snap.player?.hp === 0 ? 'fainted' : 'is out'}. Pick who to send in next{snap.opponent ? <> against <b>{snap.opponent.name}</b></> : ''}: it comes in without taking a hit.
            </Tip>
          )}
          {advice.threat && (
            <Tip kind={advice.threat.ko === 'sure' ? 'danger' : advice.threat.ko ? 'warn' : 'info'}>
              Their best hit: <b>{advice.threat.name}</b> {Math.round(advice.threat.minPct)}–{Math.round(advice.threat.maxPct)}% of your max HP
              {advice.threat.ko === 'sure' ? ' – KOs you' : advice.threat.ko ? ' – can KO you' : ''}.{' '}
              {advice.threat.youFirst === null ? 'Speed tie.' : advice.threat.youFirst ? 'You are faster.' : 'They are faster.'}
            </Tip>
          )}
          {advice.prediction && advice.prediction.length > 0 && (
            <div class="small muted" style={{ padding: '0 4px' }}>
              <b>Likely next (guess):</b>{' '}
              {advice.prediction.slice(0, 3).map((g, i) => (
                <>{i > 0 && ' · '}{g.name} {Math.round(g.prob * 100)}%{g.ko === 'sure' ? ' (KO)' : ''}</>
              ))}
              {guessScore.value.total > 0 && <> · guess right {guessScore.value.hit}/{guessScore.value.total} this battle</>}
              {advice.npcSwitch && <div title={advice.npcSwitch.reason}><b>May switch to {advice.npcSwitch.to}</b> (guess): {advice.npcSwitch.reason}</div>}
              {advice.seenBefore && <div>Seen in earlier battles: {advice.seenBefore.map((id) => ds.moves[id]?.name ?? id).join(', ')}</div>}
            </div>
          )}
          <div class="card">
            <p class="title">{advice.forcedSwitch ? 'Best switch-in' : 'Best options'}</p>
            {ranked.map((a, i) => <Action a={a} top={i === 0} />)}
            {!ranked.length && <div class="small muted">Nothing to score yet.</div>}
            {unscored.length > 0 && (
              <div class="small muted" style={{ marginTop: '6px' }}>
                {unscored.map((a) => <div><b>{a.label}</b>: {a.reason}</div>)}
              </div>
            )}
          </div>
          {advice.notes.length > 0 && <div class="small muted">{advice.notes.map((n) => <div>• {n}</div>)}</div>}
        </>
      )}

      <CalcCheck />

      {snap.log.length > 0 && (
        <details class="card">
          <summary class="title" style={{ margin: 0, cursor: 'pointer' }}>Battle log</summary>
          <div class="small" style={{ marginTop: '6px' }}>{snap.log.slice(-8).map((l) => <div>{l}</div>)}</div>
        </details>
      )}
      <div class="foot">
        Read from the battle screen {timeAgo(snap.at)}. Score = short 1v1 projection from the current HP, status and stat stages (best move each turn, no crits). Advice only – you pick the move.
      </div>
    </>
  );
}

function Side({ ds, label, mon, boosts, foe }: { ds: Dataset; label: string; mon: BattleMon; boosts: Boosts; foe?: boolean }) {
  const s = Object.values(ds.species).find((x) => x.name.toLowerCase() === mon.name.toLowerCase());
  const pct = mon.hp !== undefined && mon.maxHp ? Math.max(0, Math.min(100, (100 * mon.hp) / mon.maxHp)) : undefined;
  const stages = Object.entries(boosts).filter(([, v]) => v);
  return (
    <div class="mon">
      <div class={`av${foe ? ' foe' : ''}`}>{mon.name.slice(0, 2).toUpperCase()}</div>
      <span class="nm">{mon.name}{s && <Types types={s.types} />}</span>
      <span class="lv">{label} · Lv {mon.level ?? '?'}</span>
      <div class="full">
        {pct !== undefined && (
          <div class="hpbar" role="meter" aria-label={`${mon.name} HP`} aria-valuenow={mon.hp} aria-valuemax={mon.maxHp}>
            <i class={pct > 50 ? 'g' : pct > 20 ? 'y' : 'r'} style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
      <div class="full small muted row">
        <span>{mon.hp ?? '?'}/{mon.maxHp ?? '?'} HP</span>
        {mon.status && <span class="chip on" style={{ padding: '0 7px' }}>{STATUS_LABEL[mon.status] ?? mon.status}</span>}
        {stages.map(([k, v]) => <span class="chip" style={{ padding: '0 7px' }}>{BOOST_LABEL[k] ?? k} {v! > 0 ? `+${v}` : v}</span>)}
        {mon.item && <span>@ {mon.item}</span>}
      </div>
    </div>
  );
}

export function Action({ a, top }: { a: ActionAdvice; top: boolean }) {
  return (
    <div class={`act${top ? ' top' : ''}`}>
      <span class={`score ${scoreClass(a.score ?? 0)}`}>{a.score}</span>
      <div class="grow">
        <b>{a.kind === 'switch' ? '⇄ ' : a.kind === 'item' ? '🎒 ' : ''}{a.label}</b>
        {a.minPct !== undefined && <span class="muted"> · {Math.round(a.minPct)}–{Math.round(a.maxPct!)}%</span>}
        {a.tag === 'setup' && <span class="chip" style={{ padding: '0 7px', marginLeft: '4px' }} title="Support move: compared with attacking right away (stat stages, status, screens, weather, hazards).">Setup</span>}
        {a.ko === 'sure' && <span class="chip on" style={{ padding: '0 7px', marginLeft: '4px' }}>KO</span>}
        {a.threat?.ko && <span class="chip" style={{ padding: '0 7px', marginLeft: '4px' }}>{a.threat.ko === 'sure' ? 'They KO it' : 'They can KO it'}</span>}
        <div class="small muted">{a.reason}</div>
      </div>
    </div>
  );
}

const VERDICT = { ok: '✓', off: '✗', 'set-mismatch': '≠' } as const;

/** Real damage from the battle log vs the calc range for the same hit. */
function CalcCheck() {
  const checks = damageChecks.value;
  if (!checks.length) return null;
  const judged = checks.filter((c) => c.verdict !== 'set-mismatch');
  const ok = judged.filter((c) => c.verdict === 'ok').length;
  return (
    <details class="card">
      <summary class="title" style={{ margin: 0, cursor: 'pointer' }}>
        Calc check <span class="r">{judged.length ? `${ok}/${judged.length} hits in range` : 'sets differ'}</span>
      </summary>
      <div class="small" style={{ marginTop: '6px' }}>
        {checks.slice(-8).map((c) => (
          <div title={c.verdict === 'set-mismatch' ? 'Max HP on screen differs from the calc: IVs/EVs/level in the data differ, so this hit is not judged.' : undefined}>
            <b class={c.verdict === 'ok' ? 'ok-t' : c.verdict === 'off' ? 'bad-t' : 'muted'}>{VERDICT[c.verdict]}</b>{' '}
            {c.attacker} {c.move} → {c.target}: <b>{c.damage}</b> <span class="muted">(calc {c.lo}–{c.hi}{c.spread ? ', spread ×0.75' : ''}{c.capped ? ', KO: capped' : ''})</span>
          </div>
        ))}
      </div>
      <div class="small muted" style={{ marginTop: '4px' }}>Damage the game reported vs the Gen 9 calc. Only hits where both Pokémon's exact sets are known; crits and unusual hits are skipped.</div>
    </details>
  );
}

/* ---------------- Doubles (Phase 4b) ---------------- */

function DoublesLive({ ds, snap }: { ds: Dataset; snap: BattleSnapshot }) {
  const advice = useMemo(
    () => (snap.status === 'active' ? adviseDoubles(ds, snap, box.value, { observed: observed.value, movesByMon: doublesMoves.value }) : null),
    [ds, snap, box.value, observed.value, doublesMoves.value],
  );
  const ended = snap.status === 'won' || snap.status === 'lost';
  const mine = snap.actives?.player ?? [];
  const theirs = snap.actives?.opponent ?? [];
  return (
    <>
      <div class="card">
        <p class="title" style={{ margin: 0 }}>
          vs {snap.opponentName ?? 'opponent'} <span class="chip sm">Doubles</span>
          <span class="r">{snap.turn ? `Turn ${snap.turn}` : ''}</span>
        </p>
        {theirs.map((m) => <Side ds={ds} label={`Them · ${m.position ?? ''}`} mon={m} boosts={m.stages ?? {}} foe />)}
        {mine.map((m) => <Side ds={ds} label={`You · ${m.position ?? ''}`} mon={m} boosts={m.stages ?? {}} />)}
      </div>

      {ended ? (
        <Tip kind={snap.status === 'won' ? 'ok' : 'danger'}>{snap.status === 'won' ? 'You won the battle!' : 'You lost this one.'}</Tip>
      ) : snap.status !== 'active' ? (
        <Tip kind="info">Battle state: {snap.status}. Advice shows while the battle is active.</Tip>
      ) : advice && <DoublesBody advice={advice} />}

      <CalcCheck />
      {snap.log.length > 0 && (
        <details class="card">
          <summary class="title" style={{ margin: 0, cursor: 'pointer' }}>Battle log</summary>
          <div class="small" style={{ marginTop: '6px' }}>{snap.log.slice(-8).map((l) => <div>{l}</div>)}</div>
        </details>
      )}
      <div class="foot">
        Read from the battle screen {timeAgo(snap.at)}. Doubles score = one-turn view: damage on the target's HP left, KO chance, how dangerous the target is, spread moves at ×0.75 minus the hit on your ally. Advice only – you pick the moves and targets.
      </div>
    </>
  );
}

function DoublesBody({ advice }: { advice: DoublesAdvice }) {
  return (
    <>
      {advice.plan && advice.plan.picks.length > 0 && (
        <div class="card">
          <p class="title">Suggested this turn <span class="r small muted">score {advice.plan.score}</span></p>
          {advice.plan.picks.map((a) => (
            <div class="small" style={{ margin: '2px 0' }}><b>{a.user}</b>: {a.label} <TargetChip a={a} /></div>
          ))}
          {advice.plan.why.length > 0 && <div class="small muted" style={{ marginTop: '4px' }}>{advice.plan.why.map((w) => <div>• {w}</div>)}</div>}
        </div>
      )}
      {advice.mine.map((m) => (
        <div class="card">
          <p class="title">{m.mon.name} <span class="r small muted">{m.mon.position ? `Position ${m.mon.position}` : ''}</span></p>
          {m.danger && (
            <div class={`small ${m.danger.ko === 'sure' ? 'bad-t' : m.danger.ko ? 'warn-t' : 'muted'}`} style={{ marginBottom: '4px' }}>
              If both foes hit it: {Math.round(m.danger.minPct)}–{Math.round(m.danger.maxPct)}%{m.danger.ko === 'sure' ? ' – KOs it' : m.danger.ko ? ' – can KO it' : ''} ({m.danger.from.join(', ')}).
            </div>
          )}
          {m.actions.filter((a) => a.score !== null).slice(0, 5).map((a, i) => <DoublesActionRow a={a} top={i === 0} />)}
          {!m.actions.length && <div class="small muted">Moves not known yet: open {m.mon.name}'s command (or its Switch card) in the game once, or sync your box.</div>}
          {m.actions.some((a) => a.score === null) && (
            <div class="small muted" style={{ marginTop: '4px' }}>
              {m.actions.filter((a) => a.score === null).map((a) => <div><b>{a.label}</b>: {a.reason}</div>)}
            </div>
          )}
          {m.movesFrom === 'box' && <div class="small muted" style={{ marginTop: '4px' }}>Moves from your box (not seen on the battle screen yet).</div>}
        </div>
      ))}
      {advice.foes.length > 0 && (
        <div class="small muted" style={{ padding: '0 4px' }}>
          <b>Their likely moves (guess):</b>
          {advice.foes.map((f) => (
            <div>
              {f.mon.name}: {f.likely.map((g, i) => <>{i > 0 && ' · '}{g.name}{g.spread ? ' (hits both)' : g.target ? ` → ${g.target}` : ''} {Math.round(g.prob * 100)}%{g.ko === 'sure' ? ' (KO)' : ''}</>)}
            </div>
          ))}
          {guessScore.value.total > 0 && <div>Guess right {guessScore.value.hit}/{guessScore.value.total} this battle</div>}
        </div>
      )}
      {advice.order.length > 0 && (
        <div class="small muted" style={{ padding: '0 4px' }}>
          <b>Speed order:</b> {advice.order.map((o) => `${o.name}${o.side === 'opponent' ? ' (them)' : ''}`).join(' → ')}
        </div>
      )}
      {advice.notes.length > 0 && <div class="small muted">{advice.notes.map((n) => <div>• {n}</div>)}</div>}
    </>
  );
}

function TargetChip({ a }: { a: DoublesAction }) {
  if (a.spread) return <span class="chip sm" title="Hits every adjacent Pokémon (×0.75 each)">all adjacent</span>;
  if (!a.target) return null;
  const who = a.target.side === 'opponent' ? `Opponent ${a.target.position ?? ''}`.trim() : `Ally ${a.target.position ?? ''}`.trim();
  return <span class="chip sm" title={`Pick “${who} : ${a.target.name}” in the game's target list`}>→ {a.target.name}</span>;
}

function DoublesActionRow({ a, top }: { a: DoublesAction; top: boolean }) {
  return (
    <div class={`act${top ? ' top' : ''}`}>
      <span class={`score ${scoreClass(a.score ?? 0)}`}>{a.score}</span>
      <div class="grow">
        <b>{a.label}</b> <TargetChip a={a} />
        {a.hits?.some((h) => h.ko === 'sure' && h.side === 'opponent') && <span class="chip on sm" style={{ marginLeft: '4px' }}>KO</span>}
        {(a.allyHit || a.allyUnknown) && <span class="chip warn sm" style={{ marginLeft: '4px' }} title={`Also hits your ${a.allyHit?.name ?? a.allyUnknown}`}>Hits ally</span>}
        {a.combo && <span class="chip sm" style={{ marginLeft: '4px' }} title={a.combo}>Combo</span>}
        <div class="small muted">{a.reason}{a.combo ? ` ${a.combo}.` : ''}</div>
      </div>
    </div>
  );
}
