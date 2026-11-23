/** Where the helper UI lives. Pure helpers, shared by the background worker, the settings card and the tests. */
export type UiMode = 'window' | 'panel';

export const MODE_KEY = 'mdUiMode';
export const WINDOW_BOUNDS_KEY = 'mdWindowBounds';
export const DEFAULT_MODE: UiMode = 'window';

export interface WindowBounds {
  width: number;
  height: number;
  left?: number;
  top?: number;
}

export const DEFAULT_BOUNDS: WindowBounds = { width: 440, height: 760 };
const MIN_W = 320;
const MIN_H = 400;
const MAX = 4000;

export function normalizeMode(v: unknown): UiMode {
  return v === 'panel' || v === 'window' ? v : DEFAULT_MODE;
}

/** True for pages of the game itself (https://pokemeowrpg.com and any path under it). */
export function isGameUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname === 'pokemeowrpg.com';
  } catch {
    return false;
  }
}

/** Validate saved bounds read from storage; fall back to defaults for anything unusable. */
export function sanitizeBounds(v: unknown): WindowBounds {
  const o = (v ?? {}) as Record<string, unknown>;
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x) : undefined);
  const w = num(o.width);
  const h = num(o.height);
  if (w === undefined || h === undefined) return { ...DEFAULT_BOUNDS };
  const out: WindowBounds = { width: Math.min(MAX, Math.max(MIN_W, w)), height: Math.min(MAX, Math.max(MIN_H, h)) };
  const l = num(o.left);
  const t = num(o.top);
  // Ignore far-off-screen positions (e.g. a monitor that was unplugged).
  if (l !== undefined && t !== undefined && l > -MAX && l < MAX && t > -200 && t < MAX) {
    out.left = l;
    out.top = t;
  }
  return out;
}

/**
 * Runs `fn`, retrying while Chrome answers "No SW": right after an install or update the side panel API
 * can be called before Chrome has finished registering the service worker. Other errors are thrown at once.
 */
export async function retryNoSw<T>(fn: () => Promise<T>, tries = 4, delayMs = 500, wait = (ms: number) => new Promise((r) => setTimeout(r, ms))): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= tries || !/No SW/i.test(e instanceof Error ? e.message : String(e))) throw e;
      await wait(delayMs * i);
    }
  }
}
