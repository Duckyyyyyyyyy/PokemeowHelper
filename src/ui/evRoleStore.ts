import { signal } from '@preact/signals';
import type { EvRole } from '../engine/evRoles';

/**
 * The EV role you picked per Pokémon on the Train tab (BoxMon.uid → role). Pokémon without one use
 * the auto role. Per-viewer convenience, so localStorage is enough (like the team prefs).
 */
const KEY = 'md-ev-roles';

function load(): Record<string, EvRole> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

export const evRoles = signal<Record<string, EvRole>>(load());

/** The Pokémon whose Build card the Train tab shows (null = the board). Set from other tabs to open it. */
export const trainFocus = signal<string | null>(null);

/** Set or clear (null = back to auto) the role for one Pokémon. */
export function setEvRole(uid: string, role: EvRole | null) {
  const next = { ...evRoles.value };
  if (role) next[uid] = role;
  else delete next[uid];
  evRoles.value = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode */
  }
}
