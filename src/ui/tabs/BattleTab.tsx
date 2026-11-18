import { useMemo } from 'preact/hooks';
import { ownedItems } from '../bagStore';
import type { BattleMon, BattleSnapshot, Boosts } from '../../shared/battle';
import type { Dataset } from '../../shared/types';
import { Empty, Tip, Types, scoreClass } from '../components/common';
import { adviseTurn, type ActionAdvice } from '../../engine/turnAdvisor';
import { battle, damageChecks, guessScore, loadSampleBattle, observed } from '../battleStore';
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
        {import.meta.env.DEV && <button class="btn" style={{ width: '100%' }} onClick={loadSampleBattle}>Load sample battle (dev)</button>}
        <Tip kind="info">MeowHelper only gives advice. You always pick your moves – it never clicks for you.</Tip>
      </>
    );
  }
  return <Live ds={ds} snap={snap} />;
}

function Live({ ds, snap }: { ds: Dataset; snap: BattleSnapshot }) {
  const advice = useMemo(() => (snap.status === 'active' ? adviseTurn(ds, snap, box.value, { observed: observed.value, items: ownedItems.value }) : null), [ds, snap, box.value, observed.value, ownedItems.value]);
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

      {ended ? (
        <Tip kind={snap.status === 'won' ? 'ok' : 'danger'}>{snap.status === 'won' ? 'You won the battle!' : 'You lost this one.'} Pick the next NPC in the NPC tab to plan a team.</Tip>
      ) : snap.status !== 'active' ? (
        <Tip kind="info">Battle state: {snap.status}. Advice shows while the battle is active.</Tip>
      ) : advice && (
        <>
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
            <p class="title">Best options</p>
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

function Action({ a, top }: { a: ActionAdvice; top: boolean }) {
  return (
    <div class={`act${top ? ' top' : ''}`}>
      <span class={`score ${scoreClass(a.score ?? 0)}`}>{a.score}</span>
      <div class="grow">
        <b>{a.kind === 'switch' ? '⇄ ' : a.kind === 'item' ? '🎒 ' : ''}{a.label}</b>
        {a.minPct !== undefined && <span class="muted"> · {Math.round(a.minPct)}–{Math.round(a.maxPct!)}%</span>}
        {a.ko === 'sure' && <span class="chip on" style={{ padding: '0 7px', marginLeft: '4px' }}>KO</span>}
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
            {c.attacker} {c.move} → {c.target}: <b>{c.damage}</b> <span class="muted">(calc {c.lo}–{c.hi}{c.capped ? ', KO: capped' : ''})</span>
          </div>
        ))}
      </div>
      <div class="small muted" style={{ marginTop: '4px' }}>Damage the game reported vs the Gen 9 calc. Only hits where both Pokémon's exact sets are known; crits and unusual hits are skipped.</div>
    </details>
  );
}
