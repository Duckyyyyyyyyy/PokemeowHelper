import { autoTab, setAutoTab } from '../autoTab';
import { useState } from 'preact/hooks';
import { box, dataset, isExtension, loadDevFixture, resetDataset, runSync, setBox, sync } from '../store';
import { Tip } from '../components/common';
import { BoxSyncCard } from '../components/BoxSync';
import type { BoxMon } from '../../shared/types';
import { clearObserved, importLedger, observed, setObserved } from '../battleStore';
import { MAX_IMPORT_BYTES, addImport, applyImports, buildExport, contentHash, importedCount, newSourceId, parseImport } from '../../engine/share';
import { bag, forgetBag, loadSampleBag } from '../bagStore';
import { UiModeCard } from '../components/UiModeCard';

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
    a.download = 'meowrpgadvisor-box.json';
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

  const [shareMsg, setShareMsg] = useState('');
  const [onlyData, setOnlyData] = useState(true);
  const ownCount = Object.values(observed.value).filter((m) => m.moves.length).length;

  async function ownSourceId(create: boolean): Promise<string | undefined> {
    if (!isExtension || !chrome.storage?.local) return create ? newSourceId() : undefined;
    const r = await chrome.storage.local.get('mdShareId');
    let id = r.mdShareId as string | undefined;
    if (!id && create) {
      id = newSourceId();
      await chrome.storage.local.set({ mdShareId: id });
    }
    return id;
  }

  async function exportNpc() {
    if (!ds) return;
    const file = buildExport(ds, observed.value, { sourceId: (await ownSourceId(true))!, appVersion: APP_VERSION }, onlyData);
    const n = Object.keys(file.npcs).length;
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `meowrpgadvisor-npc-data-${file.exportedAt.slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    setShareMsg(`Exported ${n} NPC${n === 1 ? '' : 's'}.`);
  }

  async function importNpc(file: File) {
    try {
      if (!ds) throw new Error('Sync the wiki data first.');
      if (file.size > MAX_IMPORT_BYTES) throw new Error('File is too large (max 2 MB).');
      const parsed = parseImport(await file.text(), ds);
      const res = addImport(importLedger.value, parsed, await contentHash(parsed.mons), await ownSourceId(false));
      if (!res.ok) throw new Error(res.reason);
      setObserved(applyImports(observed.value, res.ledger), res.ledger);
      setShareMsg(`${res.replaced ? 'Updated' : 'Imported'} ${parsed.accepted} Pokémon${parsed.skipped ? ` (${parsed.skipped} entries skipped)` : ''}.`);
    } catch (e) {
      setShareMsg(e instanceof Error ? e.message : 'Invalid file.');
    }
  }

  function removeImported() {
    if (!confirm('Remove all imported NPC data? Your own observations stay.')) return;
    setObserved(applyImports(observed.value, {}), {});
    setShareMsg('Imported data removed.');
  }

  const nImports = Object.keys(importLedger.value).length;

  return (
    <>
      <div class="card">
        <p class="title">While you play</p>
        <label class="row" style={{ alignItems: 'flex-start' }}>
          <input type="checkbox" checked={autoTab.value} onChange={(e) => setAutoTab((e.target as HTMLInputElement).checked)} style={{ marginTop: '4px' }} />
          <span><b>Switch tabs by itself</b><div class="small muted">Opens Battle when a battle starts and Wild when a wild Pokémon appears. A tab you pick yourself stays until the next one starts.</div></span>
        </label>
      </div>
      <UiModeCard />
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
        <p class="title">Share NPC data<span class="r">{ownCount} yours · {importedCount(observed.value)} from others</span></p>
        <div class="small muted">
          Export what MeowRPGAdvisor saw NPCs do into a file you send yourself (Discord, Drive…). The file has only NPC ids, Pokémon names and move ids: no name, box, team or bag. Nothing is uploaded.
        </div>
        <label class="small" style={{ display: 'block', marginTop: '6px' }}>
          <input type="checkbox" checked={onlyData} onChange={(e) => setOnlyData(e.currentTarget.checked)} /> Only NPCs I have data for
        </label>
        <div class="btns" style={{ marginTop: '6px' }}>
          <button class="btn" disabled={!ds || (onlyData && !ownCount)} onClick={exportNpc}>Export file</button>
          <label class="btn" style={{ textAlign: 'center' }}>
            Import file
            <input type="file" accept="application/json" hidden onChange={(e) => { const f = e.currentTarget.files?.[0]; e.currentTarget.value = ''; if (f) importNpc(f); }} />
          </label>
          <button class="btn" disabled={!nImports} onClick={removeImported}>Remove imported data{nImports ? ` (${nImports})` : ''}</button>
        </div>
        {shareMsg && <div class="small muted" style={{ marginTop: '6px' }} role="status">{shareMsg}</div>}
      </div>

      <div class="card">
        <p class="title">Your bag<span class="r">{bag.value ? `${bag.value.items.length} kinds` : 'not read yet'}</span></p>
        <div class="small muted">
          {bag.value
            ? `Read from the game's Bag page ${new Date(bag.value.at).toLocaleString()}. Open the Bag page again after buying or using items.`
            : "Open the Bag page in the game once: MeowRPGAdvisor reads it from the screen (no extra requests) to suggest TMs and held items you own."}
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
      <div class="foot">MeowRPGAdvisor {APP_VERSION} · fan-made tool, not affiliated with PokeMeowRPG. Advice only – you play.</div>
    </>
  );
}
