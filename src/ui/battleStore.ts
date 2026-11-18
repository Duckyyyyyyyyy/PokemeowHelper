import { signal } from '@preact/signals';
import type { BattleSnapshot } from '../shared/battle';
import { checkEvent, newEvents, type DamageCheck } from '../engine/damageCheck';
import { adviseTurn, lc } from '../engine/turnAdvisor';
import { box, dataset, isExtension } from './store';

/** Latest battle screen read by the content script (chrome.storage.local key "mdBattle"). */
export const battle = signal<BattleSnapshot | null>(null);
/** Calc checks for hits seen since the panel started following this battle. */
export const damageChecks = signal<DamageCheck[]>([]);
/** How often the NPC's actual move was MeowDex's top guess, this battle. */
export const guessScore = signal<{ hit: number; total: number }>({ hit: 0, total: 0 });
const KEY = 'mdBattle';

/**
 * Handles a new snapshot: hits and NPC moves that appeared since the previous snapshot are
 * judged against the state BEFORE them (levels/HP change during a battle).
 */
export function onSnapshot(next: BattleSnapshot | null) {
  const prev = battle.value;
  battle.value = next;
  if (!next) return;
  const sameBattle = !!prev && prev.opponentName === next.opponentName && (next.turn ?? 0) >= (prev.turn ?? 0)
    && (prev.events?.length ?? 0) <= (next.events?.length ?? 0);
  if (!sameBattle) {
    damageChecks.value = [];
    guessScore.value = { hit: 0, total: 0 };
  }
  const fresh = newEvents(prev, next);
  const ds = dataset.value;
  if (!ds || !prev || !fresh.length) return;

  const checks = fresh.map((e) => checkEvent(ds, box.value, prev, e)).filter((c): c is DamageCheck => !!c);
  if (checks.length) damageChecks.value = [...damageChecks.value, ...checks].slice(-30);

  const npcMoves = fresh.filter((e) => e.side === 'opponent' && prev.opponent && lc(e.mon) === lc(prev.opponent.name));
  if (npcMoves.length && prev.status === 'active') {
    const top = adviseTurn(ds, prev, box.value).prediction?.[0];
    if (top) {
      const hit = lc(npcMoves[0].move) === lc(top.name);
      guessScore.value = { hit: guessScore.value.hit + (hit ? 1 : 0), total: guessScore.value.total + 1 };
    }
  }
}

export function initBattle() {
  if (!isExtension || !chrome.storage?.local) return;
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
