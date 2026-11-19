import { effect, signal } from '@preact/signals';
import type { BattleSnapshot } from '../shared/battle';
import { checkEvent, newEvents, type DamageCheck } from '../engine/damageCheck';
import { adviseTurn, lc, matchNpc } from '../engine/turnAdvisor';
import { battleRulesFor, dsFor } from '../engine/rules';
import { updateRun, type RunState } from '../engine/towerPlan';
import { recordObserved, type ObservedStore } from '../engine/observed';
import { box, dataset, isExtension } from './store';

/** Latest battle screen read by the content script (chrome.storage.local key "mdBattle"). */
export const battle = signal<BattleSnapshot | null>(null);
/** Calc checks for hits seen since the panel started following this battle. */
export const damageChecks = signal<DamageCheck[]>([]);
/** How often the NPC's actual move was MeowHelper's top guess, this battle. */
export const guessScore = signal<{ hit: number; total: number }>({ hit: 0, total: 0 });
const KEY = 'mdBattle';

/** Battle tab switch: score this battle with Battle Frontier (Gen III) rules. Remembered per browser. */
const GEN3_KEY = 'mh-battle-gen3';
const readFlag = (k: string) => { try { return localStorage.getItem(k) === '1'; } catch { return false; } };
export const forceGen3 = signal<boolean>(readFlag(GEN3_KEY));
export function setForceGen3(on: boolean) {
  forceGen3.value = on;
  try { localStorage.setItem(GEN3_KEY, on ? '1' : '0'); } catch { /* private window */ }
}

/**
 * Battle Tower attempt memory: opponents beaten and your team's last HP/status/PP, kept while the
 * same attempt goes on (the 20 opponents are one battle; the panel may be closed and reopened).
 */
const RUN_KEY = 'mh-tower-run';
function readRun(): RunState | null {
  try { return JSON.parse(localStorage.getItem(RUN_KEY) ?? 'null') as RunState | null; } catch { return null; }
}
export const towerRun = signal<RunState | null>(readRun());
function trackRun(snap: BattleSnapshot) {
  const ds = dataset.peek();
  const npc = ds ? matchNpc(ds, snap)?.npc : undefined;
  const carries = npc ? npc.category === 'tower' : /tower/i.test(snap.kind ?? '') && !/frontier/i.test(snap.kind ?? '');
  if (!carries) return;
  const next = updateRun(towerRun.peek(), snap, npc?.id);
  towerRun.value = next;
  try { localStorage.setItem(RUN_KEY, JSON.stringify(next)); } catch { /* ignore */ }
}
/** Moves NPC Pokémon were seen using, across battles (chrome.storage.local key "mdObserved"). */
export const observed = signal<ObservedStore>({});
const OBS_KEY = 'mdObserved';
/** Snapshots read at or before "Forget" are not recorded again (the last battle stays in storage). */
const CLEARED_KEY = 'mdObservedClearedAt';
let clearedAt = 0;
let obsLoaded = false;
let pending: BattleSnapshot | null = null;

/** Records the opponent's moves of a snapshot. Idempotent (sets of move ids), so re-reads are harmless. */
function record(snap: BattleSnapshot) {
  const ds = dataset.peek();
  if (!ds || !obsLoaded) {
    pending = snap; // wait for the stored data, or we would overwrite it
    return;
  }
  if (snap.at <= clearedAt) return;
  const next = recordObserved(ds, observed.peek(), snap);
  if (next === observed.peek()) return;
  observed.value = next;
  if (isExtension && chrome.storage?.local) chrome.storage.local.set({ [OBS_KEY]: next }).catch(() => {});
}

export async function clearObserved() {
  observed.value = {};
  clearedAt = Math.max(Date.now(), battle.peek()?.at ?? 0);
  if (isExtension && chrome.storage?.local) {
    await chrome.storage.local.remove(OBS_KEY).catch(() => {});
    await chrome.storage.local.set({ [CLEARED_KEY]: clearedAt }).catch(() => {});
  }
}

/**
 * Handles a new snapshot: hits and NPC moves that appeared since the previous snapshot are
 * judged against the state BEFORE them (levels/HP change during a battle).
 */
export function onSnapshot(next: BattleSnapshot | null) {
  const prev = battle.value;
  battle.value = next;
  if (!next) return;
  try {
    trackRun(next);
    judge(prev, next);
  } finally {
    // After judging: the guess for `prev` must not see the move the NPC just used.
    record(next);
  }
}

function judge(prev: BattleSnapshot | null, next: BattleSnapshot) {
  const sameBattle = !!prev && prev.opponentName === next.opponentName && (next.turn ?? 0) >= (prev.turn ?? 0)
    && (prev.events?.length ?? 0) <= (next.events?.length ?? 0);
  if (!sameBattle) {
    damageChecks.value = [];
    guessScore.value = { hit: 0, total: 0 };
  }
  const fresh = newEvents(prev, next);
  const base = dataset.value;
  if (!base || !prev || !fresh.length) return;
  // Battle Frontier battles are checked against the Gen III calc.
  const ds = dsFor(base, battleRulesFor(matchNpc(base, prev)?.npc.category, prev.kind, forceGen3.value));

  const checks = fresh.map((e) => checkEvent(ds, box.value, prev, e)).filter((c): c is DamageCheck => !!c);
  if (checks.length) damageChecks.value = [...damageChecks.value, ...checks].slice(-30);

  const npcMoves = fresh.filter((e) => e.side === 'opponent' && prev.opponent && lc(e.mon) === lc(prev.opponent.name));
  if (npcMoves.length && prev.status === 'active') {
    const top = adviseTurn(base, prev, box.value, { observed: observed.value, gen3: forceGen3.value }).prediction?.[0];
    if (top) {
      const hit = lc(npcMoves[0].move) === lc(top.name);
      guessScore.value = { hit: guessScore.value.hit + (hit ? 1 : 0), total: guessScore.value.total + 1 };
    }
  }
}

export function initBattle() {
  if (!isExtension || !chrome.storage?.local) {
    obsLoaded = true;
    return;
  }
  chrome.storage.local.get([OBS_KEY, CLEARED_KEY]).then((r) => {
    observed.value = (r[OBS_KEY] as ObservedStore | undefined) ?? {};
    clearedAt = (r[CLEARED_KEY] as number | undefined) ?? 0;
  }).catch(() => {}).finally(() => {
    obsLoaded = true;
    const p = pending;
    pending = null;
    if (p) record(p);
  });
  // The wiki data may load after the first snapshot: record it then (recording is idempotent).
  effect(() => {
    if (dataset.value && pending) {
      const p = pending;
      pending = null;
      record(p);
    }
  });
  chrome.storage.local.get(KEY).then((r) => onSnapshot((r[KEY] as BattleSnapshot | null) ?? null)).catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && KEY in changes) onSnapshot((changes[KEY].newValue as BattleSnapshot | null) ?? null);
  });
}

/** Dev harness only: the reconstructed Brock battle, so the tab can be previewed outside Chrome. */
export async function loadSampleBattle() {
  if (!import.meta.env.DEV) return;
  const [{ default: html }, { readBattle }] = await Promise.all([
    import('../../tests/fixtures/battle/brock-turn3.reconstructed.html?raw'),
    import('../content/battleReader'),
  ]);
  onSnapshot(readBattle(new DOMParser().parseFromString(html, 'text/html')));
}
