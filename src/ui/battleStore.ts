import { effect, signal } from '@preact/signals';
import { doublesReason, type BattleSnapshot } from '../shared/battle';
import { checkDoublesEvent, checkEvent, newEvents, type DamageCheck } from '../engine/damageCheck';
import { adviseDoubles } from '../engine/doublesAdvisor';
import { adviseTurn, lc, matchNpc } from '../engine/turnAdvisor';
import { recordObserved, type ObservedStore } from '../engine/observed';
import { box, dataset, isExtension } from './store';

/** Latest battle screen read by the content script (chrome.storage.local key "mdBattle"). */
export const battle = signal<BattleSnapshot | null>(null);
/** Calc checks for hits seen since the panel started following this battle. */
export const damageChecks = signal<DamageCheck[]>([]);
/**
 * Doubles: moves of your Pokémon seen this battle (lower-cased name → move names). The game shows
 * one position's moves at a time (and the Switch list only when opened), so remember them.
 */
export const doublesMoves = signal<Record<string, string[]>>({});
/** How often the NPC's actual move was MeowHelper's top guess, this battle. */
export const guessScore = signal<{ hit: number; total: number }>({ hit: 0, total: 0 });
const KEY = 'mdBattle';
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
    doublesMoves.value = {};
  }
  rememberMoves(next);
  const fresh = newEvents(prev, next);
  const ds = dataset.value;
  if (!ds || !prev || !fresh.length) return;
  if (doublesReason(prev, matchNpc(ds, prev)?.variant.format)) {
    // Doubles: one check per Pokémon hit; the guess is judged per NPC Pokémon.
    if (!prev.actives) return; // detected but not readable: no checks rather than wrong ones
    const checks = fresh.flatMap((e) => checkDoublesEvent(ds, box.value, prev, e));
    if (checks.length) damageChecks.value = [...damageChecks.value, ...checks].slice(-30);
    if (prev.status !== 'active') return;
    const advice = adviseDoubles(ds, prev, box.value, { observed: observed.value, movesByMon: doublesMoves.value });
    let { hit, total } = guessScore.value;
    for (const foe of advice.foes) {
      const used = fresh.find((e) => e.side === 'opponent' && lc(e.mon) === lc(foe.mon.name));
      if (!used || !foe.likely[0]) continue;
      total++;
      if (lc(used.move) === lc(foe.likely[0].name)) hit++;
    }
    guessScore.value = { hit, total };
    return;
  }

  const checks = fresh.map((e) => checkEvent(ds, box.value, prev, e)).filter((c): c is DamageCheck => !!c);
  if (checks.length) damageChecks.value = [...damageChecks.value, ...checks].slice(-30);

  const npcMoves = fresh.filter((e) => e.side === 'opponent' && prev.opponent && lc(e.mon) === lc(prev.opponent.name));
  if (npcMoves.length && prev.status === 'active') {
    const top = adviseTurn(ds, prev, box.value, { observed: observed.value }).prediction?.[0];
    if (top) {
      const hit = lc(npcMoves[0].move) === lc(top.name);
      guessScore.value = { hit: guessScore.value.hit + (hit ? 1 : 0), total: guessScore.value.total + 1 };
    }
  }
}

/** Keeps the moves the doubles screen showed (current position's buttons, Switch list cards). */
function rememberMoves(snap: BattleSnapshot) {
  if (!snap.actives) return;
  const next = { ...doublesMoves.value };
  let changed = false;
  const put = (name: string, moves: string[]) => {
    const k = name.toLowerCase();
    if (!moves.length || next[k]?.join('|') === moves.join('|')) return;
    next[k] = moves;
    changed = true;
  };
  if (snap.movesFor && snap.moves.length) put(snap.movesFor, snap.moves.map((m) => m.name));
  for (const r of snap.bench) if (r.moves?.length) put(r.name, r.moves.map((m) => m.name));
  if (changed) doublesMoves.value = next;
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
