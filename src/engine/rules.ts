import type { NpcCategory } from '../shared/types';

/**
 * Special battle rules, from the game's wiki (Tips & Tricks, "Rules that change your plan", and
 * World Boss Battles; read 2026-11-18), matching the game's `challenge-battle-rules` chunk:
 *  - World Boss battles and Mega Chambers: YOUR Destiny Bond, Perish Song, Endeavor, Pain Split
 *    and one-hit KO moves fail; opposing attacks bypass your Wonder Guard.
 *    (Up to 0.6.0 this was wrongly applied to Gym / Elite Four / Champion battles.)
 *  - Player Battles and Battle Towers: Bag medicine cannot be used.
 */
export interface BattleRules {
  /** YOUR moves that do nothing in this battle (the NPC's moves are not affected). */
  bannedMoves: ReadonlySet<string>;
  /** The NPC's attacks hit your Wonder Guard Pokémon normally. */
  npcIgnoresWonderGuard: boolean;
  /** Medicine from your Bag can be used in battle. */
  bagItems: boolean;
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

export function rulesFor(category?: NpcCategory): BattleRules {
  if (category && CHALLENGE_CATEGORIES.includes(category)) return CHALLENGE_RULES;
  if (category && NO_BAG_CATEGORIES.includes(category)) return TOWER_RULES;
  return NORMAL_RULES;
}

export const isChallengeRules = (r?: BattleRules) => !!r?.npcIgnoresWonderGuard;

/** Your ability as seen by the NPC's attacks. */
export function abilityVsNpc(ability: string | undefined, rules?: BattleRules): string | undefined {
  return rules?.npcIgnoresWonderGuard && ability === 'Wonder Guard' ? undefined : ability;
}

export const RULES_TEXT = "Your OHKO moves, Destiny Bond, Perish Song, Endeavor and Pain Split fail, and their attacks hit through Wonder Guard (World Boss and Mega Chamber rules). Team tab damage scores and move advice account for this.";
