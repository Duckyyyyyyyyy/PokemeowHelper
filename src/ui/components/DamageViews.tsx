import { useMemo } from 'preact/hooks';
import type { BoxMon, Dataset, NpcTeamVariant } from '../../shared/types';
import type { Duel } from '../../engine/damage';
import { suggestMoveset, type MovesetSuggestion } from '../../engine/moveset';
import { ownedTms } from '../bagStore';
import { TypeBadge } from './common';
import type { BattleRules } from '../../engine/rules';

const pct = (a: number, b: number) => `${Math.round(a)}–${Math.round(b)}%`;

export function duelSummary(d: Duel): string {
  const you = d.mine ? `${d.mine.name} ${pct(d.mine.minPct, d.mine.maxPct)}` : 'no damage';
  const them = d.theirs ? `${d.theirs.name} ${pct(d.theirs.minPct, d.theirs.maxPct)}` : 'no damage';
  return `you ${you} · they ${them} · ${d.win ? `you win (~${Math.round(d.hpLeftPct)}% HP left)` : 'you lose'}`;
}

/** Details for one matrix cell: your best move vs theirs, speed and result. */
export function DuelDetail({ ds, you, foeName, d }: { ds: Dataset; you: BoxMon; foeName: string; d: Duel }) {
  const yourName = ds.species[you.species]?.name ?? '?';
  const order = d.youFirst === null ? 'Speed tie (counted as them first)' : d.youFirst ? `${yourName} moves first` : `${foeName} moves first`;
  return (
    <div class={`tip ${d.win ? 'ok' : 'danger'}`} style={{ marginTop: '8px' }} role="status">
      <span class="ic">{d.win ? '✓' : '!'}</span>
      <div>
        <b>{yourName} vs {foeName}</b>
        <div>
          You: {d.mine ? <><TypeBadge type={d.mine.type} /> {d.mine.name} {pct(d.mine.minPct, d.mine.maxPct)}{d.mine.koText ? ` · ${d.mine.koText}` : ''}</> : 'no damaging move'}
        </div>
        <div>
          They: {d.theirs ? <><TypeBadge type={d.theirs.type} /> {d.theirs.name} {pct(d.theirs.minPct, d.theirs.maxPct)}{d.theirs.koText ? ` · ${d.theirs.koText}` : ''}</> : 'no damaging move'}
        </div>
        <div class="small">
          {order} · {d.win ? `You win with ~${Math.round(d.hpLeftPct)}% HP left` : `You lose; they keep ~${Math.round(d.hpLeftPct)}% HP`}
        </div>
      </div>
    </div>
  );
}

const SOURCE_LABEL = { known: 'Known', level: 'Lv', tm: 'TM', egg: 'Egg' } as const;

/** Without a level cap (rematches), level-up moves are considered up to this level. */
const NO_CAP_LEVEL = 100;

/**
 * Best 4 damaging moves for this fight, in steps: what it can use at its level now (known +
 * level-up moves), what it gets by training to the level cap, and what TMs would add.
 * A later step is only shown when it is clearly better.
 */
export function MovesetPanel({ ds, mon, v, rules }: { ds: Dataset; mon: BoxMon; v: NpcTeamVariant; rules?: BattleRules }) {
  const cap = v.levelCap ?? NO_CAP_LEVEL;
  const tms = ownedTms.value;
  const steps = useMemo(() => {
    // How moves are learned (wiki, Learning and Changing Moves): crossing a level while you own it
    // gives a one-use chance; earlier level-up moves need an unspent chance or a re-learn cost.
    const now = suggestMoveset(ds, mon, v, { levelCap: v.levelCap, rules, allowTM: false, passedLevelUps: false });
    const passed = suggestMoveset(ds, mon, v, { levelCap: v.levelCap, rules, allowTM: false });
    const atCap = suggestMoveset(ds, mon, v, { levelCap: v.levelCap, rules, allowTM: false, untilLevel: cap });
    const withTm = suggestMoveset(ds, mon, v, { levelCap: v.levelCap, rules, untilLevel: cap, ownedTms: tms });
    const out: { title: string; note: string; s: MovesetSuggestion }[] = [
      { title: 'Ready now', note: 'Moves it knows.', s: now },
    ];
    if (passed.coverage >= now.coverage + 3)
      out.push({ title: 'Re-learn', note: `Level-up moves it already passed (up to Lv ${mon.level ?? '?'}): free if it still has an unspent chance (it leveled up with 4 moves already), otherwise re-learn for a cost such as a Heart Scale. Check My Pokémon → Moves.`, s: passed });
    const before = out[out.length - 1].s;
    if ((mon.level ?? 0) < cap && atCap.coverage >= before.coverage + 3)
      out.push({ title: v.levelCap ? `By Lv ${cap} (level cap)` : 'By leveling up', note: `Free: level-up moves it learns as it levels to ${cap}. If it evolves first, its list may change.`, s: atCap });
    const prev = out[out.length - 1].s;
    if (withTm.coverage >= prev.coverage + 3 && withTm.moves.some((m) => m.source === 'tm'))
      out.push(
        tms
          ? { title: 'With TMs in your bag', note: 'Only TMs you own (as of the last time you opened the Bag page).', s: withTm }
          : { title: 'With TMs', note: "Any TM. Open your Bag page in the game once and MeowRPGAdvisor will only suggest TMs you own.", s: withTm },
      );
    return out;
  }, [ds, mon, v, rules, cap, tms]);
  if (!steps[0].s.moves.length && steps.length === 1) return <div class="small muted">No damaging moves available.</div>;
  const same = steps.length === 1 && steps[0].s.moves.every((m) => m.source === 'known');
  return (
    <div class="card" style={{ marginTop: '6px', boxShadow: 'none', background: 'var(--surface-2)' }}>
      <p class="title" style={{ marginBottom: '4px' }}>
        Move advice <span class="r">current moves {steps[0].s.currentCoverage}</span>
      </p>
      {steps.map((st) => (
        <div style={{ marginTop: '4px' }}>
          <div class="small" style={{ fontWeight: 800 }}>
            {st.title} <span class="muted">· score {st.s.coverage}</span>
          </div>
          {st.s.moves.map((m) => (
            <div class="row small" style={{ padding: '2px 0' }}>
              <TypeBadge type={m.type} />
              <b>{m.name}</b>
              <span class={`chip${m.source === 'known' ? '' : ' on'}`} style={{ padding: '0 7px' }}>
                {m.source === 'level' ? (m.later ? `learns Lv ${m.level}` : `Lv ${m.level}`) : SOURCE_LABEL[m.source]}
              </span>
              <span class="muted grow" style={{ textAlign: 'right' }}>{m.bestAgainst.length ? `best vs ${m.bestAgainst.slice(0, 2).join(', ')}${m.bestAgainst.length > 2 ? '…' : ''}` : ''}</span>
            </div>
          ))}
          <div class="small muted">{st.note}</div>
        </div>
      ))}
      <div class="small muted" style={{ marginTop: '4px' }}>
        {same ? 'Your current moves are already the best choice here.' : 'Score = average best damage % vs their team, at its current level.'}
      </div>
    </div>
  );
}
