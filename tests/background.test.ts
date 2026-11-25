import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Runs the real background worker against a fake `chrome` where tab 2 was closed before the call reached it
// ("No tab with id: 171610570.", seen live 2026-11-26).
type Fn = (...a: any[]) => any;
let on: Record<string, Fn>;
let panel: { tabId?: number; enabled?: boolean }[];
let mode: string;
let failure: (tabId?: number) => Error | undefined;
let error: ReturnType<typeof vi.spyOn>;
const settle = () => new Promise((r) => setTimeout(r, 20));
const gone = (tabId?: number) => (tabId === 2 ? new Error(`No tab with id: ${tabId}.`) : undefined);

beforeEach(async () => {
  on = {};
  panel = [];
  mode = 'panel';
  failure = gone;
  const ev = (name: string) => ({ addListener: (f: Fn) => { on[name] = f; } });
  const tab = (id: number) => ({ id, url: 'https://pokemeowrpg.com/battle' });
  vi.stubGlobal('chrome', {
    runtime: { onInstalled: ev('installed'), onStartup: ev('startup'), getURL: (p: string) => `chrome-extension://x/${p}` },
    storage: { local: { get: async (k: string) => ({ [k]: mode }), set: async () => {} }, onChanged: ev('changed') },
    action: { onClicked: ev('clicked') },
    tabs: {
      query: async () => [tab(1), tab(2), tab(3)],
      get: async (id: number) => { const e = failure(id); if (e) throw e; return tab(id); },
      onUpdated: ev('updated'), onActivated: ev('activated'),
    },
    windows: { onBoundsChanged: ev('bounds') },
    sidePanel: {
      setOptions: async (o: { tabId?: number; enabled?: boolean }) => { const e = failure(o.tabId); if (e) throw e; panel.push({ tabId: o.tabId, enabled: o.enabled }); },
      setPanelBehavior: async () => {},
    },
  });
  error = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.resetModules();
  await import('../src/background/index');
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('background: a tab that closed in the meantime is not an error', () => {
  it('a tab that finished loading, then closed', async () => {
    on.updated(2, { status: 'complete' }, { url: 'https://pokemeowrpg.com/' });
    await settle();
    expect(error).not.toHaveBeenCalled();
  });
  it('a tab that was activated, then closed', async () => {
    on.activated({ tabId: 2 });
    await settle();
    expect(error).not.toHaveBeenCalled();
  });
  it.each(['panel', 'window'])('switching to %s mode: the other tabs are still set', async (m) => {
    mode = m;
    on.changed({ mdUiMode: {} }, 'local');
    await settle();
    expect(error).not.toHaveBeenCalled();
    expect(panel.filter((p) => p.tabId)).toEqual([1, 3].map((tabId) => ({ tabId, enabled: m === 'panel' })));
  });
  it('an open tab still gets the panel', async () => {
    on.activated({ tabId: 1 });
    on.updated(3, { status: 'complete' }, { url: 'https://example.com/' });
    await settle();
    expect(panel).toEqual(expect.arrayContaining([{ tabId: 1, enabled: true }, { tabId: 3, enabled: false }]));
  });
  it('any other error is still logged', async () => {
    failure = () => new Error('Tabs cannot be edited right now');
    on.activated({ tabId: 1 });
    on.updated(1, { status: 'complete' }, { url: 'https://pokemeowrpg.com/' });
    await settle();
    expect(error).toHaveBeenCalledTimes(2);
  });
});
