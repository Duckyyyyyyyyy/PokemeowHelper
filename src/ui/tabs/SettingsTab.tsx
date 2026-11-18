import { useState } from 'preact/hooks';
import { box, dataset, isExtension, loadDevFixture, resetDataset, runSync, setBox, sync } from '../store';
import { Tip } from '../components/common';
import { BoxSyncCard } from '../components/BoxSync';
import type { BoxMon } from '../../shared/types';
import { clearObserved, observed } from '../battleStore';
import { bag, forgetBag, loadSampleBag } from '../bagStore';

type Theme = 'auto' | 'light' | 'dark';

const APP_VERSION = isExtension ? chrome.runtime.getManifest().version : 'dev';

export function applyTheme(t: Theme) {
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}
export function savedTheme(): Theme {
  try {
    return (localStorage.getItem('md-theme') as Theme) || 'auto';
  } catch {
    return 'auto';
  }
}

export function SettingsTab() {
  const ds = dataset.value;
  const s = sync.value;
  const [theme, setTheme] = useState<Theme>(savedTheme());
  const [msg, setMsg] = useState('');

  function chooseTheme(t: Theme) {
    setTheme(t);
    applyTheme(t);
    try {
      localStorage.setItem('md-theme', t);
    } catch {
      /* ignore */
    }
  }

  function exportBox() {
    const blob = new Blob([JSON.stringify({ meowdex: 1, box: box.value }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'meowhelper-box.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function importBox(file: File) {
    try {
      const data = JSON.parse(await file.text());
      const list: BoxMon[] = (data.box ?? data).filter((b: any) => typeof b?.species === 'number');
      await setBox(list.map((b) => ({ ...b, uid: b.uid ?? crypto.randomUUID(), moves: Array.isArray(b.moves) ? b.moves.slice(0, 4) : [] })));
      setMsg(`Imported ${list.length} Pokémon.`);
    } catch {
      setMsg('Invalid file.');
    }
  }

  return (
    <>
      <div class="card">
        <p class="title">Wiki data</p>
        {ds ? (
          <div class="kv">
            <span>NPC</span><b>{ds.npcs.length}</b>
            <span>Pokémon</span><b>{Object.keys(ds.species).length}</b>
            <span>Moves</span><b>{Object.keys(ds.moves).length}</b>
            <span>Updated</span><b>{new Date(ds.syncedAt).toLocaleString('en-US')}</b>
            <span>Version</span><span class="small" style={{ wordBreak: 'break-all' }}>{ds.version}</span>
          </div>
        ) : (
          <div class="small muted">Not synced yet.</div>
        )}
        <div class="btns" style={{ marginTop: '10px' }}>
          <button class="btn primary" disabled={s.busy} onClick={runSync}>{s.busy ? 'Syncing…' : 'Sync data'}</button>
          {ds && <button class="btn" disabled={s.busy} onClick={resetDataset}>Clear</button>}
        </div>
        {s.busy && <div class="small muted" style={{ marginTop: '6px' }} role="status">{s.step}</div>}
      </div>
      {s.error && <Tip kind="danger">{s.error}</Tip>}
      {s.done && <Tip kind="ok">{s.done}</Tip>}
      {!isExtension && import.meta.env.DEV && (
        <Tip kind="warn">
          Preview mode (outside the Chrome extension): real sync is blocked.{' '}
          <button class="link" onClick={loadDevFixture}>Load sample data</button>
        </Tip>
      )}
      <Tip kind="info">
        Sync only runs when you press the button: it reads the wiki page (login needed) and the wiki's static data file. It never calls the game's API or runs game code. Trainer images in the NPC list also load from pokemeowrpg.com (static images).
      </Tip>

      <BoxSyncCard />

      <div class="card">
        <p class="title">Your box</p>
        <div class="btns">
          <button class="btn" onClick={exportBox} disabled={!box.value.length}>Export JSON</button>
          <label class="btn" style={{ textAlign: 'center' }}>
            Import JSON
            <input type="file" accept="application/json" hidden onChange={(e) => e.currentTarget.files?.[0] && importBox(e.currentTarget.files[0])} />
          </label>
        </div>
        {msg && <div class="small muted" style={{ marginTop: '6px' }}>{msg}</div>}
      </div>

      <div class="card">
        <p class="title">Seen in battle<span class="r">{Object.keys(observed.value).length} Pokémon</span></p>
        <div class="small muted">Moves NPC Pokémon actually used in your battles, remembered across battles and shown in the NPC and Battle tabs. Stored on this computer only; a wiki sync does not touch it.</div>
        <div class="btns" style={{ marginTop: '6px' }}>
          <button class="btn" disabled={!Object.keys(observed.value).length} onClick={() => confirm('Forget all moves seen in battle?') && clearObserved()}>Forget</button>
        </div>
      </div>

      <div class="card">
        <p class="title">Your bag<span class="r">{bag.value ? `${bag.value.items.length} kinds` : 'not read yet'}</span></p>
        <div class="small muted">
          {bag.value
            ? `Read from the game's Bag page ${new Date(bag.value.at).toLocaleString()}. Open the Bag page again after buying or using items.`
            : "Open the Bag page in the game once: MeowHelper reads it from the screen (no extra requests) to suggest TMs and held items you own."}
        </div>
        <div class="btns" style={{ marginTop: '6px' }}>
          <button class="btn" disabled={!bag.value} onClick={() => confirm('Forget your bag? It is read again next time you open the Bag page.') && forgetBag()}>Forget</button>
          {import.meta.env.DEV && <button class="link" onClick={loadSampleBag}>Load sample bag</button>}
        </div>
      </div>

      <div class="card">
        <p class="title">Appearance</p>
        <div class="seg">
          {(['auto', 'light', 'dark'] as Theme[]).map((t) => (
            <button class={theme === t ? 'on' : ''} onClick={() => chooseTheme(t)}>{t === 'auto' ? 'System' : t === 'light' ? 'Light' : 'Dark'}</button>
          ))}
        </div>
      </div>
      <div class="foot">MeowHelper {APP_VERSION} · fan-made tool, not affiliated with PokeMeowRPG. Advice only – you play.</div>
    </>
  );
}
