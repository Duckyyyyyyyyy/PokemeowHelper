import { useMemo, useState } from 'preact/hooks';
import type { BoxMon, Dataset, NpcTeamVariant } from '../../shared/types';
import { speedLadder } from '../../engine/evRoles';
import { activeTab } from '../store';
import { trainFocus } from '../evRoleStore';

/**
 * Prep → Team: your team and the NPC's by Speed at the fight's level, with dashed "ghost" rungs where a
 * few more Spe EVs would pass the next faster foe. Tap a ghost to open that Pokémon's Build card.
 */
export function SpeedLadder({ ds, team, v }: { ds: Dataset; team: BoxMon[]; v: NpcTeamVariant }) {
  const [open, setOpen] = useState(false);
  const rungs = useMemo(() => (open ? speedLadder(ds, team, v) : []), [ds, team, v, open]);
  return (
    <div class="card">
      <p class="title">Speed order <span class="r">at the fight's level</span></p>
      {!open ? (
        <button class="link small" onClick={() => setOpen(true)} aria-expanded={false}>Show who moves first →</button>
      ) : (
        <>
          <div class="ladder">
            {rungs.map((r, i) => {
              const tie = rungs.some((o, j) => j !== i && o.spe === r.spe && o.side !== r.side && o.side !== 'ghost' && r.side !== 'ghost');
              const body = <><span>{r.name}</span>{tie ? <span class="pill ok">tie</span> : null}</>;
              return (
                <div class={`rung ${r.side}`}>
                  <span class="sp num">{r.spe}</span>
                  {r.side === 'ghost' ? (
                    <button class="lane" onClick={() => { trainFocus.value = r.uid!; activeTab.value = 'train'; window.scrollTo(0, 0); }} title="Open its Build card in Train">{body}</button>
                  ) : <div class="lane">{body}</div>}
                </div>
              );
            })}
          </div>
          <div class="small muted" style={{ marginTop: '4px' }}>
            Blue = yours, red = theirs (wiki sets), dashed = with a few more Spe EVs (tap to plan it). Not counted: Choice Scarf, paralysis, stat stages, Trick Room, priority moves. A tie is a coin flip.
          </div>
        </>
      )}
    </div>
  );
}
