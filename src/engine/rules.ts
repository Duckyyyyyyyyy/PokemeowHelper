import type { Dataset, NpcCategory } from '../shared/types';
import { gen3View } from './gen3';

/**
 * Special battle rules, from the game's wiki (Tips & Tricks, "Rules that change your plan", and
 * World Boss Battles; read 2026-11-18), matching the game's `challenge-battle-rules` chunk:
 *  - World Boss battles and Mega Chambers: YOUR Destiny Bond, Perish Song, Endeavor, Pain Split
 *    and one-hit KO moves fail; opposing attacks bypass your Wonder Guard.
 *    (Up to 0.6.0 this was wrongly applied to Gym / Elite Four / Champion battles.)
 *  - Player Battles and Battle Towers: Bag medicine cannot be used.
 *  - Battle Frontier (wiki "Battle Frontier" + "Frontier battle rules", read 2026-11-19): its own
 *    Generation III rules (see gen3.ts); Bag items cannot be used (stated on the Tower and Dome
 *    pages; Pyramid has its own Battle Bag; the other facilities are assumed the same).
 */
export interface BattleRules {
  /** YOUR moves that do nothing in this battle (the NPC's moves are not affected). */
  bannedMoves: ReadonlySet<string>;
  /** The NPC's attacks hit your Wonder Guard Pokémon normally. */
  npcIgnoresWonderGuard: boolean;
  /** Medicine from your Bag can be used in battle. */
  bagItems: boolean;
  /** Mechanics generation: 3 = Battle Frontier (Gen III simulator rules). Missing = Gen 9. */
  gen?: 3;
}

export const CHALLENGE_BANNED_MOVES: ReadonlySet<string> = new Set([
  'fissure', 'guillotine', 'horndrill', 'sheercold',
  'destinybond', 'perishsong', 'endeavor', 'painsplit',
]);

const CHALLENGE_CATEGORIES: NpcCategory[] = ['boss', 'mega'];
const NO_BAG_CATEGORIES: NpcCategory[] = ['tower'];

export const NORMAL_RULES: BattleRules = { bannedMoves: new Set(), npcIgnoresWonderGuard: false, bagItems: true };
export const CHALLENGE_RULES: BattleRules = { bannedMoves: CHALLENGE_BANNED_MOVES, npcIgnoresWonderGuard: true, bagItems: true };
export const TOWER_RULES: BattleRules = { ...NORMAL_RULES, bagItems: false };
export const FRONTIER_RULES: BattleRules = { ...NORMAL_RULES, bagItems: false, gen: 3 };

export function rulesFor(category?: NpcCategory): BattleRules {
  if (category === 'frontier') return FRONTIER_RULES;
  if (category && CHALLENGE_CATEGORIES.includes(category)) return CHALLENGE_RULES;
  if (category && NO_BAG_CATEGORIES.includes(category)) return TOWER_RULES;
  return NORMAL_RULES;
}

/** The data to score with under these rules: the Gen III view for the Battle Frontier. */
export function dsFor(ds: Dataset, rules?: BattleRules): Dataset {
  return rules?.gen === 3 ? gen3View(ds) : ds;
}

export const isChallengeRules = (r?: BattleRules) => !!r?.npcIgnoresWonderGuard;

/** Your ability as seen by the NPC's attacks. */
export function abilityVsNpc(ability: string | undefined, rules?: BattleRules): string | undefined {
  return rules?.npcIgnoresWonderGuard && ability === 'Wonder Guard' ? undefined : ability;
}

export const RULES_TEXT = "Your OHKO moves, Destiny Bond, Perish Song, Endeavor and Pain Split fail, and their attacks hit through Wonder Guard (World Boss and Mega Chamber rules). Team tab damage scores and move advice account for this.";

/**
 * Arena kinds that look like a Battle Frontier facility. The real `data-kind` of a Frontier battle
 * has NOT been seen yet (needs a live run): this is a guess, and the Battle tab also has a manual
 * "Gen III rules" switch.
 */
const FRONTIER_KIND = /frontier|dome|palace|arena|factory|pike|pyramid/i;

/** Rules for a live battle: the matched NPC first, then the arena kind, then the manual switch. */
export function battleRulesFor(category: NpcCategory | undefined, kind: string | undefined, gen3?: boolean): BattleRules {
  if (gen3) return category === 'frontier' || !category ? FRONTIER_RULES : { ...rulesFor(category), gen: 3 };
  if (category) return rulesFor(category);
  if (kind && FRONTIER_KIND.test(kind)) return FRONTIER_RULES;
  if (kind && /tower/i.test(kind)) return TOWER_RULES;
  return NORMAL_RULES;
}
