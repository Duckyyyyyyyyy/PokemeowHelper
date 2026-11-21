import { useMemo, useState } from 'preact/hooks';
import { ownedItems } from '../bagStore';
import { doublesReason, type BattleSnapshot } from '../../shared/battle';
import type { Dataset } from '../../shared/types';
import { Empty, Tip } from '../components/common';
import { DangerStrip, Fold, Hp, Icon, Plate, RatePill, TypeAvatar, hpPct, speciesTypes } from '../components/hud';
import { adviseTurn, foeSet, indexes, matchNpc, mySet, type ActionAdvice, type ThreatInfo, type TurnAdvice } from '../../engine/turnAdvisor';
import { factsLine, plainLine, rate } from '../../engine/plain';
import { npcKey, seenByOthers, seenByYou } from '../../engine/observed';
import { battle, damageChecks, doublesMoves, forceGen3, guessScore, loadSampleBattle, observed, setForceGen3, towerRun } from '../battleStore';
import { runSummary } from '../../engine/towerPlan';
import { adviseDoubles, type DoublesAction, type DoublesAdvice, type DoublesMonAdvice } from '../../engine/doublesAdvisor';
import { activeTab, box, dataset, goPrep, isExtension, selectedNpcId, selectedVariant } from '../store';
import { NoData } from './shared';
import { bossMovesById } from '../bossStore';
import { timeAgo } from '../boxStore';
import { SimExport } from '../components/SimExport';
import { boxToShowdown, npcToShowdown, toShowdownSet } from '../../engine/showdownExport';

/** Showdown text of the two active Pokémon (the opponent only when its set is known from NPC data). */
function BattleSimExport({ ds, snap }: { ds: Dataset; snap: BattleSnapshot }) {
  const { mine, foe } = useMemo(() => {
    const idx = indexes(ds);
    const me = snap.player ? mySet(idx, box.value, snap.player, snap.moves.map((m) => m.name)) : undefined;
    const variant = matchNpc(ds, snap)?.variant;
    const theirs = snap.opponent && variant ? foeSet(ds, idx, variant, snap.opponent, { roster: snap.opponentTeam }) : undefined;
    return {
      mine: me ? toShowdownSet(boxToShowdown(ds, me.mon)) : '',
      foe: theirs?.known ? toShowdownSet(npcToShowdown(ds, theirs.mon)) : '',
    };
  }, [ds, snap, box.value]);
  return <SimExport mine={mine} foe={foe} mineLabel="Copy my Pokémon" foeLabel="Copy opponent" />;
}

export function BattleTab() {
  const ds = dataset.value;
  const snap = battle.value;
  if (!ds) return <NoData />;
  if (!snap) {
    return (
      <>
        <Empty title="No battle open">
          <p class="small">Start a battle on pokemeowrpg.com. MeowRPGAdvisor reads the battle screen (read-only), opens this tab and rates your moves every turn.</p>
          {isExtension && <p class="small muted">Just installed or updated MeowRPGAdvisor? Reload the game tab once so it can see the battle.</p>}
        </Empty>
        {import.meta.env.DEV && <button class="btn" style={{ width: '100%' }} onClick={() => loadSampleBattle()}>Load sample battle (dev)</button>}
        {import.meta.env.DEV && <button class="btn" style={{ width: '100%' }} onClick={() => loadSampleBattle('doubles')}>Load sample doubles battle (dev)</button>}
        <Tip kind="info">MeowRPGAdvisor only gives advice. You always pick your moves; it never clicks for you.</Tip>
      </>
    );
  }
  // Doubles layout read (per-position cards, seen live 2026-11-19): doubles advice, also once a side is down to one Pokémon.
  if (snap.actives && (snap.actives.player.length || snap.actives.opponent.length)) return <DoublesLive ds={ds} snap={snap} />;
  return <Live ds={ds} snap={snap} />;
}

const topScore = (as: { score: number | null }[]) => {
  const s = as.map((a) => a.score).filter((x): x is number => x !== null);
  return s.length ? Math.max(...s) : null;
};
const pct = (x: number) => (x > 0 && x < 0.01 ? '<1%' : `${Math.round(x * 100)}%`);

/** Options were rated and none is OK (45+) vs this NPC: link to Prep → Hunt & grind for it. */
function HuntLink({ advice, top }: { advice: TurnAdvice; top: number | null }) {
  const npc = advice.npc;
  if (!npc || top === null || top >= 45) return null; // nothing rated is not "no good answer"
  const open = () => {
    selectedNpcId.value = npc.id;
    selectedVariant.value = Math.max(0, advice.variant ? npc.variants.indexOf(advice.variant) : 0);
    goPrep('hunt');
  };
  return <p class="note"><button class="link small" onClick={open}>Hunt for a counter →</button></p>;
}

function VsHead({ snap, extra }: { snap: BattleSnapshot; extra?: string }) {
  return (
    <div class="vs-head">
      <b>VS {snap.opponentName ?? 'opponent'}</b>
      <span>{[snap.turn ? `Turn ${snap.turn}` : '', extra].filter(Boolean).join(' · ')}</span>
    </div>
  );
}

function Live({ ds, snap }: { ds: Dataset; snap: BattleSnapshot }) {
  const gen3 = forceGen3.value;
  const doubles = useMemo(() => doublesReason(snap, matchNpc(ds, snap)?.variant.format), [ds, snap]);
  const [forceSingles, setForceSingles] = useState(false);
  // Singles advice in a doubles battle would look right and be wrong: hide it unless asked for.
  const hideAdvice = !!doubles && !forceSingles;
  const advice = useMemo(() => (snap.status === 'active' && !hideAdvice ? adviseTurn(ds, snap, box.value, { observed: observed.value, items: ownedItems.value, gen3, bossMoves: bossMovesById.value }) : null), [ds, snap, box.value, observed.value, ownedItems.value, gen3, hideAdvice, bossMovesById.value]);
  const ended = snap.status === 'won' || snap.status === 'lost';
  const variant = advice?.variant && advice.npc && advice.npc.variants.length > 1 ? advice.variant.label : undefined;

  return (
    <>
      <VsHead snap={snap} extra={variant} />
      {snap.player && <Plate ds={ds} mon={snap.player} boosts={snap.boosts.player} threat={advice && !advice.forcedSwitch ? advice.threat : undefined} />}
      {snap.opponent && <Plate ds={ds} mon={snap.opponent} boosts={snap.boosts.opponent} foe />}
      
      {doubles && !ended && (
        <Tip kind="warn">
          <b>Doubles, but only one Pokémon per side could be read.</b> 1v1 advice would be wrong here ({doubles}).{' '}
          {hideAdvice
            ? <button class="btn sm" style={{ marginTop: '6px' }} onClick={() => setForceSingles(true)}>Show 1v1 advice anyway</button>
            : <>Showing 1v1 advice for the first Pokémon on each side as a rough guide. <button class="btn sm" style={{ marginTop: '6px' }} onClick={() => setForceSingles(false)}>Hide it</button></>}
        </Tip>
      )}
      {ended ? (
        <Tip kind={snap.status === 'won' ? 'ok' : 'danger'}>
          {snap.status === 'won' ? 'You won the battle!' : 'You lost this one.'}{' '}
          <button class="link" onClick={() => (activeTab.value = 'prep')}>Plan the next NPC in Prep →</button>
        </Tip>
      ) : snap.status !== 'active' ? (
        <Tip kind="info">Battle state: {snap.status}. Advice shows while the battle is active.</Tip>
      ) : advice && !advice.actions.length ? (
        <Tip kind="info">{advice.notes.length ? advice.notes.map((n) => <div>{n}</div>) : 'Nothing to rate yet.'}</Tip>
      ) : advice && (advice.forcedSwitch ? <ForcedSwitch ds={ds} snap={snap} advice={advice} /> : <Turn ds={ds} snap={snap} advice={advice} />)}

      <Fold title="Details">
        <BattleSimExport ds={ds} snap={snap} />
        {advice && <DetailBody ds={ds} snap={snap} advice={advice} />}
        <TowerRun advice={advice} />
        <CalcCheck gen3={gen3 || advice?.npc?.category === 'frontier'} />
        <label class="small muted row" style={{ gap: '6px' }} title="Battle Frontier battles use Gen III rules. Turn this on if MeowRPGAdvisor does not recognise a Frontier battle by itself.">
          <input type="checkbox" checked={gen3} onChange={(e) => setForceGen3((e.target as HTMLInputElement).checked)} />
          Battle Frontier: use Gen III rules{advice?.npc?.category === 'frontier' ? ' (on automatically for this Brain)' : ''}
        </label>
        {snap.log.length > 0 && <div class="card small"><p class="title">Battle log</p>{snap.log.slice(-8).map((l) => <div>{l}</div>)}</div>}
      </Fold>
      <div class="foot">Read from the battle screen {timeAgo(snap.at)}. Looks 2–3 turns ahead (their likely replies, damage rolls, crits). Advice only: you pick the move.</div>
    </>
  );
}

/** A normal turn: danger, the four move tiles in the game's order, switches, items. */
function Turn({ ds, snap, advice }: { ds: Dataset; snap: BattleSnapshot; advice: TurnAdvice }) {
  const moves = advice.actions.filter((a) => a.kind === 'move').sort((a, b) => (a.slot ?? 9) - (b.slot ?? 9));
  const switches = advice.actions.filter((a) => a.kind === 'switch');
  const items = advice.actions.filter((a) => a.kind === 'item');
  const top = topScore(advice.actions);
  const best = advice.actions[0]?.score !== null ? advice.actions[0] : undefined; // sorted best first, unrated last
  const bestMove = best?.kind === 'move' ? best : moves.filter((m) => m.score !== null).sort((a, b) => b.score! - a.score!)[0];
  const [openSwitch, setOpenSwitch] = useState<string | null>(null);
  const sw = switches.find((s) => s.label === openSwitch);

  return (
    <>
      <DangerStrip threat={advice.threat} />
      {best && best.kind !== 'move' && (
        <div class="better">
          <Icon name={best.kind === 'switch' ? 'swap' : 'bag'} />
          <span class="grow"><b>{best.label}</b> beats every move: {plainLine(best)}</span>
          <RatePill score={best.score} top={top} />
        </div>
      )}
      <div class="tiles">
        {moves.map((a) => <MoveTile ds={ds} snap={snap} a={a} top={top} best={a === bestMove} />)}
      </div>
      {bestMove && (
        <p class="say">
          <b>{bestMove.label}</b>: {plainLine(bestMove)}.
          {advice.threat?.ko === 'sure' && bestMove.facts?.koNow === 'sure' && bestMove.facts.movesFirst ? ' You are in KO range, but you hit first.' : ''}
          {bestMove.line ? <span class="muted"> Plan: {bestMove.line}.</span> : null}
        </p>
      )}
      <p class="note">Tiles sit where the game's move buttons are. Advice only: you pick the move.</p>
      <HuntLink advice={advice} top={top} />

      {switches.length > 0 && (
        <div class="bench" role="group" aria-label="Switch options">
          <span class="bl">Switch</span>
          {switches.map((a) => {
            const name = a.label.replace(/^(Switch to|Send in) /, '');
            return (
              <button class={openSwitch === a.label ? 'on' : ''} aria-expanded={openSwitch === a.label} onClick={() => setOpenSwitch(openSwitch === a.label ? null : a.label)}>
                <TypeAvatar name={name} types={speciesTypes(ds, name)} size={28} />
                <span>{name}</span>
                <RatePill score={a.score} top={top} unknown={a.unknownMoves} calcError={a.calcError} />
              </button>
            );
          })}
        </div>
      )}
      {sw && <p class="say small"><b>{sw.label}:</b> {sw.reason}</p>}

      {items.length > 0 && (
        <Fold title={`Items (${items.length})`}>
          <div class="card">{items.map((a) => <Action a={a} top={a === best} topScore={top} />)}</div>
        </Fold>
      )}
      <Guess ds={ds} snap={snap} advice={advice} />
    </>
  );
}

function MoveTile({ ds, snap, a, top, best }: { ds: Dataset; snap: BattleSnapshot; a: ActionAdvice; top: number | null; best: boolean }) {
  const m = a.moveId ? ds.moves[a.moveId] : undefined;
  const shown = a.slot !== undefined ? snap.moves[a.slot] : undefined;
  const type = m?.type ?? shown?.type;
  // A calc that threw is not "No effect" or "Weak": say so (0.11.1 fix).
  const r = a.calcError ? { label: 'Calc error', tone: 'calc' } : a.score === null ? { label: a.tag === 'setup' ? 'Support' : 'Not rated', tone: 'none' } : rate(a.score, top);
  const range = a.calcError ? '—' : a.minPct !== undefined ? `${Math.round(a.minPct)}–${Math.round(a.maxPct!)}%` : m?.category === 'Status' ? 'Status' : '—';
  const pp = shown?.pp !== undefined ? `PP ${shown.pp}${shown.maxPp ? `/${shown.maxPp}` : ''}` : '';
  const info = a.calcError ? a.reason : factsLine(a.facts) ?? a.reason;
  return (
    <div class={`tile${best ? ' best' : ''}${a.score === 0 || a.score === null ? ' off' : ''}`} style={type ? { '--tc': `var(--t-${type.toLowerCase()})` } : undefined} title={a.reason}>
      <span class={`rate ${best ? 'best' : r.tone === 'best' ? 'good' : r.tone}`}>{best ? '★ Best' : r.tone === 'best' ? 'Good' : r.label}</span>
      <b>{a.label}</b>
      <span class="d">{range}{pp && <span class="muted"> · {pp}</span>}</span>
      <span class="f">{info}</span>
    </div>
  );
}

/** Your Pokémon fainted: who to send in (it comes in without taking a hit). */
function ForcedSwitch({ ds, snap, advice }: { ds: Dataset; snap: BattleSnapshot; advice: TurnAdvice }) {
  const opts = advice.actions;
  const top = topScore(opts);
  const allUnknown = opts.length > 0 && opts.every((a) => a.unknownMoves);
  const safest = [...opts].sort((a, b) => (a.threat?.maxPct ?? 999) - (b.threat?.maxPct ?? 999))[0];
  const pick = top !== null ? opts[0] : safest;
  return (
    <>
      <div class="banner"><Icon name="x" /> <span><b>{snap.player?.name ?? 'Your Pokémon'}</b> fainted. The next one comes in free, without taking a hit.</span></div>
      <div class="tiles">
        {opts.map((a) => {
          const name = a.label.replace(/^(Switch to|Send in) /, '');
          const isPick = a === pick;
          const label = a.unknownMoves ? (isPick ? 'Safest' : 'Moves ?') : rate(a.score, top).label;
          return (
            <div class={`tile${isPick ? ' best' : ''}`} style={{ '--tc': `var(--t-${(speciesTypes(ds, name)[0] ?? 'normal').toLowerCase()})` }} title={a.reason}>
              <span class={`rate ${isPick ? 'best' : a.unknownMoves ? 'none' : rate(a.score, top).tone}`}>{isPick ? `★ ${label === 'Best' ? 'Best' : label}` : label}</span>
              <b>{name}</b>
              {a.threat && <span class="d">takes {Math.round(a.threat.minPct)}–{Math.round(a.threat.maxPct)}%{a.threat.ko === 'sure' ? ' · KO' : ''}</span>}
              <span class="f">{a.unknownMoves ? 'Moves unknown' : a.reason.replace(/^Their .+? to it( \((can )?KOs it\))?\. /, '')}</span>
            </div>
          );
        })}
      </div>
      {!opts.length && <Tip kind="warn">No healthy Pokémon left to send in.</Tip>}
      {!allUnknown && <HuntLink advice={advice} top={top} />}
      {allUnknown && (
        <p class="say">Their moves are unknown: <button class="link" onClick={() => (activeTab.value = 'settings')}>sync your box</button> to rate them. Until then, <b>{safest.label.replace(/^Send in /, '')}</b> takes the least damage.</p>
      )}
    </>
  );
}

function Guess({ ds, snap, advice }: { ds: Dataset; snap: BattleSnapshot; advice: TurnAdvice }) {
  if (!advice.prediction?.length) return null;
  return (
    <div class="guess">
      <span>They might use</span>
      {advice.prediction.slice(0, 3).map((g) => <b>{g.name} <i>{Math.round(g.prob * 100)}%</i>{g.ko === 'sure' ? <i> (KO)</i> : null}</b>)}
      {advice.npcSwitch && <span class="small" title={advice.npcSwitch.reason}>· may switch to <b>{advice.npcSwitch.to}</b></span>}
      {guessScore.value.total > 0 && <i class="small">· guessed right {guessScore.value.hit}/{guessScore.value.total}</i>}
      {advice.seenBefore && snap.opponent && (() => {
        const key = npcKey(matchNpc(ds, snap), snap);
        const opp = snap.opponent;
        return (
          <div class="small muted" style={{ width: '100%' }}>
            Seen in earlier battles:{' '}
            {advice.seenBefore.map((id, i) => {
              const others = seenByOthers(observed.value, key, opp.name, opp.level, id);
              const you = seenByYou(observed.value, key, opp.name, opp.level, id);
              return <>{i > 0 && ', '}{ds.moves[id]?.name ?? id}{others > 0 && (you ? ` (you + ${others} others)` : ` (seen by ${others} others)`)}</>;
            })}
          </div>
        );
      })()}
    </div>
  );
}

/** Everything behind "Details": notes, every option with its full reason (and score, for the curious). */
function DetailBody({ advice }: { ds: Dataset; snap: BattleSnapshot; advice: TurnAdvice }) {
  const top = topScore(advice.actions);
  return (
    <>
      {advice.notes.length > 0 && <div class="small muted">{advice.notes.map((n) => <div>• {n}</div>)}</div>}
      {advice.actions.length > 0 && (
        <div class="card">
          <p class="title">All options <span class="r">score 0–100 in brackets</span></p>
          {advice.actions.map((a) => <Action a={a} top={false} topScore={top} showScore />)}
        </div>
      )}
    </>
  );
}

/** One option as a row: rating in words, label, reason. Also used by Wild → Defeat it. */
export function Action({ a, top, topScore: ts, showScore }: { a: ActionAdvice; top: boolean; topScore?: number | null; showScore?: boolean }) {
  return (
    <div class={`act${top ? ' top' : ''}`}>
      <RatePill score={a.score} top={ts ?? (top ? a.score : undefined)} unknown={a.unknownMoves} calcError={a.calcError} />
      <div class="grow">
        <b>{a.label}</b>
        {a.minPct !== undefined && <span class="muted"> · {Math.round(a.minPct)}–{Math.round(a.maxPct!)}%</span>}
        {showScore && a.score !== null && <span class="muted small"> ({a.score})</span>}
        {a.calcError && <span class="chip warn sm" style={{ marginLeft: '4px' }} title="The damage calc failed for this row (details in the notes and the console). Please report it.">calc error</span>}
        {a.threat?.ko && <span class="chip sm" style={{ marginLeft: '4px' }}>{a.threat.ko === 'sure' ? 'They KO it' : 'They can KO it'}</span>}
        {a.threat && a.threat.ko !== 'sure' && (a.threat.critKo ?? 0) >= 0.01 && <span class="chip sm" style={{ marginLeft: '4px' }}>Crit risk {pct(a.threat.critKo!)}</span>}
        <div class="small muted">{a.reason}</div>
        {a.line && (top || a.tag === 'setup' || a.kind === 'switch') && <div class="small">▸ {a.line}</div>}
      </div>
    </div>
  );
}

const VERDICT = { ok: '✓', off: '✗', 'set-mismatch': '≠' } as const;

/** Battle Tower attempt: what is left and what your team still has (HP, status and PP carry over). */
function TowerRun({ advice }: { advice: TurnAdvice | null }) {
  const run = towerRun.value;
  const snap = battle.value;
  if (!run || !snap || advice?.npc?.category !== 'tower' || run.key !== advice.npc.id) return null;
  const s = runSummary(run, advice.variant);
  return (
    <div class="card">
      <p class="title">Tower run <span class="r">{s.beaten}/{s.total || '?'} beaten</span></p>
      <div class="small">
        Your team: {s.teamHpPct !== undefined ? <b>{s.teamHpPct}% HP left</b> : 'HP unknown'} · {s.alive} standing.
        {s.left.length > 0 && <> Still to come ({s.left.length}): {s.left.slice(0, 8).join(', ')}{s.left.length > 8 ? '…' : ''}.</>}
      </div>
      {s.lowPp.length > 0 && <div class="small bad-t">Low PP: {s.lowPp.slice(0, 4).join(' · ')}</div>}
      <div class="small muted">Nothing heals between opponents and Bag medicine is off: save PP and HP for the ones still to come. Order can change with switches.</div>
    </div>
  );
}

/** Real damage from the battle log vs the calc range for the same hit. */
function CalcCheck({ gen3 }: { gen3?: boolean }) {
  const checks = damageChecks.value;
  if (!checks.length) return null;
  const judged = checks.filter((c) => c.verdict !== 'set-mismatch');
  const ok = judged.filter((c) => c.verdict === 'ok').length;
  return (
    <div class="card">
      <p class="title">Calc check <span class="r">{judged.length ? `${ok}/${judged.length} hits in range` : 'sets differ'}</span></p>
      <div class="small">
        {checks.slice(-8).map((c) => (
          <div title={c.verdict === 'set-mismatch' ? 'Max HP on screen differs from the calc: IVs/EVs/level in the data differ, so this hit is not judged.' : undefined}>
            <b class={c.verdict === 'ok' ? 'ok-t' : c.verdict === 'off' ? 'bad-t' : 'muted'}>{VERDICT[c.verdict]}</b>{' '}
            {c.attacker} {c.move} → {c.target}: <b>{c.damage}</b>{c.crit && <span class="chip sm" style={{ marginLeft: '4px' }}>Crit</span>} <span class="muted">(calc {c.crit ? 'crit ' : ''}{c.lo}–{c.hi}{c.spread ? ', spread ×0.75' : ''}{c.capped ? ', KO: capped' : ''})</span>
          </div>
        ))}
      </div>
      <div class="small muted" style={{ marginTop: '4px' }}>Damage the game reported vs the {gen3 ? 'Gen III' : 'Gen 9'} calc. Only hits where both Pokémon's exact sets are known; crits are checked against the crit range, multi-hit and other unusual hits are skipped.</div>
    </div>
  );
}

/* ---------------- Doubles ---------------- */

function DoublesLive({ ds, snap }: { ds: Dataset; snap: BattleSnapshot }) {
  const advice = useMemo(
    () => (snap.status === 'active' ? adviseDoubles(ds, snap, box.value, { observed: observed.value, movesByMon: doublesMoves.value, gen3: forceGen3.value }) : null),
    [ds, snap, box.value, observed.value, doublesMoves.value, forceGen3.value],
  );
  const ended = snap.status === 'won' || snap.status === 'lost';
  const theirs = snap.actives?.opponent ?? [];
  return (
    <>
      <VsHead snap={snap} extra="Doubles" />
      <div class="two">
        {theirs.map((m) => <Plate ds={ds} mon={m} foe small />)}
      </div>
      {ended ? (
        <Tip kind={snap.status === 'won' ? 'ok' : 'danger'}>{snap.status === 'won' ? 'You won the battle!' : 'You lost this one.'}</Tip>
      ) : snap.status !== 'active' ? (
        <Tip kind="info">Battle state: {snap.status}. Advice shows while the battle is active.</Tip>
      ) : advice && <DoublesBody ds={ds} advice={advice} snap={snap} />}

      <Fold title="Details">
        {advice && advice.foes.length > 0 && (
          <div class="small">
            <b>Their likely moves (guess):</b>
            {advice.foes.map((f) => (
              <div>{f.mon.name}: {f.likely.map((g, i) => <>{i > 0 && ' · '}{g.name}{g.spread ? ' (hits both)' : g.target ? ` → ${g.target}` : ''} {Math.round(g.prob * 100)}%{g.ko === 'sure' ? ' (KO)' : ''}</>)}</div>
            ))}
            {guessScore.value.total > 0 && <div class="muted">Guessed right {guessScore.value.hit}/{guessScore.value.total} this battle</div>}
          </div>
        )}
        {advice && advice.order.length > 0 && <div class="small"><b>Speed order:</b> {advice.order.map((o) => `${o.name}${o.side === 'opponent' ? ' (them)' : ''}`).join(' → ')}</div>}
        {advice && advice.notes.length > 0 && <div class="small muted">{advice.notes.map((n) => <div>• {n}</div>)}</div>}
        <CalcCheck />
        {snap.log.length > 0 && <div class="card small"><p class="title">Battle log</p>{snap.log.slice(-8).map((l) => <div>{l}</div>)}</div>}
      </Fold>
      <div class="foot">Read from the battle screen {timeAgo(snap.at)}. Doubles look one turn ahead: damage on what's left, KO chance, spread moves at ×0.75 minus the hit on your ally. Advice only: you pick moves and targets.</div>
    </>
  );
}

function targetText(a: DoublesAction) {
  if (a.spread) return 'all adjacent';
  if (!a.target) return '';
  return `${a.target.side === 'opponent' ? '' : 'ally '}${a.target.name}`;
}

function DoublesBody({ ds, advice, snap }: { ds: Dataset; advice: DoublesAdvice; snap: BattleSnapshot }) {
  const planned = new Set(advice.plan?.picks ?? []);
  return (
    <>
      {advice.plan && advice.plan.picks.length > 0 && (
        <div class="card">
          <p class="title">This turn</p>
          {advice.plan.picks.map((a) => <div class="say"><b>{a.user}</b>: {a.label}{targetText(a) ? <span class="muted"> → {targetText(a)}</span> : ''}</div>)}
          {advice.plan.why.length > 0 && <div class="small muted" style={{ marginTop: '4px' }}>{advice.plan.why.join(' · ')}</div>}
        </div>
      )}
      {advice.mine.map((m) => <DoublesSlot ds={ds} m={m} planned={planned} />)}
      {/* Your Pokémon the advisor could not place (not in the data): still shown, so both slots are there. */}
      {(snap.actives?.player ?? []).filter((p) => !advice.mine.some((m) => m.mon.name === p.name) && (p.hp ?? 1) > 0).map((p) => (
        <section class="slot" aria-label={p.name}>
          <div class="sh"><span class="side">{p.position === 2 ? 'RIGHT' : p.position === 1 ? 'LEFT' : 'YOU'}</span><TypeAvatar name={p.name} types={speciesTypes(ds, p.name)} size={26} /><b>{p.name}</b><Hp pct={hpPct(p.hp, p.maxHp)} label={`${p.name} HP`} /></div>
          <div class="small muted">No advice for {p.name}: it is not in the synced wiki data, or its moves are unknown. Sync the data and your box.</div>
        </section>
      ))}
    </>
  );
}

function DoublesSlot({ ds, m, planned }: { ds: Dataset; m: DoublesMonAdvice; planned: Set<DoublesAction> }) {
  const scored = m.actions.filter((a) => a.score !== null);
  const top = topScore(scored);
  const pick = scored.find((a) => planned.has(a)) ?? scored[0];
  const rest = scored.filter((a) => a !== pick).slice(0, 3);
  const calcErrors = m.actions.filter((a) => a.score === null && /^Calc error/.test(a.reason));
  const threat: ThreatInfo | undefined = m.danger ? { name: m.danger.from.join(' + '), minPct: m.danger.minPct, maxPct: m.danger.maxPct, ko: m.danger.ko, youFirst: null } : undefined;
  const type = pick?.moveId ? ds.moves[pick.moveId]?.type : undefined;
  return (
    <section class="slot" aria-label={m.mon.name}>
      <div class="sh">
        <span class="side">{m.mon.position === 2 ? 'RIGHT' : m.mon.position === 1 ? 'LEFT' : 'YOU'}</span>
        <TypeAvatar name={m.mon.name} types={speciesTypes(ds, m.mon.name)} size={26} />
        <b>{m.mon.name}</b>
        <Hp pct={hpPct(m.mon.hp, m.mon.maxHp)} ghost={threat ? [threat.minPct, threat.maxPct] : undefined} label={`${m.mon.name} HP`} />
      </div>
      {m.danger && (
        <div class={`small ${m.danger.ko === 'sure' ? 'bad-t' : m.danger.ko ? 'warn-t' : 'muted'}`}>
          {m.danger.ko === 'sure' ? 'KO risk: both foes together KO it' : m.danger.ko ? 'Watch: both foes together can KO it' : 'Safe from both foes this turn'} ({Math.round(m.danger.minPct)}–{Math.round(m.danger.maxPct)}%, {m.danger.from.join(', ')}).
        </div>
      )}
      {pick ? (
        <div class="tile wide best" style={type ? { '--tc': `var(--t-${type.toLowerCase()})` } : undefined} title={pick.reason}>
          <span class="rate best">★ {planned.has(pick) ? 'This turn' : 'Best'}</span>
          <b>{pick.label}</b>
          <span class="d">{targetText(pick) ? `→ ${targetText(pick)}` : ''}{pick.hits?.some((h) => h.ko === 'sure' && h.side === 'opponent') ? ' · KO' : ''}</span>
          <span class="f">{pick.reason}{pick.combo ? ` ${pick.combo}.` : ''}</span>
          {(pick.allyHit || pick.allyUnknown) && !/hits your/.test(pick.reason) && <span class="f bad-t">Also hits your {pick.allyHit?.name ?? pick.allyUnknown}.</span>}
        </div>
      ) : <div class="small muted">Moves not known yet: open {m.mon.name}'s command (or its Switch card) in the game once, or sync your box.</div>}
      {rest.length > 0 && (
        <div class="alts">
          {rest.map((a) => (
            <div title={a.reason}>
              <RatePill score={a.score} top={top} />
              <b>{a.label}</b>
              <span class="grow">{targetText(a) ? `→ ${targetText(a)}` : ''}{(a.allyHit || a.allyUnknown) ? ' · hits ally' : ''}</span>
            </div>
          ))}
        </div>
      )}
      {calcErrors.map((a) => (
        <div class="alts"><div title={a.reason}><span class="pill calc">Calc error</span><b>{a.label}</b><span class="grow">{targetText(a) ? `→ ${targetText(a)}` : ''} not scored</span></div></div>
      ))}
      {m.movesFrom === 'box' && <div class="note">Moves from your box (not seen on the battle screen yet).</div>}
    </section>
  );
}

