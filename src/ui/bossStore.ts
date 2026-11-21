import { computed, signal } from '@preact/signals';
import type { BossBuild, BossLobbySnapshot } from '../shared/bossLobby';
import type { Dataset, Npc } from '../shared/types';
import { dataset, isExtension } from './store';

/** The World Boss page as read by the content script (key "mdBossLobby"). */
export const bossLobby = signal<BossLobbySnapshot | null>(null);
const KEY = 'mdBossLobby';

export function initBossLobby() {
  if (!isExtension || !chrome.storage?.local) return;
  chrome.storage.local.get(KEY).then((r) => (bossLobby.value = (r[KEY] as BossLobbySnapshot | null) ?? null)).catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && KEY in changes) bossLobby.value = (changes[KEY].newValue as BossLobbySnapshot | null) ?? null;
  });
}

/* ---------------- your picks ---------------- */

export interface BossPick {
  moves: string[];
  at: number;
}

/** Moves you tapped in Prep, per World Boss NPC id. Per-viewer convenience: localStorage. */
const PICKS_KEY = 'mh-boss-picks';
function loadPicks(): Record<string, BossPick> {
  try {
    const v = JSON.parse(localStorage.getItem(PICKS_KEY) ?? '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}
export const bossPicks = signal<Record<string, BossPick>>(loadPicks());
function savePicks() {
  try { localStorage.setItem(PICKS_KEY, JSON.stringify(bossPicks.value)); } catch { /* private window */ }
}

export function setBossPick(npcId: string, moves: string[], now = Date.now()) {
  bossPicks.value = { ...bossPicks.value, [npcId]: { moves, at: now } };
  savePicks();
}
export function clearBossPick(npcId: string) {
  const { [npcId]: _gone, ...rest } = bossPicks.value;
  bossPicks.value = rest;
  savePicks();
}

/* ---------------- resolving ---------------- */

const lc = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const FORM_WORDS: Record<string, string[]> = { eternamax: ['eternamax'], gmax: ['gigantamax', 'gmax'] };

/** Does a name read on the World Boss page belong to this NPC? The form icon may stand in for "Eternamax". */
export function lobbyNameMatches(npc: Npc, name: string, form?: string): boolean {
  const n = lc(npc.name);
  if (n === lc(name)) return true;
  return (form ? FORM_WORDS[form] ?? [form] : []).some((w) => n === lc(`${w} ${name}`) || n === lc(`${name} ${w}`));
}

export interface LobbyMoves {
  build: BossBuild;
  /** Move ids in the boss's pool. */
  ids: string[];
  /** Names the dialog lists that are not in the wiki pool (shown, not used). */
  unknown: string[];
  /** The build belongs to the "Next scheduled boss". */
  isNext: boolean;
  startsAt?: string;
}

/** The moves the World Boss page lists for this boss, mapped to its pool. */
export function lobbyMovesFor(ds: Dataset, npc: Npc, lobby: BossLobbySnapshot | null): LobbyMoves | null {
  if (!lobby || npc.category !== 'boss') return null;
  const pool = npc.variants[0]?.team[0]?.moves ?? [];
  const next = lobby.next && lobbyNameMatches(npc, lobby.next.name, lobby.next.form) ? lobby.next : undefined;
  // A build read while this boss was the next one, for that same spawn time, beats any other.
  const forNext = (b: BossBuild) => !!next?.startsAt && b.startsAt === next.startsAt;
  const build = Object.values(lobby.builds ?? {})
    .filter((b) => b.moves?.length && lobbyNameMatches(npc, b.name, b.form))
    .sort((a, b) => Number(forNext(b)) - Number(forNext(a)) || b.at - a.at)[0];
  if (!build) return null;
  const ids: string[] = [];
  const unknown: string[] = [];
  for (const m of build.moves!) {
    const id = pool.find((p) => lc(ds.moves[p]?.name ?? p) === lc(m.name));
    if (id) ids.push(id);
    else unknown.push(m.name);
  }
  const isNext = forNext(build);
  return { build, ids, unknown, isNext, startsAt: isNext ? next?.startsAt : undefined };
}

export interface ActiveBossMoves {
  ids: string[];
  source: 'lobby' | 'manual';
  lobby?: LobbyMoves;
}

/**
 * A boss's set changes every appearance, so a pick or lobby read older than this is ignored
 * (otherwise an old pick would narrow a later spawn).
 */
export const BOSS_PICK_MAX_AGE = 12 * 3600 * 1000;

/** What drives Prep and the Battle tab: the newer of the lobby read and your own picks. Null = full pool. */
export function activeBossMoves(ds: Dataset, npc: Npc, lobby: BossLobbySnapshot | null, picks: Record<string, BossPick>, now = Date.now()): ActiveBossMoves | null {
  if (npc.category !== 'boss') return null;
  const lobbyRead = lobbyMovesFor(ds, npc, lobby);
  const fromLobby = lobbyRead && now - lobbyRead.build.at <= BOSS_PICK_MAX_AGE ? lobbyRead : null;
  const pick0 = picks[npc.id];
  const pick = pick0 && now - pick0.at <= BOSS_PICK_MAX_AGE ? pick0 : undefined;
  if (pick?.moves.length && (!fromLobby || pick.at >= fromLobby.build.at)) return { ids: pick.moves, source: 'manual', lobby: fromLobby ?? undefined };
  if (fromLobby?.ids.length) return { ids: fromLobby.ids, source: 'lobby', lobby: fromLobby };
  return null;
}

/** Every World Boss with a known move set, by NPC id (for the Battle tab). */
export const bossMovesById = computed<Record<string, string[]>>(() => {
  const ds = dataset.value;
  if (!ds) return {};
  const out: Record<string, string[]> = {};
  for (const npc of ds.npcs) {
    if (npc.category !== 'boss') continue;
    const a = activeBossMoves(ds, npc, bossLobby.value, bossPicks.value);
    if (a?.ids.length) out[npc.id] = a.ids;
  }
  return out;
});

