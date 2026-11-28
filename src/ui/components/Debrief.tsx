import { useMemo } from 'preact/hooks';
import type { BattleSnapshot } from '../../shared/battle';
import type { Dataset } from '../../shared/types';
import { debrief } from '../../engine/debrief';
import { activeTab, box } from '../store';
import { trainFocus } from '../evRoleStore';

/** After a battle: knockouts, and where your Pokémon was hit first and knocked out, with the Spe EVs that would have moved first. */
export function Debrief({ ds, snap, title }: { ds: Dataset; snap: BattleSnapshot; title?: string }) {
  const d = useMemo(() => debrief(ds, snap, box.value), [ds, snap, box.value]);
  const result = d.result === 'won' ? 'Won' : d.result === 'lost' ? 'Lost' : d.result;
  const open = (uid: string) => { trainFocus.value = uid; activeTab.value = 'train'; window.scrollTo(0, 0); };
  return (
    <div class="card">
      <p class="title">{title ?? 'Debrief'} <span class="r">{result}{d.opponent ? ` vs ${d.opponent}` : ''}{d.turns ? ` · ${d.turns} turns` : ''}</span></p>
      {d.outsped.map((o) => (
        <div class="small" style={{ padding: '3px 0' }}>
          <b style={{ color: 'var(--bad)' }}>T{o.turn}: {o.foe} hit first</b> and knocked out {o.mine} with {o.move}.{' '}
          {o.mySpe !== undefined && o.foeSpe !== undefined ? (
            o.needEvs === undefined ? (
              <span class="muted">{o.mine} ({o.mySpe}) is faster than {o.foe}'s estimate ({o.foeSpe}): it may have trained Speed or held a Choice Scarf, or {o.mine} couldn't move.</span>
            ) : o.needEvs === null ? (
              <span>Even 252 Spe EVs wouldn't pass {o.foe} (about {o.foeSpe}); bulk or a faster Pokémon is the fix.</span>
            ) : (
              <span>About <b>+{o.needEvs} Spe EVs</b> would have moved first ({o.mySpe} vs about {o.foeSpe}). </span>
            )
          ) : <span class="muted">Not found in your box, so no Speed check.</span>}
          {o.uid && <button class="link small" onClick={() => open(o.uid!)}>Plan its EVs →</button>}
        </div>
      ))}
      {!d.outsped.length && <div class="small muted">No knockout before your Pokémon could move.</div>}
      {d.kos.length > 0 && (
        <div class="tl small" style={{ marginTop: '6px' }}>
          {d.kos.map((k) => (
            <div><span class="muted">T{k.turn ?? '?'}</span> {k.by} <span class="muted">({k.side === 'player' ? 'you' : 'them'})</span> KO'd {k.target} with {k.move}</div>
          ))}
        </div>
      )}
      <div class="small muted" style={{ marginTop: '4px' }}>
        Guesses: "hit first" means it was out the turn before, hadn't moved this turn and the hit had no priority (sleep, paralysis or a flinch look the same). Foe Speed is estimated with 31 IVs, no EVs, neutral nature. Not checked in a real battle.
      </div>
    </div>
  );
}
