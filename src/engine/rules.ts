import type { NpcCategory } from '../shared/types';

/**
 * Challenge rule modifiers.
 *
 * Source: the game's `challenge-battle-rules` chunk (read 2026-11-17, see docs/PLAN.md 1.1):
 * OHKO moves, Destiny Bond, Perish Song, Endeavor and Pain Split are disabled, and the
 * opponent's attacks ignore Wonder Guard. The rules are not in the wiki data file, so they
 * are hardcoded here.
 * ASSUMPTION: they apply to League challenges only (Gym, Elite Four, Champion), the NPCs that
 * come from the `challenges` key. Other modes (towers, rivals, bosses…) use normal rules.
 */
export interface BattleRules {
  /** Moves that do nothing in this battle. */
  bannedMoves: ReadonlySet<string>;
  /** The NPC's attacks hit your Wonder Guard Pokémon normally. */
  npcIgnoresWonderGuard: boolean;
}

export const CHALLENGE_BANNED_MOVES: ReadonlySet<string> = new Set([
  'fissure', 'guillotine', 'horndrill', 'sheercold',
  'destinybond', 'perishsong', 'endeavor', 'painsplit',
]);

const CHALLENGE_CATEGORIES: NpcCategory[] = ['gym', 'elite-four', 'champion'];

export const NORMAL_RULES: BattleRules = { bannedMoves: new Set(), npcIgnoresWonderGuard: false };
export const CHALLENGE_RULES: BattleRules = { bannedMoves: CHALLENGE_BANNED_MOVES, npcIgnoresWonderGuard: true };

export function rulesFor(category?: NpcCategory): BattleRules {
  return category && CHALLENGE_CATEGORIES.includes(category) ? CHALLENGE_RULES : NORMAL_RULES;
}

export const isChallengeRules = (r?: BattleRules) => !!r?.npcIgnoresWonderGuard;

/** Your ability as seen by the NPC's attacks. */
export function abilityVsNpc(ability: string | undefined, rules?: BattleRules): string | undefined {
  return rules?.npcIgnoresWonderGuard && ability === 'Wonder Guard' ? undefined : ability;
}

export const RULES_TEXT = "OHKO moves, Destiny Bond, Perish Song, Endeavor and Pain Split don't work, and the NPC's attacks ignore Wonder Guard. Team tab damage scores and move advice account for this.";
