import { useEffect, useState } from 'preact/hooks';

export const SIMULATOR_URL = 'https://pokemeowrpg.com/wiki/#/challenges/battle-simulator';

/**
 * Copy your side / the opponent's side as Showdown text for the wiki's Battle Simulator.
 * Nothing is sent anywhere: the user opens the simulator and pastes.
 */
export function SimExport({ mine, foe, mineLabel = 'Copy my side', foeLabel = 'Copy opponent' }: { mine: string; foe: string; mineLabel?: string; foeLabel?: string }) {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => setMsg(null), [mine, foe]); // the copied text belongs to the old sets
  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      setMsg(`${what} copied.`);
    } catch {
      setMsg(text); // clipboard unavailable: shown in a box to copy by hand
    }
  }
  return (
    <div class="card">
      <div class="title" style={{ margin: 0 }}>Battle Simulator</div>
      <div class="small muted">Paste into the simulator's Text import (each side separately).</div>
      <div class="btns" style={{ marginTop: '6px' }}>
        <button class="btn sm" disabled={!mine} onClick={() => copy(mine, 'Your side')}>{mineLabel}</button>
        <button class="btn sm" disabled={!foe} onClick={() => copy(foe, 'Opponent')} title={foe ? undefined : 'The opponent’s set is not known yet'}>{foeLabel}</button>
        <a class="btn sm" href={SIMULATOR_URL} target="_blank" rel="noreferrer">Open Battle Simulator</a>
      </div>
      {msg && (msg.endsWith(' copied.') ? (
        <div class="small muted" role="status" style={{ marginTop: '4px' }}>{msg}</div>
      ) : <textarea class="input" style={{ width: '100%', height: '120px', marginTop: '6px' }} readOnly value={msg} aria-label="Showdown text to copy" />)}
    </div>
  );
}
