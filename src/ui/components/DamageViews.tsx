import { useMemo } from 'preact/hooks';
import type { BoxMon, Dataset, NpcTeamVariant } from '../../shared/types';
import type { Duel } from '../../engine/damage';
import { suggestMoveset } from '../../engine/moveset';
import { TypeBadge } from './common';

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

/** Best 4 damaging moves for this fight, from what the Pokémon knows or can learn. */
export function MovesetPanel({ ds, mon, v }: { ds: Dataset; mon: BoxMon; v: NpcTeamVariant }) {
  const s = useMemo(() => suggestMoveset(ds, mon, v, { levelCap: v.levelCap }), [ds, mon, v]);
  if (!s.moves.length) return <div class="small muted">No damaging moves available.</div>;
  const same = s.moves.every((m) => m.source === 'known');
  return (
    <div class="card" style={{ marginTop: '6px', boxShadow: 'none', background: 'var(--surface-2)' }}>
      <p class="title" style={{ marginBottom: '4px' }}>
        Move advice <span class="r">{s.currentCoverage} → {s.coverage}</span>
      </p>
      {s.moves.map((m) => (
        <div class="row small" style={{ padding: '2px 0' }}>
          <TypeBadge type={m.type} />
          <b>{m.name}</b>
          <span class={`chip${m.source === 'known' ? '' : ' on'}`} style={{ padding: '0 7px' }}>
            {m.source === 'level' ? `Lv ${m.level}` : SOURCE_LABEL[m.source]}
          </span>
          <span class="muted grow" style={{ textAlign: 'right' }}>{m.bestAgainst.length ? `best vs ${m.bestAgainst.slice(0, 2).join(', ')}${m.bestAgainst.length > 2 ? '…' : ''}` : ''}</span>
        </div>
      ))}
      <div class="small muted" style={{ marginTop: '4px' }}>
        {same ? 'Your current moves are already the best choice here.' : 'Score = average best damage % vs their team (current → suggested). TM moves need the TM item.'}
      </div>
    </div>
  );
}
