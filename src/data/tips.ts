import type { GameTip, TipSource } from '../shared/types';

/**
 * Hand-curated progression tips. Written in our own words from the game wiki's
 * guide pages – never copied – and each one links its page. Facts the wiki data file
 * already holds (HM givers, Key Item sources, spawn unlocks…) are generated at sync time
 * in tipsGen.ts instead, so they stay current.
 *
 * Map ids are the wiki's explore map ids (ds.wild.maps[].id); NPC ids are Npc.id.
 */

/** Progress path stage per region: n = "after this region's Champion". A suggested order only. */
export const REGION_STAGE: Record<string, number> = {
  kanto: 1, johto: 2, hoenn: 3, sinnoh: 4, unova: 5, kalos: 6, alola: 7, galar: 8, hisui: 9, paldea: 10,
};

/**
 * Path placement for Key Items whose source names no trainer (our reading of where they
 * fit; the wiki gives no order). Silph Scope: Graveyard + Dig need no Champion. Wailmer
 * Pail: needs Cut (Kanto Champion). Explorer Kit: lies under the Caves (Sinnoh Champion).
 */
export const KEY_ITEM_STAGE: Record<string, number> = { silphscope: 0, wailmerpail: 1, miningpickaxe: 4 };

export const WIKI = 'https://pokemeowrpg.com/wiki/';
const P = (ref: string): TipSource => ({ kind: 'page', ref });

const GRASS = 'verdant-trail';
const VOLCANO = 'moonlit-grove';
const SEA = 'azure-shore';
const CAVES = 'stone-ridge';
const GRAVE = 'haunted-wood';
const SKY = 'sky-meadow';
const DRAGON = 'dragon-sanctuary';
const VIOLET = 'dream-forest';
const VOID = 'void-wastes';
const FAIRY = 'fairy-sanctuary';
const SNOW = 'snow-mountain';
const DARK = 'dark-forest';
const EMBER = 'mt-ember';
const UPPER = 'caves-upper';
const UNDER = 'caves-underground';
const DEEP = 'azure-depths';
const EDGE = 'volcano-edge';
const PLANT = 'power-plant';
const RUINS = 'unown-ruins';
const GARDEN = 'berry-garden';
const SAFARI = 'safari-zone';
const LANDING = 'safari-approach';

const BLUE = 'challenge:kanto-blue';
const LANCE = 'challenge:johto-lance';
const WALLACE = 'challenge:hoenn-wallace';
const CYNTHIA = 'challenge:sinnoh-cynthia';
const ALDER = 'challenge:unova-alder';
const DIANTHA = 'challenge:kalos-diantha';
const HAU = 'challenge:alola-hau';
const LEON = 'challenge:galar-leon';
const GEETA = 'challenge:paldea-geeta';

const FIELD = P('#/maps/field-moves');
const MAPS = P('#/maps');

export const CURATED_TIPS: GameTip[] = [
  /* ---------- Getting started ---------- */
  {
    id: 'start:first-steps', title: 'Your first steps', category: 'start', stage: 0, order: 0,
    steps: [
      'You start in Grasslands with a level-5 Bulbasaur, Charmander or Squirtle. Every other map is hidden until you find or unlock it.',
      'Walk in Explore to meet wild Pokémon, then pick Catch or Battle. You can throw balls even before you have a team.',
      'Taking another step replaces the wild Pokémon in front of you, so finish catching or battling first.',
      'The first non-Egg Pokémon on your team is your Starter for Explore (its Ability can change what you meet).',
    ],
    maps: [GRASS], source: [P('#/getting-started')], keywords: ['beginner', 'new player', 'starter'],
  },
  {
    id: 'start:starter-tasks', title: 'Finish the Starter Tasks early', category: 'start', stage: 0, order: 1,
    steps: [
      'Overview → Starter Tasks has 10 easy goals: start a daily and a weekly quest, catch 5 Pokémon, open a map chest, beat Brock, evolve once, and open a few menus (Pokédex entry, Top Trainers, Recent changes, Wiki, Shop).',
      'Claiming the bundle gives balls, potions, revives and Repels, and permanently opens a 3rd daily and 3rd weekly quest slot.',
      'Intermediate, Advanced and Master Tasks unlock one after another and give bigger one-time bundles.',
    ],
    npcs: ['challenge:brock'], source: [P('#/activities/starter-tasks')], keywords: ['tasks', 'quest slot'],
  },
  {
    id: 'start:utc-clock', title: 'Day, night and resets use UTC', category: 'start', stage: 0, order: 2,
    steps: [
      'Day is 06:00–18:00 UTC and night is 18:00–06:00 UTC. Some spawns and evolutions only happen in one of them.',
      'Daily things (map chests, mining walls, Rock Smash rocks, Dowsing finds, the Explorer Kit and Dowsing Machine spots) reset at 00:00 UTC.',
      'Weekly quests and the Catchlist reset on Monday at 00:00 UTC.',
    ],
    source: [MAPS, P('#/pokemon/evolution'), P('#/activities/quests')], keywords: ['time', 'reset', 'night', 'day'],
  },
  {
    id: 'start:level-caps', title: 'League level caps apply to the whole team', category: 'battling', stage: 0, order: 3,
    steps: [
      'Every Pokémon you bring to a Gym, Elite Four or Champion fight must be at or below that trainer\'s level cap.',
      'Leaving an ordinary League battle counts as a forfeit and a loss.',
      'MeowRPGAdvisor\'s Prep tab shows each trainer\'s cap and real team.',
    ],
    source: [P('#/challenges')], keywords: ['level cap', 'league'],
  },
  {
    id: 'start:evolve', title: 'Evolution is never automatic', category: 'evolution', stage: 0, order: 4,
    steps: [
      'When a Pokémon meets its condition, open My Pokémon and choose Evolve (or use the item from your Bag).',
      'A held Everstone blocks it, so take it off first.',
    ],
    source: [P('#/pokemon/evolution')], keywords: ['evolve', 'everstone'],
  },

  /* ---------- HMs & field moves (how to USE them; how to GET them comes from the data) ---------- */
  {
    id: 'field:basics', title: 'How field moves work in Explore', category: 'hm', stage: 0, order: 5,
    steps: [
      'Each of the 8 HMs is a permanent reward from one regional Champion and can be taught again and again.',
      'To use the move on the map you need the HM in your Bag AND a team Pokémon that knows the move (boxed Pokémon and Eggs don\'t count).',
      'Field use costs no PP. Fly, Teleport and Dig don\'t work inside the Safari Zone.',
    ],
    source: [FIELD], keywords: ['hm', 'field move'],
  },
  {
    id: 'field:surf', title: 'Surf: cross deep water', category: 'hm', stage: 3, order: 6,
    steps: [
      'Needs HM03 Surf (Hoenn Champion Wallace) and a team Pokémon that knows Surf – it does not have to lead.',
      'Walk onto deep water to ride it. Shallow water is walkable without Surf.',
      'Surf north up the river in north-eastern Grasslands to find The Blue Sea.',
      'Deep water has its own Surf encounter list; shallow-water steps use the normal walking list.',
    ],
    moves: ['surf'], items: ['hmsurf'], maps: [GRASS, SEA], npcs: [WALLACE], requires: ['HM03 Surf'],
    source: [FIELD, P('#/getting-started')],
  },
  {
    id: 'field:cut', title: 'Cut: the tree to the Flower Garden', category: 'hm', stage: 1, order: 6,
    steps: [
      'Needs HM01 Cut (Kanto Champion Blue).',
      'Cut the small tree on the west edge of Grasslands, north of the Power Plant building.',
      'Inside the garden, talk to the Flower Girl for the Wailmer Pail. Cut does not remove other trees.',
    ],
    moves: ['cut'], items: ['hmcut', 'wailmerpail'], maps: [GRASS, GARDEN], npcs: [BLUE], requires: ['HM01 Cut'],
    source: [FIELD],
  },
  {
    id: 'field:fly', title: 'Fly: travel and reach Sky Islands', category: 'hm', stage: 2, order: 6,
    steps: [
      'Needs HM02 Fly (Johto Champion Lance).',
      'Choose Fly from a team Pokémon\'s moves to jump to an outdoor map part you already visited (not inside caves or buildings).',
      'To find Sky Islands: in south-eastern Volcano walk right through the doorway in the east wall, then use Fly on the rocky ledge outside.',
    ],
    moves: ['fly'], items: ['hmfly'], maps: [VOLCANO, EDGE, SKY], npcs: [LANCE], requires: ['HM02 Fly'],
    source: [FIELD, MAPS],
  },
  {
    id: 'field:strength', title: 'Strength: push boulders and ice', category: 'hm', stage: 4, order: 6,
    steps: [
      'Needs HM04 Strength (Sinnoh Champion Cynthia).',
      'Stand next to a movable boulder and use Strength: it slides one tile away from you if that tile is free. Positions are saved.',
      'Opens side paths in Caves, Volcano, Dragon\'s Reach and Snow Mountain (ice blocks there). Light dark caves with Flash first.',
    ],
    moves: ['strength'], items: ['hmstrength'], maps: [CAVES, VOLCANO, DRAGON, SNOW], npcs: [CYNTHIA], requires: ['HM04 Strength'],
    source: [FIELD],
  },
  {
    id: 'field:flash', title: 'Flash: light up dark caves', category: 'hm', stage: 5, order: 6,
    steps: [
      'Needs HM05 Flash (Unova Champion Alder).',
      'Use it once per cave level: Caves, Upper Caves and Underground each keep their own light, saved for good.',
      'Light a level before trying Rock Smash or Strength there.',
    ],
    moves: ['flash'], items: ['hmflash'], maps: [CAVES, UPPER, UNDER], npcs: [ALDER], requires: ['HM05 Flash'],
    source: [FIELD, MAPS],
  },
  {
    id: 'field:rocksmash', title: 'Rock Smash: break cracked rocks', category: 'hm', stage: 6, order: 6,
    steps: [
      'Needs HM06 Rock Smash (Kalos Champion Diantha).',
      'Stand next to a cracked rock and use it. The rock stays gone until 00:00 UTC.',
      'Found in Caves, Upper Caves, Underground, Volcano, Dragon\'s Reach and the Safari Zone. The rock in the narrow east passage at the south end of Dragon\'s Reach leads to the Sealed Roost.',
    ],
    moves: ['rocksmash'], items: ['hmrocksmash'], maps: [CAVES, UPPER, UNDER, VOLCANO, DRAGON, SAFARI], npcs: [DIANTHA], requires: ['HM06 Rock Smash'],
    source: [FIELD],
  },
  {
    id: 'field:waterfall', title: 'Waterfall: climb to Crown Pool', category: 'hm', stage: 7, order: 6,
    steps: [
      'Needs HM07 Waterfall (Alola Champion Hau).',
      'Climb the waterfall in Hidden Cove (The Blue Sea 5) to reach Crown Pool (The Blue Sea 7).',
      'Partner Scuba Gear lies on Crown Pool\'s western beach – it lets your partner follow you underwater.',
    ],
    moves: ['waterfall'], items: ['hmwaterfall'], maps: [SEA], npcs: [HAU], requires: ['HM07 Waterfall'],
    source: [FIELD],
  },
  {
    id: 'field:dive', title: 'Dive: go underwater', category: 'hm', stage: 8, order: 6,
    steps: [
      'Needs HM08 Dive (Galar Champion Leon), Devon Scuba Gear in your Bag, and Surf to reach deep water.',
      'Stand on a marked dark spot in The Blue Sea and choose Dive. Lit openings on the seabed bring you back up.',
      'Devon Scuba Gear is hidden in The Blue Sea – follow the Dowsing Machine\'s signal.',
    ],
    moves: ['dive'], items: ['hmdive', 'devonscubagear', 'dowsingmachine'], maps: [SEA, DEEP], npcs: [LEON], requires: ['HM08 Dive', 'Devon Scuba Gear', 'HM03 Surf'],
    source: [FIELD, MAPS],
  },
  {
    id: 'field:dig', title: 'Dig: the buried Silph Scope', category: 'hm', stage: 0, order: 6,
    steps: [
      'Dig needs no HM – any team Pokémon that knows Dig can use it on the map.',
      'In Forgotten Plots (Graveyard 3), stand between the headstones where something seems buried, use Dig, then pick up the Silph Scope.',
      'The Graveyard is only open at night (18:00–06:00 UTC).',
      'TM55 Dig shows up in map chest loot (see "Map chest loot").',
    ],
    moves: ['dig'], items: ['silphscope', 'tmdig'], maps: [GRAVE], requires: ['A team Pokémon that knows Dig'],
    source: [FIELD, MAPS, { kind: 'data', ref: 'items[tmdig].mapItemSource' }], keywords: ['silph scope', 'ghost'],
  },
  {
    id: 'field:teleport', title: 'Teleport: travel inside caves too', category: 'hm', stage: 0, order: 7,
    steps: [
      'Teleport needs no HM. It moves you to a part of the current map you already visited, including caves and buildings.',
      'It can\'t discover new places or change maps. Select it under Team → Moves without changing your Starter.',
    ],
    moves: ['teleport'], source: [FIELD, MAPS],
  },

  /* ---------- Map unlocks ---------- */
  {
    id: 'map:dark-forest', title: 'Find Dark Forest', category: 'maps', stage: 0, order: 10,
    steps: ['In Grasslands 3, walk west behind the tree-crown wall to reach Dark Forest 6.'],
    maps: [GRASS, DARK], source: [MAPS],
  },
  {
    id: 'map:mt-ember', title: 'Find Mt. Ember and Volcano', category: 'maps', stage: 0, order: 11,
    steps: [
      'The cave in the top-left of Dark Forest 1 leads to Mt. Ember.',
      'Climb Mt. Ember to the crater cave – it takes you into Volcano 6.',
    ],
    maps: [DARK, EMBER, VOLCANO], source: [MAPS],
  },
  {
    id: 'map:violet-town', title: 'Find Violet Town and Fairy Meadow', category: 'maps', stage: 0, order: 12,
    steps: [
      'Dark Forest 5\'s southern gate leads to Violet Town 1.',
      'From Violet Town 3, follow the eastern path into Fairy Meadow 1.',
    ],
    maps: [DARK, VIOLET, FAIRY], source: [MAPS],
  },
  {
    id: 'map:graveyard', title: 'Enter the Graveyard (night only)', category: 'maps', stage: 0, order: 13,
    steps: [
      'At night (18:00–06:00 UTC), go through the gate below the Dragonair statue in Violet Town 5.',
      'At daybreak you are sent back to Grasslands.',
      'Ghosts there stay "unidentified" (you can only leave) until you own the Silph Scope.',
    ],
    maps: [VIOLET, GRAVE], items: ['silphscope'], source: [MAPS], keywords: ['night', 'ghost'],
  },
  {
    id: 'map:power-plant', title: 'Find the Power Plant', category: 'maps', stage: 0, order: 14,
    steps: ['Walk into the Power Plant building in south-western Grasslands.'],
    maps: [GRASS, PLANT], source: [MAPS],
  },
  {
    id: 'map:blue-sea', title: 'Find The Blue Sea', category: 'maps', stage: 3, order: 10,
    steps: ['With Surf, ride north along the river in north-eastern Grasslands.'],
    maps: [GRASS, SEA], items: ['hmsurf'], npcs: [WALLACE], requires: ['HM03 Surf'], source: [MAPS],
  },
  {
    id: 'map:caves', title: 'Unlock the Caves', category: 'maps', stage: 4, order: 10,
    steps: [
      'Defeat Sinnoh Champion Cynthia.',
      'Talk to the cave guard on the raised lookout in north-west Grasslands 7; he steps aside and the Caves shortcut appears.',
      'Upper Caves sit above the main rooms; ladders near the south edge of the Caves (west or east chamber) go down to the Underground.',
      'Use Flash on each level first.',
    ],
    maps: [GRASS, CAVES, UPPER, UNDER], npcs: [CYNTHIA], requires: ['Defeat Sinnoh Champion Cynthia'], source: [MAPS],
  },
  {
    id: 'map:sky-islands', title: 'Find Sky Islands', category: 'maps', stage: 2, order: 10,
    steps: ['In south-eastern Volcano, go right through the doorway in the east wall to an encounter-free ledge, then use Fly there.'],
    maps: [VOLCANO, EDGE, SKY], items: ['hmfly'], npcs: [LANCE], requires: ['HM02 Fly'], source: [MAPS, FIELD],
  },
  {
    id: 'map:dragons-reach', title: 'Unlock Dragon\'s Reach', category: 'maps', stage: 5, order: 10,
    steps: ['Defeat Unova Champion Alder, then talk to the eastern guard in Fairy Meadow 4 and walk east.'],
    maps: [FAIRY, DRAGON], npcs: [ALDER], requires: ['Defeat Unova Champion Alder'], source: [MAPS],
  },
  {
    id: 'map:unown-ruins', title: 'Open the Unown Ruins', category: 'maps', stage: 5, order: 11,
    steps: [
      'Get the Explorer Kit (Underground, location changes daily).',
      'In Dragon\'s Reach, inspect all four wardstones with the Kit.',
      'Mine the cracked wall on the north edge of Dragon\'s Reach, west of the lava, and walk north into the ruins.',
      'All Unown are Extremely Rare; each chamber holds different letters.',
    ],
    maps: [DRAGON, RUINS], items: ['miningpickaxe'], requires: ['Explorer Kit', 'Dragon\'s Reach unlocked'], source: [MAPS, P('#/maps/legendary-spawns')],
  },
  {
    id: 'map:snow-mountain', title: 'Unlock Snow Mountain', category: 'maps', stage: 10, order: 10,
    steps: ['Defeat Paldea Champion Geeta, then walk north through the snowy opening in Fairy Meadow 5.'],
    maps: [FAIRY, SNOW], npcs: [GEETA], requires: ['Defeat Paldea Champion Geeta'], source: [MAPS],
  },
  {
    id: 'map:underwater', title: 'Reach the Underwater map', category: 'maps', stage: 8, order: 10,
    steps: [
      'Get the Dowsing Machine (The Void, far north-west or north-east platform; it moves daily).',
      'Follow its signal in The Blue Sea to the Devon Scuba Gear.',
      'Use Dive on a marked dark spot in The Blue Sea.',
    ],
    maps: [VOID, SEA, DEEP], items: ['dowsingmachine', 'devonscubagear', 'hmdive'], npcs: [LEON], requires: ['HM08 Dive', 'Devon Scuba Gear', 'HM03 Surf'], source: [MAPS, FIELD],
  },
  {
    id: 'map:void', title: 'Enter The Void', category: 'maps', order: 15,
    steps: [
      'Have Giratina on your team and interact with the portal in the middle of Graveyard 1.',
      'Keep Giratina on your team to explore The Void; its portal leads back to the Graveyard while it is open.',
      'Giratina itself spawns in the Graveyard.',
    ],
    maps: [GRAVE, VOID], species: [487], requires: ['Giratina on your team'], source: [MAPS],
  },
  {
    // Path placement is ours: the ticket drops on starting-area maps, so it fits the first stage.
    id: 'map:safari', title: 'Get into the Safari Zone', category: 'maps', stage: 0, order: 16,
    steps: [
      'You need a Safari Ticket in your Bag (a held ticket does not count). Wild Pokémon in Grasslands, Dark Forest, Violet Town and Fairy Meadow sometimes hold one (1 in 200); it can also be bought on the Market.',
      'Use the ticket from your Bag to travel to the gate, or Surf along the southern river past Grasslands 4.',
      'One visit = 500 steps and 30 Safari Balls; leaving ends it.',
    ],
    maps: [GRASS, LANDING, SAFARI], items: ['safariticket'], source: [P('#/activities/safari')],
  },

  /* ---------- Catching ---------- */
  {
    id: 'catch:kecleon', title: 'Find the hidden Kecleon', category: 'catching', order: 20,
    steps: [
      'Needs the Silph Scope. In Violet Town, normal walking steps can reveal a faint Kecleon nearby (1 in 2,000 per step).',
      'Walk – don\'t run – next to it to start the encounter. Running from it or leaving Violet Town makes it disappear, and going back to its tile will not bring it back.',
    ],
    maps: [VIOLET], items: ['silphscope'], species: [352], requires: ['Silph Scope'], source: [MAPS],
  },
  {
    id: 'catch:starter-ability', title: 'Use your Starter\'s Ability to steer spawns', category: 'catching', stage: 0, order: 21,
    steps: [
      'Only your Starter (first non-Egg team slot) counts.',
      'Type-luring Abilities (Static for Electric, Flash Fire for Fire, Swarm for Bug, Keen Eye for Flying, Sweet Veil for Fairy, and more) give a 25% chance to pick that type inside the rarity already rolled.',
      'Synchronize: 10% chance the wild Pokémon copies its Nature. Cute Charm: 10% chance of the opposite gender.',
      'Compound Eyes / Super Luck raise ordinary wild held-item odds; Suction Cups / Sticky Hold give 6 s instead of 5 to reel in.',
      'Shiny odds never change.',
    ],
    source: [P('#/abilities/overworld')], keywords: ['ability', 'synchronize', 'nature', 'type'],
  },
  {
    id: 'catch:legendary-rules', title: 'How Legendary spawns unlock', category: 'catching', order: 22,
    steps: [
      'A Legendary needs a win over the Champion of its own home region – not the map\'s region, and badges alone do not count.',
      'Each eligible Legendary has its own 1 in 5,000 chance per encounter roll; unlocking more never lowers the others.',
      'Spawn items (orbs, wings, stones, DNA) work from your Bag or an active team holder and are used up when the Pokémon appears, even if it escapes.',
      'Search a Legendary\'s name here for its exact requirement.',
    ],
    source: [P('#/maps/legendary-spawns')], keywords: ['legendary', 'ultra beast'],
  },
  {
    id: 'catch:swarms', title: 'Honey and swarms', category: 'catching', order: 23,
    steps: [
      'Each Honey use has a 1 in 10 chance to start a 10-minute swarm shared by everyone on that numbered map part.',
      'The swarm Pokémon gets an extra 1 in 20 chance on encounters across the whole part – the sprites on the map are only markers.',
    ],
    items: ['honey'], source: [P('#/activities/swarms')], keywords: ['honey', 'swarm'],
  },
  {
    id: 'catch:fishing', title: 'Fishing basics', category: 'catching', stage: 1, order: 24,
    steps: [
      'Face open water with a rod in Key Items and cast. When the "!" appears you have 5 seconds to reel in.',
      'Moving cancels the cast. Reeling in starts an encounter – you still have to catch it.',
      'Each rod has one pool shared by every fishing spot.',
    ],
    items: ['oldrod', 'goodrod', 'superrod'], npcs: ['challenge:misty'], source: [P('#/activities/fishing')], keywords: ['fish', 'rod'],
  },
  {
    id: 'catch:quest-pokemon', title: 'Porygon and Ditto come from quests', category: 'catching', order: 25,
    steps: [
      'Evolution Research quest: 25 evolutions after taking it → a level-1 Porygon.',
      'Hatching quest: hatch 25 Eggs from at least 5 different evolution families → a level-1 Ditto.',
      'Neither Pokémon spawns in the wild.',
    ],
    species: [137, 132], source: [P('#/activities/quests')], keywords: ['porygon', 'ditto', 'quest'],
  },

  /* ---------- Battling ---------- */
  {
    id: 'battle:rematches', title: 'Unlock League rematches', category: 'battling', order: 30,
    steps: [
      'Clear a region\'s whole League (full badge path, Elite Four, final opponent) to unlock its stronger rematch teams.',
      'Galar has no Elite Four and accepts either leader at each alternative Gym; Alola needs no badges – just its Elite Four and Hau.',
      'Rematches have no level cap. Toggle "Show rematches" on the League page.',
    ],
    source: [P('#/challenges/league-rematches')], keywords: ['rematch'],
  },
  {
    id: 'battle:rivals', title: 'Unlock Rival battles', category: 'battling', order: 31,
    steps: [
      'Win every League rematch in a region; its rivals then appear in Explore.',
      'They keep the same map but move daily at 00:00 UTC. Talk to one and accept the invitation – it is permanent.',
      'Rival teams are six level-120 Pokémon.',
    ],
    source: [P('#/challenges/rivals')], keywords: ['rival'],
  },
  {
    id: 'battle:rocket', title: 'Rocket\'s Hideout', category: 'battling', stage: 1, order: 5,
    steps: [
      'Unlocked by your own win over Kanto Champion Blue.',
      'Nine battles in a row with one team and no automatic healing (levels about 72 to 100).',
      'A full clear has a 5% chance for Mewtwo DNA.',
    ],
    npcs: [BLUE], items: ['mewtwodna'], requires: ['Defeat Kanto Champion Blue'], source: [P('#/challenges/rockets-hideout')], keywords: ['rocket', 'mewtwo'],
  },
  {
    id: 'battle:frontier', title: 'Battle Frontier', category: 'battling', stage: 3, order: 5,
    steps: [
      'Unlocked by defeating Hoenn Champion Wallace.',
      'Seven facilities with Generation III rules; most take three of your own Pokémon (Factory uses rentals).',
      'Earn Battle Points and silver/gold Symbols.',
    ],
    npcs: [WALLACE], requires: ['Defeat Hoenn Champion Wallace'], source: [P('#/challenges/battle-frontier')], keywords: ['frontier', 'bp'],
  },
  {
    id: 'battle:mega', title: 'Mega Chambers and Mega Energy', category: 'battling', stage: 6, order: 5,
    steps: [
      'Needs the Mega Bracelet (Kalos Champion Diantha; past winners beat her again to claim it).',
      'Each attempt costs 1,000 Mega Energy for that chamber. Energy comes from Pokémon of the matching family: hatch +100, evolve +50, each level +5, catch +2.',
      'Win three battles for one matching Mega Stone. The Bracelet also allows permanent Mega Evolution from My Pokémon.',
    ],
    npcs: [DIANTHA], items: ['megabracelet'], requires: ['Mega Bracelet'], source: [P('#/challenges/mega-chambers')], keywords: ['mega'],
  },
  {
    id: 'battle:world-boss', title: 'World Boss Battles', category: 'battling', stage: 8, order: 5,
    steps: [
      'Needs the Dynamax Band (Galar Champion Leon; past winners beat him again).',
      'A shared boss appears every hour with 10 minutes to beat it.',
      'Deal at least 25,000 damage and help win, then claim your rewards.',
    ],
    npcs: [LEON], items: ['dynamaxband'], requires: ['Dynamax Band'], source: [P('#/challenges/world-bosses')], keywords: ['world boss', 'raid'],
  },

  /* ---------- Daily / weekly ---------- */
  {
    id: 'daily:quests', title: 'Daily and weekly quests', category: 'daily', stage: 0, order: 30,
    steps: [
      'Choose Get quest first – progress only counts after you take the quest.',
      'You start with 2 daily + 2 weekly slots; Starter Tasks add a 3rd of each, more can be bought.',
      'A daily slot refills 5 hours after you finish (claim first). Unfinished weekly quests expire Monday 00:00 UTC; finished rewards wait for you.',
      'Rerolling an unfinished quest costs 10,000 (daily) or 50,000 (weekly) Pokécoins and resets its progress.',
    ],
    source: [P('#/activities/quests')], keywords: ['quest'],
  },
  {
    id: 'daily:catchlist', title: 'Weekly Catchlist', category: 'daily', stage: 0, order: 31,
    steps: [
      'Play → Catchlist: catch all 100 targets, each with the exact ball shown. Shiny catches count; old catches, trades and evolutions don\'t.',
      'Claim before Monday 00:00 UTC (make room first) for a Galarian, a Hisuian and an Alolan form plus supplies.',
      'Mythical Pokémon only come as a Catchlist event bonus.',
    ],
    source: [P('#/activities/catchlist')], keywords: ['catchlist', 'weekly', 'mythical'],
  },
  {
    id: 'daily:underground', title: 'Daily Underground routine', category: 'daily', stage: 4, order: 30,
    steps: [
      'The Explorer Kit sits at a shared spot in the Underground that changes at 00:00 UTC; once claimed it is yours for good.',
      'On a lit floor, mine sparkling walls: up to 20 walls per UTC day, at most two in each of ten sectors. Starting a wall uses it up.',
      'Hikers in the Underground trade TMs and other items for Spheres you mine.',
    ],
    maps: [UNDER], items: ['miningpickaxe'], requires: ['Caves unlocked'], source: [MAPS], keywords: ['mining', 'sphere'],
  },
];
