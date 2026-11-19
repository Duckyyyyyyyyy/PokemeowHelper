import { useState } from 'preact/hooks';
import { autoSyncEnabled, boxMeta, boxSync, runBoxSync, setAutoSync, timeAgo } from '../boxStore';
import { isExtension } from '../store';
import { Tip } from './common';

/** Compact "Sync box from game" card (used in the Team tab and in Settings). */
export function BoxSyncCard({ compact = false }: { compact?: boolean }) {
  const s = boxSync.value;
  const meta = boxMeta.value;
  const [auto, setAuto] = useState(autoSyncEnabled());

  return (
    <>
      <div class="card">
        <p class="title">
          Your box from the game
          <span class="r">{meta ? `${meta.count} Pokémon · ${timeAgo(meta.syncedAt)}` : 'Not synced yet'}</span>
        </p>
        <div class="btns">
          <button class="btn primary" disabled={s.busy || !isExtension} onClick={runBoxSync}>
            {s.busy ? 'Syncing…' : meta ? 'Sync box again' : 'Sync box from game'}
          </button>
        </div>
        {s.busy && <div class="small muted" style={{ marginTop: '6px' }} role="status">{s.step}</div>}
        {!compact && (
          <label class="small muted row" style={{ marginTop: '8px' }}>
            <input
              type="checkbox"
              checked={auto}
              onChange={(e) => {
                setAuto(e.currentTarget.checked);
                setAutoSync(e.currentTarget.checked);
              }}
            />
            Refresh automatically when I open MeowRPGAdvisor (at most every 5 min)
          </label>
        )}
        {!isExtension && <div class="small muted" style={{ marginTop: '6px' }}>Box sync only works inside the Chrome extension.</div>}
      </div>
      {s.error && <Tip kind="danger">{s.error}</Tip>}
      {s.done && !compact && <Tip kind="ok">{s.done}</Tip>}
      {!compact && (
        <Tip kind="info">
          Reads your own Pokémon (level, moves, nature, IVs/EVs, item) the same way the game's team picker does: a few read-only
          requests, about 1 second apart, only when you sync. It never changes anything in your game. Pokémon you typed in by hand are kept.
        </Tip>
      )}
    </>
  );
}
