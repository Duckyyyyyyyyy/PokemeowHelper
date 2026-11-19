import { effect, signal } from '@preact/signals';
import { battle } from './battleStore';
import { wild } from './wildStore';
import { activeTab } from './store';

/**
 * Auto-switch: open Battle when a battle starts and Wild when a new wild encounter appears.
 * It only fires on the start, so a tab you pick yourself during the battle stays put.
 * Stored per browser (UI preference), on by default.
 */
const KEY = 'mdAutoTab';
const read = () => {
  try {
    return localStorage.getItem(KEY) !== '0';
  } catch {
    return true;
  }
};
export const autoTab = signal(read());
export function setAutoTab(on: boolean) {
  autoTab.value = on;
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch { /* private mode */ }
}

/** Snapshots older than this are left over from an earlier session: no switch. */
const FRESH_MS = 2 * 60_000;
let battleWasActive = false;
let lastWildKey = '';

export function initAutoTab() {
  effect(() => {
    const b = battle.value;
    const active = !!b && b.status === 'active';
    const start = active && !battleWasActive && Date.now() - b!.at < FRESH_MS;
    battleWasActive = active;
    if (start && autoTab.peek()) activeTab.value = 'battle';
  });
  effect(() => {
    const w = wild.value;
    if (!w) return;
    const key = `${w.name}|${w.level ?? ''}`;
    if (key === lastWildKey) return;
    lastWildKey = key;
    // A wild battle also shows on the battle screen: the encounter view has the catch advice.
    if (Date.now() - w.at < FRESH_MS && autoTab.peek()) activeTab.value = 'wild';
  });
}
