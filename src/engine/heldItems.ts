import { toID } from '@smogon/calc';
import type { BoxMon, Dataset, NpcTeamVariant } from '../shared/types';
import { bestMove, boxToCalc, duel, gen, makeField, npcToCalc } from './damage';
import type { BattleRules } from './rules';
import { movesForBox } from './teamSuggest';

/**
 * Held item advice for one of your Pokémon against an NPC team, from the items in your bag.
 *  - Items the damage calc models (Gems, type boosters like Hard Stone, Choice/Life Orb/Expert
 *    Belt…): the 1v1 duel score is recomputed with the item; a Gem only boosts the first hit.
 *  - Other items: simple rules based on its moves and the NPC team (status berries vs status
 *    moves, Wide Lens for inaccurate moves, Light Clay with screens…), with a fixed value.
 */
export interface HeldItemTip {
  itemId: string;
  name: string;
  /** Average 1v1 score gain vs the NPC team (calc items), or a rule-of-thumb value. */
  value: number;
  why: string;
  /** true = calc numbers, false = rule of thumb. */
  calc: boolean;
}

const name = (ds: Dataset, id: string) => ds.items[id]?.name ?? gen.items.get(toID(id))?.name ?? id;
const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

/** Items the calc changes damage or speed for (tested via the duel). */
function calcModeled(id: string): boolean {
  const it = gen.items.get(toID(id));
  if (!it) return false;
  if (/gem$/.test(id)) return true;
  return [
    'choiceband', 'choicespecs', 'choicescarf', 'lifeorb', 'expertbelt', 'muscleband', 'wiseglasses', 'assaultvest', 'eviolite',
    'blackbelt', 'blackglasses', 'charcoal', 'dragonfang', 'fairyfeather', 'hardstone', 'magnet', 'metalcoat', 'miracleseed', 'mysticwater',
    'nevermeltice', 'poisonbarb', 'sharpbeak', 'silkscarf', 'silverpowder', 'softsand', 'spelltag', 'twistedspoon',
    'punchingglove', 'lightball', 'thickclub',
  ].includes(id) || /plate$/.test(id);
}

/** Type a Gem or type-boosting item powers up (only worth trying if it has a move of that type). */
const BOOSTER_TYPE: Record<string, string> = {
  blackbelt: 'Fighting', blackglasses: 'Dark', charcoal: 'Fire', dragonfang: 'Dragon', fairyfeather: 'Fairy', hardstone: 'Rock',
  magnet: 'Electric', metalcoat: 'Steel', miracleseed: 'Grass', mysticwater: 'Water', nevermeltice: 'Ice', poisonbarb: 'Poison',
  sharpbeak: 'Flying', silkscarf: 'Normal', silverpowder: 'Bug', softsand: 'Ground', spelltag: 'Ghost', twistedspoon: 'Psychic',
};
const boostedType = (id: string) => BOOSTER_TYPE[id] ?? (/gem$/.test(id) ? gen.items.get(toID(id))?.name.replace(/ Gem$/, '') : undefined);

const SOUND = new Set(['hypervoice', 'boomburst', 'bugbuzz', 'snarl', 'disarmingvoice', 'uproar', 'echoedvoice', 'round', 'overdrive', 'clangingscales', 'torchsong', 'alluringvoice', 'psychicnoise', 'sparklingaria', 'chatter', 'relicsong']);
const STATUS_BERRY: [string, RegExp, string][] = [
  ['rawstberry', /\bburn/i, 'burn'],
  ['aspearberry', /freez/i, 'freeze'],
  ['chestoberry', /\bsleep|asleep/i, 'sleep'],
  ['persimberry', /confus/i, 'confusion'],
  ['cheriberry', /paralyz/i, 'paralysis'],
  ['pechaberry', /poison/i, 'poison'],
];
const PINCH_HEAL = ['figyberry', 'wikiberry', 'magoberry', 'aguavberry', 'iapapaberry', 'sitrusberry', 'oranberry'];

export function suggestHeldItems(
  ds: Dataset, mon: BoxMon, v: NpcTeamVariant, owned: ReadonlyMap<string, number>,
  opts: { levelCap?: number; rules?: BattleRules } = {},
): HeldItemTip[] {
  const field = makeField(v.format);
  const myMoves = movesForBox(ds, mon);
  const foes = v.team.map((n) => npcToCalc(ds, n));
  const scoreWith = (item: string | undefined) => {
    const me = boxToCalc(ds, { ...mon, item }, opts.levelCap ?? 50);
    return avg(foes.map((f, j) => duel(ds, me, myMoves, f, v.team[j].moves, field, opts.rules).score));
  };
  const base = scoreWith(undefined);
  // What it holds now: a better item must beat it (calc items), or clearly matter (rules of thumb).
  const current = mon.item ? gen.items.get(toID(mon.item))?.name ?? mon.item : undefined;
  const currentGain = current && calcModeled(toID(current)) ? scoreWith(current) - base : 0;
  const tips: HeldItemTip[] = [];

  const myTypes = new Set(myMoves.map((id) => ds.moves[id]).filter((m) => m && m.category !== 'Status').map((m) => m.type));
  for (const [id] of owned) {
    if (!calcModeled(id)) continue;
    const t = boostedType(id);
    if (t && !myTypes.has(t)) continue;
    const gain = scoreWith(name(ds, id)) - base;
    if (gain >= 2) tips.push({ itemId: id, name: name(ds, id), value: gain, calc: true, why: `+${Math.round(gain)} avg 1v1 score vs this team${/gem$/.test(id) ? ' (main-game rule, not checked in this game: one hit ×1.3, then it is used up)' : ''}.` });
  }

  // Rules of thumb for items the calc doesn't model.
  const has = (id: string) => owned.has(id);
  const add = (id: string, value: number, why: string) => {
    if (has(id) && !tips.some((t) => t.itemId === id)) tips.push({ itemId: id, name: name(ds, id), value, calc: false, why });
  };
  const npcMoveDescs = v.team.flatMap((n) => n.moves.map((id) => ds.moves[id]).filter((m) => !!m));
  const meCalc = boxToCalc(ds, mon, opts.levelCap ?? 50);
  const best = foes.map((f) => bestMove(ds, meCalc, f, myMoves, field));
  const bestAcc = best.map((b) => (b ? ds.moves[b.moveId]?.accuracy : true)).filter((a): a is number => typeof a === 'number');

  for (const [id, re, what] of STATUS_BERRY) {
    const users = v.team.filter((n) => n.moves.some((mid) => { const m = ds.moves[mid]; return m && m.category === 'Status' && re.test(m.description) && /target/i.test(m.description); }));
    if (users.length) add(id, 4 + users.length, `Cures ${what} once: ${users.map((n) => n.name).join(', ')} can cause it.`);
  }
  if (bestAcc.some((a) => a < 100)) add('widelens', 3, `Its best moves here miss sometimes (${Math.min(...bestAcc)}% accuracy); Wide Lens adds 10%.`);
  if (bestAcc.some((a) => a <= 80)) add('blunderpolicy', 2, 'Its inaccurate moves raise Speed by 2 when they miss.');
  if (mon.moves.some((id) => ['reflect', 'lightscreen', 'auroraveil'].includes(id))) add('lightclay', 5, 'Makes its Reflect/Light Screen last 8 turns instead of 5.');
  if (mon.moves.some((id) => SOUND.has(id))) add('throatspray', 3, 'Raises Sp. Atk after its first sound move.');
  if (v.team.some((n) => n.ability === 'Intimidate')) add('adrenalineorb', 3, 'The NPC has Intimidate: this raises Speed instead.');
  if (npcMoveDescs.some((m) => m.category === 'Status' && /raises the user's/i.test(m.description))) add('mirrorherb', 3, 'Copies the stat boosts the NPC sets up.');
  if (npcMoveDescs.some((m) => ['taunt', 'encore', 'torment', 'disable'].includes(m.id))) add('mentalherb', 3, 'Shakes off Taunt/Encore/Disable once.');
  if (npcMoveDescs.some((m) => m.type === 'Electric' && m.category !== 'Status')) add('cellbattery', 2, 'Raises Attack when hit by an Electric move.');
  const physical = npcMoveDescs.filter((m) => m.category === 'Physical').length;
  const special = npcMoveDescs.filter((m) => m.category === 'Special').length;
  if (physical > special) add('keeberry', 2, 'Their team hits mostly physical: +1 Defense after the first physical hit.');
  if (special > physical) add('marangaberry', 2, 'Their team hits mostly special: +1 Sp. Def after the first special hit.');
  const slower = foes.filter((f) => f.stats.spe > meCalc.stats.spe).length;
  if (slower >= Math.ceil(foes.length / 2)) {
    add('salacberry', 3, `Slower than ${slower}/${foes.length} of their team: +1 Speed at 1/4 HP.`);
    add('custapberry', 2, 'Moves first once at 1/4 HP.');
  }
  add('leftovers', 3, 'Heals 1/16 of its HP every turn.');
  if (ds.species[mon.species]?.types.includes('Poison')) add('blacksludge', 3, 'Heals 1/16 of its HP every turn (Poison type).');
  for (const id of PINCH_HEAL) add(id, 2, id === 'sitrusberry' || id === 'oranberry' ? 'Heals once when HP gets low.' : 'Heals 1/3 HP once at 1/4 HP (may confuse if its nature dislikes the flavor).');

  const bar = current ? Math.max(currentGain + 2, 4) : 0;
  return tips.filter((t) => t.name !== current && t.value >= bar).sort((a, b) => b.value - a.value);
}

/** One item per Pokémon, respecting how many of each you own: highest value first. */
export function assignHeldItems(perMon: { uid: string; tips: HeldItemTip[] }[], owned: ReadonlyMap<string, number>): Map<string, HeldItemTip> {
  const left = new Map(owned);
  const out = new Map<string, HeldItemTip>();
  const all = perMon.flatMap((m) => m.tips.map((t) => ({ uid: m.uid, t }))).sort((a, b) => b.t.value - a.t.value);
  for (const { uid, t } of all) {
    if (out.has(uid) || (left.get(t.itemId) ?? 0) <= 0) continue;
    out.set(uid, t);
    left.set(t.itemId, (left.get(t.itemId) ?? 0) - 1);
  }
  return out;
}
