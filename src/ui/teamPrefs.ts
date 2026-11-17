import { signal } from '@preact/signals';
import type { BoxMon, Dataset } from '../shared/types';

/**
 * Your choices on the Team tab: Pokémon pinned to the team and Pokémon never suggested.
 * Keyed by BoxMon.uid (synced ones are `game:<id>`, stable across syncs).
 * Per-viewer convenience, so localStorage is enough.
 */
const KEY = 'md-team-prefs';

function load(): { locked: string[]; excluded: string[] } {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { locked: Array.isArray(v.locked) ? v.locked : [], excluded: Array.isArray(v.excluded) ? v.excluded : [] };
  } catch {
    return { locked: [], excluded: [] };
  }
}
const initial = load();
export const lockedUids = signal<string[]>(initial.locked);
export const excludedUids = signal<string[]>(initial.excluded);

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify({ locked: lockedUids.value, excluded: excludedUids.value }));
  } catch {
    /* ignore */
  }
}

export function toggleLock(uid: string) {
  const on = lockedUids.value.includes(uid);
  lockedUids.value = on ? lockedUids.value.filter((u) => u !== uid) : [...lockedUids.value, uid];
  if (!on) excludedUids.value = excludedUids.value.filter((u) => u !== uid);
  save();
}

export function toggleExclude(uid: string) {
  const on = excludedUids.value.includes(uid);
  excludedUids.value = on ? excludedUids.value.filter((u) => u !== uid) : [...excludedUids.value, uid];
  if (!on) lockedUids.value = lockedUids.value.filter((u) => u !== uid);
  save();
}

export function resetTeamPrefs() {
  lockedUids.value = [];
  excludedUids.value = [];
  save();
}

/** Showdown-style text, so the team can be pasted into notes or a calc. */
export function teamToText(ds: Dataset, team: BoxMon[], header?: string): string {
  const blocks = team.map((b) => {
    const s = ds.species[b.species];
    const item = b.item ? ds.items[b.item]?.name ?? b.item : null;
    const lines = [`${s?.name ?? '?'}${item ? ` @ ${item}` : ''}`];
    if (b.ability) lines.push(`Ability: ${b.ability}`);
    if (b.level) lines.push(`Level: ${b.level}`);
    if (b.nature) lines.push(`${b.nature} Nature`);
    for (const id of b.moves) lines.push(`- ${ds.moves[id]?.name ?? id}`);
    return lines.join('\n');
  });
  return [header ? `// ${header}` : '', ...blocks].filter(Boolean).join('\n\n');
}
