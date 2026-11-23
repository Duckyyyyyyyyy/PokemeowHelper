import type { StatTable } from '../shared/types';

/**
 * Community EV training accounts: players set these up so others can battle their one-Pokémon team in
 * Player Battles for one stat's EVs. List shared by the user (2026-11-23), added with their OK.
 *
 * UNVERIFIED: the EVs per battle come from the species' yield (wiki EV Training data). The wiki says NPC
 * team battles in Player Battles award EVs like other battles, except at the Level 50 / Level 100
 * settings and on Hardcore accounts (no EXP there); live PvP gives none. Accounts can change or vanish.
 */
export interface EvTrainingAccount {
  stat: keyof StatTable;
  account: string;
  /** Pokémon on its team (wiki name) and its level range. */
  pokemon: string;
  levels: [number, number];
  types: string[];
  weakTo: string[];
}

export const EV_TRAINING_ACCOUNTS: readonly EvTrainingAccount[] = [
  { stat: 'hp', account: 'Pies1_HP', pokemon: 'Nidoqueen', levels: [16, 17], types: ['Poison', 'Ground'], weakTo: ['Ground', 'Ice', 'Psychic', 'Water'] },
  { stat: 'atk', account: 'Pies2_Attack', pokemon: 'Nidoking', levels: [16, 17], types: ['Poison', 'Ground'], weakTo: ['Ground', 'Ice', 'Psychic', 'Water'] },
  { stat: 'def', account: 'Pies3_Defense', pokemon: 'Golem', levels: [23, 25], types: ['Rock', 'Ground'], weakTo: ['Grass', 'Water', 'Fighting', 'Ground', 'Ice', 'Steel'] },
  { stat: 'spa', account: 'Pies4_SpecialAttack', pokemon: 'Roserade', levels: [5, 7], types: ['Grass', 'Poison'], weakTo: ['Fire', 'Flying', 'Ice', 'Psychic'] },
  { stat: 'spd', account: 'Pies5_SpecialDefense', pokemon: 'Dustox', levels: [11, 15], types: ['Bug', 'Poison'], weakTo: ['Fire', 'Flying', 'Psychic', 'Rock'] },
  { stat: 'spe', account: 'Pies6_Speed', pokemon: 'Jumpluff', levels: [27, 27], types: ['Grass', 'Flying'], weakTo: ['Ice', 'Fire', 'Flying', 'Poison', 'Rock'] },
];
