import { activeFainted, type BattleBagItem, type BattleField, type BattleEvent, type EventHit, type BattleMon, type BattleMove, type BattleSnapshot, type BoostKey, type Boosts, type RosterMon } from '../shared/battle';

/**
 * Reads the PokeMeowRPG battle screen into a BattleSnapshot. Pure and read-only:
 * it never writes to the DOM, clicks or fetches. Every selector lives in SEL, so a
 * game UI change only needs edits here (see tests/battleReader.test.ts).
 */
export const SEL = {
  arena: '.battle-arena',
  opponentName: '.battle-title-name',
  turn: '.battle-turn',
  playerStats: '.battle-player-stats',
  opponentStats: '.battle-opponent-stats',
  name: '.battle-combatant-name',
  level: '.battle-pokemon-level',
  hp: '.battle-hp-numbers',
  status: '[data-status]',
  item: '.battle-held-item',
  moveButton: '.battle-move-button',
  switchCard: '.battle-switch-card',
  switchButton: '.battle-switch-button',
  switchMovePp: '.battle-switch-move-pp',
  rosterRow: '.battle-opponent-roster li',
  rosterHeading: '.battle-opponent-row-heading',
  rosterHealth: '.battle-opponent-row-health',
  logLine: '.battle-log > li',
  logTurn: '.battle-log-turn',
  /** On-screen stat stages next to the name, e.g. <span class="battle-status battle-stat-changes" title="Evasion +1">. */
  statChanges: '.battle-stat-changes',
  /**
   * One Showdown-style tag per stat inside statChanges (real save 2026-11-22):
   * <span class="battle-stat-change" data-direction="down" aria-label="Sp. Def -2">0.5× SpD</span>.
   */
  statChange: '.battle-stat-change',
  /** Fainted badge next to the level (real save 2026-11-22): <span class="battle-status battle-status-fnt"><img alt="Fainted"></span>. */
  faintedBadge: '.battle-status-fnt',
  /**
   * Weather / terrain buttons beside the turn counter. GUESS from the game's stylesheet only
   * (`.battle-field-row`, `.battle-field-status`, `.battle-field-effect`); no save had a field effect yet,
   * so any `.battle-field-effect` in the arena counts, wherever it sits.
   */
  fieldEffect: '.battle-field-effect',
  /** Weather art over the scene (stylesheet: `.battle-weather-visual[data-weather=raindance]`). Not seen live. */
  weatherVisual: '.battle-weather-visual[data-weather]',
  log: '.battle-log',
  /** Items tab. Panel and class `.battle-bag` seen live 2026-11-18; the entry markup is read tolerantly (see readBattleBag). */
  bag: '.battle-team-bag-panel .battle-bag, .battle-bag',
  bagEntry: '.battle-bag-item, [data-item-id], [data-battle-item], li',
  bagName: '.battle-bag-item-name, .battle-item-name, [data-item-name]',
  bagCount: '.battle-bag-item-count, .battle-item-count, [data-count]',
  /** Doubles (seen live 2026-11-19): one card per field position inside each side's stats box. */
  activeCard: '.double-active-card',
  positionLabel: '.double-position-label',
  /** "Choose for Slowbro · Position 1" above the moves of the position being chosen. */
  commandHeading: '.double-command-heading',
  /**
   * World Boss raid screen (seen live 2026-11-23, tests/fixtures/worldboss/raid-turn1.live.html): no
   * `.battle-arena`. The boss is in `section.world-boss-hero` (name, "5,929,910 / 10,000,000 HP", status,
   * `.world-boss-stages` stat tags); your side is `.world-boss-combat` with the usual `.battle-combatant-player`,
   * move buttons, switch cards and battle log.
   */
  bossHero: 'section.world-boss-hero',
  bossCombat: '.world-boss-combat',
  bossName: 'h2 [class^="pokemon-name"], h2 .world-boss-next-name, h2',
  bossHp: '.world-boss-hp-count',
  bossStages: '.world-boss-stages',
  playerCombatant: '.battle-combatant-player',
} as const;

/** Seen live (Drake, 2026-11-18) after your Pokémon fainted. Matched as text: its markup is not known yet. */
const NEXT_PROMPT = /choose your next pok[eé]mon/i;
/**
 * Badge next to a fainted Pokémon's level: `.battle-status-fnt` (an image, real save 2026-11-22),
 * else an element reading just "FNT" (older screen).
 */
const hasFntBadge = (root: Element | null) =>
  !!root && (!!root.querySelector(SEL.faintedBadge) || [...root.querySelectorAll('*')].some((e) => clean(e.textContent) === 'FNT'));

/** The "Choose your next Pokémon" prompt anywhere in the arena except the battle log. Read-only: works on a detached copy. */
export function hasNextPrompt(arena: Element): boolean {
  if (!NEXT_PROMPT.test(arena.textContent ?? '')) return false;
  const copy = arena.cloneNode(true) as Element;
  copy.querySelectorAll(SEL.log).forEach((l) => l.remove());
  return NEXT_PROMPT.test(copy.textContent ?? '');
}

/** Integer from text; the game writes large numbers with commas ("1,234"). */
const num = (s?: string | null) => {
  const n = s ? parseInt(s.replace(/,/g, ''), 10) : NaN;
  return Number.isFinite(n) ? n : undefined;
};
const clean = (s?: string | null) => (s ?? '').replace(/\s+/g, ' ').trim();

/** "43/43 HP", "43 / 43 HP", "45 of 45 HP", "1,020/1,020 HP" */
export function parseHp(text: string): { hp?: number; maxHp?: number } {
  const m = text.match(/(\d[\d,]*)\s*(?:\/|of)\s*(\d[\d,]*)\s*HP/i);
  return m ? { hp: num(m[1]), maxHp: num(m[2]) } : {};
}

/**
 * Pokémon name inside a name/heading element. Seen in-game: the name sits in a child element
 * next to a gender label ("Male"/"Female") and buttons (capture ball, weaknesses), so read every
 * visible text node and drop gender, level and state words.
 */
export function monName(el: Element | null): string {
  if (!el) return '';
  const parts: string[] = [];
  const walk = (n: Node) => {
    if (n.nodeType === 3) {
      parts.push(n.textContent ?? '');
      return;
    }
    if (n.nodeType !== 1) return;
    const e = n as Element;
    // Skip buttons/icons and the badges next to the name: level, status, stat changes ("Evasion +1").
    if (e.matches(`button, [aria-hidden="true"], [role="img"], svg, ${SEL.level}, ${SEL.statChanges}, .battle-status`)) return;
    e.childNodes.forEach(walk);
  };
  // Live markup: <strong title="Kingdra">Kingdra…</strong> holds the name.
  const titled = el.querySelector('strong[title]')?.getAttribute('title')?.trim();
  if (titled) return titled;
  el.childNodes.forEach(walk);
  return clean(parts.join(' '))
    .replace(/\bLv\.?\s*\d+/gi, ' ')
    .replace(/\b(Male|Female|Active|Fainted)\b|[♂♀]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function readCombatant(root: Element | null, position?: number): BattleMon | undefined {
  if (!root) return undefined;
  const name = monName(root.querySelector(SEL.name));
  if (!name) return undefined;
  const statusEl = root.querySelector(SEL.status);
  const itemLabel = root.querySelector(SEL.item)?.getAttribute('aria-label') ?? '';
  const item = itemLabel.match(/Held item:\s*([^.]+)/i)?.[1]?.trim();
  // One tag per stat (new markup: signed aria-label, else the "0.5× SpD" text), else the older badge title.
  // Unparsed text gives undefined, so the log's stages are used instead.
  const tags = [...root.querySelectorAll(SEL.statChange)];
  const changes = tags.length
    ? tags.map((t) => t.getAttribute('aria-label') || t.getAttribute('title') || t.textContent || '').join(', ')
    : [...root.querySelectorAll(SEL.statChanges)].map((c) => c.getAttribute('title') || c.textContent || '').join(', ');
  const stages = changes ? parseStatChanges(changes) : undefined;
  return {
    name,
    level: num(root.querySelector(SEL.level)?.textContent?.match(/(\d+)/)?.[1]),
    ...parseHp(root.querySelector(SEL.hp)?.textContent ?? ''),
    status: statusEl?.getAttribute('data-status') || (root.querySelector(SEL.faintedBadge) ? 'fnt' : undefined),
    item,
    stages: stages && Object.keys(stages).length ? stages : undefined,
    ...(position ? { position } : {}),
  };
}

/** Doubles: one card per field position inside the side's stats box ("Position 2", "Opponent 1"). */
function readActives(stats: Element | null): BattleMon[] {
  if (!stats) return [];
  return [...stats.querySelectorAll(SEL.activeCard)]
    .map((card, i) => readCombatant(card, num(card.querySelector(SEL.positionLabel)?.textContent?.match(/(\d+)/)?.[1]) ?? i + 1))
    .filter((m): m is BattleMon => !!m);
}

/**
 * "Evasion +1" (seen live), also "Attack +2, Speed -1" style lists, and the Showdown-style
 * multiplier tags ("2× Def", "0.5× SpD", real save 2026-11-22) turned back into stages.
 */
export function parseStatChanges(text: string): Boosts {
  const out: Boosts = {};
  for (const m of text.matchAll(/([A-Za-z. ]+?)\s*([+\-−]\s*\d)/g)) {
    const key = STAT_WORDS.find(([re]) => re.test(m[1]))?.[1];
    if (key) out[key] = parseInt(m[2].replace('−', '-').replace(/\s/g, ''), 10);
  }
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s*[×x]\s*([A-Za-z. ]+)/g)) {
    const key = STAT_WORDS.find(([re]) => re.test(m[2]))?.[1];
    if (!key || key in out) continue; // a signed label for the same stat wins
    const stage = stageFromMultiplier(parseFloat(m[1]), key);
    if (stage !== undefined && stage !== 0) out[key] = stage;
  }
  return out;
}

/**
 * Stage for a shown multiplier: (2+s)/2 and 2/(2-s) for Atk/Def/SpA/SpD/Spe (1.5×=+1 … 4×=+6,
 * 0.67×=-1 … 0.25×=-6), (3+s)/3 and 3/(3-s) for accuracy/evasion (1.33×=+1, 0.75×=-1 …).
 * The tag rounds (0.67, 0.33, 0.29), so the nearest stage within 0.03 wins.
 */
export function stageFromMultiplier(mult: number, key: BoostKey): number | undefined {
  const base = key === 'accuracy' || key === 'evasion' ? 3 : 2;
  let best: number | undefined;
  let gap = 0.03;
  for (let s = -6; s <= 6; s++) {
    const v = s >= 0 ? (base + s) / base : base / (base - s);
    if (Math.abs(v - mult) <= gap) [best, gap] = [s, Math.abs(v - mult)];
  }
  return best;
}

/** "Fairy Wind · Fairy · Special · Power 40 · Accuracy 100% · 30/30 PP. No additional effect." */
export function parseMoveLabel(label: string): Omit<BattleMove, 'disabled'> {
  // Doubles screen (seen live 2026-11-19): "Surf, Water, Special, 15 of 15 PP" (no power/accuracy).
  if (!label.includes('·')) {
    const c = label.match(/^(.+?),\s*([A-Za-z]+),\s*(Physical|Special|Status),\s*(\d+)\s*of\s*(\d+)\s*PP/);
    if (c) return { name: c[1].trim(), type: c[2], category: c[3] as BattleMove['category'], power: undefined, accuracy: undefined, pp: num(c[4]), maxPp: num(c[5]) };
  }
  const head = label.split(/ PP\b/)[0];
  const parts = head.split('·').map((s) => s.trim());
  const cat = parts.find((p) => /^(Physical|Special|Status)$/.test(p)) as BattleMove['category'];
  const pp = label.match(/(\d+)\s*\/\s*(\d+)\s*PP/);
  return {
    name: parts[0],
    type: parts[1] && !/^(Physical|Special|Status)$/.test(parts[1]) ? parts[1] : undefined,
    category: cat,
    power: num(label.match(/Power (\d+)/)?.[1]),
    accuracy: num(label.match(/Accuracy (\d+)%/)?.[1]),
    pp: num(pp?.[1]),
    maxPp: num(pp?.[2]),
  };
}

export function readMoves(doc: ParentNode): BattleMove[] {
  return [...doc.querySelectorAll(SEL.moveButton)].map((b) => {
    const parsed = parseMoveLabel(b.getAttribute('aria-label') ?? clean(b.textContent));
    // Greyed-out, crossed-out moves carry data-unavailable="true" (game stylesheet 2026-11; not in a save yet).
    const disabled = b.hasAttribute('disabled') || b.getAttribute('aria-disabled') === 'true' || b.getAttribute('data-unavailable') === 'true'
      || b.closest('[data-no-pp="true"]') !== null || parsed.pp === 0;
    return { ...parsed, disabled };
  });
}

export function readBench(doc: ParentNode): RosterMon[] {
  return [...doc.querySelectorAll(SEL.switchCard)].map((card) => {
    const label = card.querySelector(SEL.switchButton)?.getAttribute('aria-label') ?? '';
    // Doubles (seen live 2026-11-19): label "Send out Slowbro. Choose a healthy reserve Pokémon.",
    // with <strong>Slowbro · Lv. 45</strong><small>120/144 HP · Active</small> inside the button.
    if (/^Send out\s/i.test(label)) return readSendOutCard(card, label);
    // "Active: Cottonee, level 19, 45 of 45 HP, …" / "Switch to Timburr, level 16, 51 of 51 HP"
    const name = clean(label.replace(/^(Active:|Switch to)\s*/i, '').split(',')[0]);
    const moves = [...card.querySelectorAll(SEL.switchMovePp)].map((pp) => {
      const parent = pp.parentElement;
      const moveName = clean((parent?.textContent ?? '').replace(pp.textContent ?? '', ''));
      const m = (pp.textContent ?? '').match(/(\d+)\s*\/\s*(\d+)/);
      return { name: moveName, pp: num(m?.[1]), maxPp: num(m?.[2]) };
    }).filter((m) => m.name);
    return {
      name,
      level: num(label.match(/level (\d+)/i)?.[1]),
      ...parseHp(label),
      active: /^Active:/i.test(label),
      fainted: card.getAttribute('data-fainted') === 'true' || /fainted/i.test(label),
      moves: moves.length ? moves : undefined,
    };
  }).filter((r) => r.name);
}

function switchCardMoves(card: Element): RosterMon['moves'] {
  const moves = [...card.querySelectorAll(SEL.switchMovePp)].map((pp) => {
    const parent = pp.parentElement;
    const moveName = clean((parent?.textContent ?? '').replace(pp.textContent ?? '', ''));
    const m = (pp.textContent ?? '').match(/(\d+)\s*\/\s*(\d+)/);
    return { name: moveName, pp: num(m?.[1]), maxPp: num(m?.[2]) };
  }).filter((m) => m.name);
  return moves.length ? moves : undefined;
}

function readSendOutCard(card: Element, label: string): RosterMon {
  const button = card.querySelector(SEL.switchButton);
  const head = clean(button?.querySelector('strong')?.textContent);
  const info = clean(button?.querySelector('small')?.textContent);
  const name = clean(head.split(/\s·\s*Lv\.?/i)[0]) || clean(label.replace(/^Send out\s+/i, '').replace(/\.\s.*$/, ''));
  return {
    name,
    level: num(head.match(/Lv\.?\s*(\d+)/i)?.[1]),
    ...parseHp(info),
    active: /\bActive\b/i.test(info),
    fainted: card.getAttribute('data-fainted') === 'true' || /faint/i.test(info),
    moves: switchCardMoves(card),
  };
}

function readOpponentTeam(doc: ParentNode): RosterMon[] {
  return [...doc.querySelectorAll(SEL.rosterRow)].map((row) => {
    const heading = row.querySelector(SEL.rosterHeading);
    const name = monName(heading);
    return {
      name,
      level: num(clean(heading?.textContent).match(/Lv\.?\s*(\d+)/i)?.[1]),
      // Without a health element, drop the heading first: "Lv. 41" + "0/112 HP" would read as 410/112.
      ...parseHp(clean(row.querySelector(SEL.rosterHealth)?.textContent ?? (row.textContent ?? '').replace(heading?.textContent ?? '', ' '))),
      active: row.getAttribute('data-active') === 'true',
      fainted: row.getAttribute('data-fainted') === 'true',
    };
  }).filter((r) => r.name);
}

/** Long log wording ("Defense fell") and the short badge labels seen live ("Def -2", "Evasion +1"). */
const STAT_WORDS: [RegExp, BoostKey][] = [
  [/special attack|sp\.? ?atk|\bspa\b/i, 'spa'],
  [/special defen[cs]e|sp\.? ?def|\bspd\b/i, 'spd'],
  [/attack|\batk\b/i, 'atk'],
  [/defen[cs]e|\bdef\b/i, 'def'],
  [/speed|\bspe\b/i, 'spe'],
  [/accuracy|\bacc\b/i, 'accuracy'],
  [/evasion|evasiveness|\beva\b/i, 'evasion'],
];

/**
 * Stage change in one log line, mainline wording (seen in-game: "Your Timburr's Defense
 * fell harshly!", "Your Turtwig's Speed fell!"). Returns null when the line has none.
 */
export function parseBoostLine(text: string, who: Who = {}): { side: 'player' | 'opponent'; mon: string; stats: BoostKey[]; delta: number } | null {
  const subj = splitSubject(text, who);
  if (!subj) return null;
  // Belly Drum / Anger Point (new in the 2026-11 log; exact wording is a GUESS from mainline):
  // "Snorlax cut its own HP and maximized its Attack!", "Primeape maximized its Attack!".
  const max = subj.rest.match(/^(.+?)\s+(?:cut its own HP and\s+)?maximized its\s+(.+?)!/i);
  if (max) {
    const side = resolveSide(subj, max[1], who);
    const stat = STAT_WORDS.find(([re]) => re.test(max[2]))?.[1];
    // +12 clamps to +6 whatever the stage was.
    return side && stat ? { side, mon: max[1].trim(), stats: [stat], delta: 12 } : null;
  }
  const m = subj.rest.match(/^(.+?)[’']s\s+(.+?)\s+(rose|fell)(?:\s+(sharply|harshly|drastically|severely))?!/i);
  if (!m) return null;
  const side = resolveSide(subj, m[1], who);
  if (!side) return null;
  const stats: BoostKey[] = [];
  for (const chunk of m[2].split(/,|\band\b/)) {
    const hit = STAT_WORDS.find(([re]) => re.test(chunk));
    if (hit && !stats.includes(hit[1])) stats.push(hit[1]);
  }
  if (!stats.length) return null;
  const size = /drastically|severely/i.test(m[4] ?? '') ? 3 : m[4] ? 2 : 1;
  return { side, mon: m[1].trim(), stats, delta: /rose/i.test(m[3]) ? size : -size };
}

/** A line where a side sends in a new Pokémon (its stat stages start fresh). */
export function switchSide(text: string): 'player' | 'opponent' | null {
  if (/^Go,\s/i.test(text)) return 'player';
  if (/\bsent out\b/i.test(text)) return 'opponent';
  if (WORLD_BOSS_IN.test(text)) return 'opponent';
  return null;
}

/** Name of the Pokémon sent in: "Go, Turtwig!" / "Brock sent out Onix!" / "World Boss GMAX Rillaboom appeared!" */
export function switchedIn(text: string): string | undefined {
  return (text.match(/^Go,\s+(.+?)!/i) ?? text.match(/\bsent out\s+(.+?)!/i) ?? text.match(WORLD_BOSS_IN))?.[1]?.trim();
}

/** "World Boss GMAX Rillaboom appeared!" (World Boss log, seen live 2026-11-23). */
const WORLD_BOSS_IN = /^World Boss\s+(.+?)\s+appeared!/i;

/** The raid screen says "GMAX Rillaboom"; the wiki data (and so the NPC) says "Gigantamax Rillaboom". */
export const wikiBossName = (s: string) => s.replace(/(^|\s)G-?MAX\s+(?=\S)/g, '$1Gigantamax ');

/** Who is battling: the opponent trainer's name and each side's active Pokémon (from the log so far). */
export interface Who {
  trainer?: string;
  active?: { player?: string; opponent?: string };
  /** Every name seen on each side so far (lower-cased): doubles has two active per side. */
  seen?: { player: Set<string>; opponent: Set<string> };
}
type Side = 'player' | 'opponent';
const lcName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Splits off who a log line is about. The game has used two wordings (both seen live 2026-11-18):
 *   old: "Your Gloom used…", "Opponent’s Voltorb used…"
 *   new: "Gloom used…" (yours, no prefix), "Lt. Surge’s Voltorb used…" (trainer's name)
 * side is undefined for a bare name: resolveSide() decides from the active Pokémon.
 */
export function splitSubject(text: string, who: Who = {}): { side?: Side; rest: string } | null {
  let m = text.match(/^Your\s+(.*)$/i);
  if (m) return { side: 'player', rest: m[1] };
  m = text.match(/^Opponent[’']s\s+(.*)$/i);
  if (m) return { side: 'opponent', rest: m[1] };
  if (who.trainer) {
    m = text.match(new RegExp(`^${escRe(who.trainer.trim())}[’']s\\s+(.*)$`, 'i'));
    if (m) return { side: 'opponent', rest: m[1] };
  }
  if (/^(You|It)\s/i.test(text)) return null; // "You used a Potion…", "It dealt 12 damage."
  return { rest: text };
}

/** Side for a bare name: must be one of the active Pokémon when they are known; yours on a tie. */
function resolveSide(subj: { side?: Side }, mon: string, who: Who): Side | undefined {
  if (subj.side) return subj.side;
  const n = lcName(mon);
  if (who.trainer && n === lcName(who.trainer)) return undefined; // "Lt. Surge used Super Potion…"
  const { player, opponent } = who.active ?? {};
  if (player && n === lcName(player)) return 'player';
  if (opponent && n === lcName(opponent)) return 'opponent';
  // Doubles: the other Pokémon on the field ("Slowbro used Calm Mind!" after "Go, Scrafty!").
  if (who.seen?.player.has(n) && !who.seen.opponent.has(n)) return 'player';
  if (who.seen?.opponent.has(n) && !who.seen.player.has(n)) return 'opponent';
  return player || opponent ? undefined : 'player';
}

/**
 * "Opponent’s Onix used Rock Tomb! It dealt 12 damage." / "Lt. Surge’s Voltorb used Screech!" / "Gloom used Giga Drain!"
 * Doubles (seen live 2026-11-19): "Scrafty used Crunch on Tate & Liza’s Claydol! It's super effective! It dealt 86 damage."
 */
export function parseUseLine(text: string, who: Who = {}): { side: Side; mon: string; move: string; damage?: number; target?: { side: Side; mon: string } } | null {
  const subj = splitSubject(text, who);
  if (!subj) return null;
  const m = subj.rest.match(/^(.+?)\s+used\s+(.+?)!/i);
  if (!m) return null;
  const side = resolveSide(subj, m[1], who);
  if (!side) return null;
  const dmg = text.match(/dealt (\d[\d,]*) damage/i);
  let move = m[2].trim();
  let target: { side: Side; mon: string } | undefined;
  const on = move.match(/^(.+?)\s+on\s+(.+)$/i);
  if (on) {
    move = on[1].trim();
    const t = splitSubject(on[2].trim(), who);
    const tSide = t && resolveSide(t, t.rest, who);
    if (t && tSide) target = { side: tSide, mon: t.rest.trim() };
  }
  return { side, mon: m[1].trim(), move, damage: num(dmg?.[1]), ...(target ? { target } : {}) };
}

/** "X fainted." / "X’s attack missed." / "X avoided the attack." in either wording. */
function subjectLine(text: string, re: RegExp, who: Who): { side: Side; mon: string } | null {
  const subj = splitSubject(text, who);
  const m = subj?.rest.match(re);
  if (!subj || !m) return null;
  const side = resolveSide(subj, m[1], who);
  return side ? { side, mon: m[1].trim() } : null;
}

/** Wording we have not seen in a real battle yet: keep those hits out of damage checks. */
const UNUSUAL = /hit \d+ times?|times!|recoil|restored|had its energy drained|substitute/i;
/** A critical hit ("A critical hit!" in mainline; the game's exact wording is a guess): checked against the crit range. */
const CRIT = /critical hit/i;

interface LogLine {
  text: string;
  turn?: number;
}

export function parseLog(lines: LogLine[], trainer?: string): { boosts: BattleSnapshot['boosts']; events: BattleEvent[]; monBoosts: Record<string, Boosts> } {
  const boosts: { player: Boosts; opponent: Boosts } = { player: {}, opponent: {} };
  /** Stages per Pokémon ("side|name"): doubles has two Pokémon per side. */
  const monBoosts: Record<string, Boosts> = {};
  const key = (side: Side, mon: string) => `${side}|${lcName(mon)}`;
  const active: { player?: string; opponent?: string } = {};
  const seen = { player: new Set<string>(), opponent: new Set<string>() };
  const who: Who = { trainer, active, seen };
  const events: BattleEvent[] = [];
  const other = (s: 'player' | 'opponent') => (s === 'player' ? 'opponent' : 'player');
  const note = (side: Side, mon?: string) => mon && seen[side].add(lcName(mon));
  lines.forEach(({ text, turn }, idx) => {
    const sw = switchSide(text);
    if (sw) {
      boosts[sw] = {};
      active[sw] = switchedIn(text);
      note(sw, active[sw]);
      if (active[sw]) monBoosts[key(sw, active[sw]!)] = {};
    }
    const use = parseUseLine(text, who);
    if (use) {
      active[use.side] ??= use.mon;
      note(use.side, use.mon);
      const targetSide = use.target?.side ?? other(use.side);
      const target = use.target?.mon ?? active[other(use.side)];
      // Doubles (a target was named, or two Pokémon of a side are known): stages per Pokémon.
      const perMon = !!use.target || seen.player.size > 1 || seen.opponent.size > 1;
      events.push({
        idx, turn, side: use.side, mon: use.mon, move: use.move, target, damage: use.damage,
        ...(use.target ? { targetSide } : {}),
        unusual: UNUSUAL.test(text) || undefined,
        crit: CRIT.test(text) || undefined,
        stages: perMon
          ? { attacker: { ...monBoosts[key(use.side, use.mon)] }, target: target ? { ...monBoosts[key(targetSide, target)] } : {} }
          : { attacker: { ...boosts[use.side] }, target: { ...boosts[other(use.side)] } },
      });
      return;
    }
    const last = events[events.length - 1];
    if (last) {
      // Follow-up lines about the last move: "Your Cottonee's attack missed.", "It dealt 9 damage.", "Opponent’s Geodude fainted."
      const missed = subjectLine(text, /^(.+?)[’']s attack missed/i, who);
      const avoided = subjectLine(text, /^(.+?) avoided the attack/i, who);
      if ((missed && missed.side === last.side) || (avoided && avoided.side !== last.side)) last.missed = true;
      const dmg = text.match(/^It dealt (\d[\d,]*) damage/i);
      if (dmg && last.damage === undefined) last.damage = num(dmg[1]);
      if (UNUSUAL.test(text) && idx === last.idx + 1) last.unusual = true;
      // The crit line may come after "It dealt N damage.": any line up to the next move use counts.
      if (CRIT.test(text)) last.crit = true;
      // Spread move, one line per Pokémon hit (seen live): "Slowbro took 24 damage." / "It doesn't affect Tate & Liza’s Xatu."
      // Only after a move with no named target, and only the exact wording (not recoil or weather lines).
      const spreadFollow = !last.targetSide;
      const took = spreadFollow ? subjectLine(text, /^(.+?)\s+took\s+\d[\d,]*\s+damage[.!]?$/i, who) : null;
      const immune = spreadFollow ? text.match(/^It doesn[’']t affect\s+(.+?)[.!]?$/i) : null;
      let hit: EventHit | undefined;
      if (took) hit = { side: took.side, mon: took.mon, damage: num(text.match(/took\s+(\d[\d,]*)\s+damage/i)![1]) };
      else if (immune) {
        const t = splitSubject(immune[1], who);
        const tSide = t && resolveSide(t, t.rest, who);
        if (t && tSide) hit = { side: tSide, mon: t.rest.trim(), immune: true };
      }
      if (hit) {
        hit.stages = { ...monBoosts[key(hit.side, hit.mon)] };
        (last.hits ??= []).push(hit);
      }
      const fainted = subjectLine(text, /^(.+?)\s+fainted/i, who);
      if (fainted) {
        const tSide = last.targetSide ?? other(last.side);
        if (fainted.side === tSide && fainted.mon === last.target) last.targetFainted = true;
        const h = last.hits?.find((x) => x.side === fainted.side && lcName(x.mon) === lcName(fainted.mon));
        if (h) h.fainted = true;
      }
    }
    const b = parseBoostLine(text, who);
    if (b) {
      for (const st of b.stats) {
        boosts[b.side][st] = Math.max(-6, Math.min(6, (boosts[b.side][st] ?? 0) + b.delta));
        const mb = (monBoosts[key(b.side, b.mon)] ??= {});
        mb[st] = Math.max(-6, Math.min(6, (mb[st] ?? 0) + b.delta));
      }
    }
  });
  return { boosts, events, monBoosts };
}

function readLog(doc: ParentNode, trainer?: string, fix: (s: string) => string = (s) => s): { lines: string[]; boosts: BattleSnapshot['boosts']; events: BattleEvent[]; monBoosts: Record<string, Boosts> } {
  let turn: number | undefined;
  const lines: LogLine[] = [...doc.querySelectorAll(SEL.logLine)].map((li) => {
    const label = li.querySelector(SEL.logTurn)?.textContent ?? '';
    const t = label.match(/Turn (\d+)/i);
    if (t) turn = parseInt(t[1], 10);
    // Gender is shown as text after the name ("CottoneeFemale"); drop it so lines read naturally.
    return { text: fix(clean((li.textContent ?? '').replace(label, '')).replace(/(\S)(Male|Female)\b/g, '$1')), turn };
  });
  const { boosts, events, monBoosts } = parseLog(lines, trainer);
  return { lines: lines.slice(-12).map((l) => l.text), boosts, events: events.slice(-80), monBoosts };
}

/** Active Pokémon shown on a side: one card per position in doubles, else one per stats box. */
function countActives(arena: Element, statsSel: string): number {
  const cards = arena.querySelectorAll(`${statsSel} ${SEL.activeCard}`).length;
  return cards || arena.querySelectorAll(statsSel).length;
}

const LOCKED_TEXT = /no team member needs this item|can(?:no|')t be used|unusable/i;

/**
 * Items panel of the battle screen (READ-ONLY; only what is rendered, it never switches pages or filters).
 * The panel is `.battle-team-bag-panel > .battle-bag` with All/Medicine/Berries filters and 2 pages; the entry
 * markup was not captured, so an entry is any `.battle-bag-item` / `[data-item-id]` / `li` inside it, with the
 * count read from "×N" text or a count element, and "locked" from disabled / aria-disabled / data-locked or the
 * game's "No team member needs this item". Returns undefined when the Items tab is not shown.
 */
export function readBattleBag(doc: ParentNode): BattleBagItem[] | undefined {
  const panel = doc.querySelector(SEL.bag);
  if (!panel) return undefined;
  const out = new Map<string, BattleBagItem>();
  for (const el of panel.querySelectorAll(SEL.bagEntry)) {
    if (el.querySelector(SEL.bagEntry)) continue; // wrapper of another entry
    const btn = el.matches('button') ? el : el.querySelector('button');
    const label = clean(el.getAttribute('aria-label') ?? btn?.getAttribute('aria-label') ?? '');
    const text = clean(el.textContent);
    const countText = clean(el.querySelector(SEL.bagCount)?.textContent ?? el.getAttribute('data-count') ?? '') || (label + ' ' + text);
    const c = countText.match(/(?:[×x]\s*|count:?\s*|quantity:?\s*)(\d+)/i) ?? clean(el.querySelector(SEL.bagCount)?.textContent).match(/^(\d+)$/);
    if (!c) continue; // filter buttons, page controls, headings: no count
    const named = clean(el.querySelector(SEL.bagName)?.textContent ?? el.getAttribute('data-item-name') ?? '');
    const name = named || clean((label || text).replace(LOCKED_TEXT, '').replace(/(?:[×x]\s*|count:?\s*|quantity:?\s*)\d+/gi, '').split(/[.,·]/)[0]);
    if (!name) continue;
    const id = el.getAttribute('data-item-id') || el.getAttribute('data-battle-item') || name.toLowerCase().replace(/[^a-z0-9]/g, '');
    const locked = [el, btn].some((e) => !!e && (e.hasAttribute('disabled') || e.getAttribute('aria-disabled') === 'true' || e.getAttribute('data-locked') === 'true')) || LOCKED_TEXT.test(`${label} ${text}`);
    const prev = out.get(id);
    out.set(id, { id, name, count: parseInt(c[1], 10), ...(locked ? { locked: true } : {}) , ...(prev ? { count: Math.max(prev.count, parseInt(c[1], 10)) } : {}) });
  }
  return out.size ? [...out.values()] : undefined;
}

/** Weather words on an effect button, in @smogon/calc spelling. Extreme weathers first ("Heavy Rain" before "Rain"). */
const WEATHER: [RegExp, string][] = [
  [/harsh sunshine|extremely harsh|desolate land/i, 'Harsh Sunshine'],
  [/heavy rain|primordial sea/i, 'Heavy Rain'],
  [/strong winds|delta stream/i, 'Strong Winds'],
  [/\bsun(?:ny|light|shine)?\b|harsh sunlight/i, 'Sun'],
  [/\brain\b/i, 'Rain'],
  [/sand/i, 'Sand'],
  [/\bsnow/i, 'Snow'],
  [/\bhail\b/i, 'Hail'],
];
/** Showdown weather ids used by the scene art (`data-weather`). */
const WEATHER_ID: Record<string, string> = {
  sunnyday: 'Sun', raindance: 'Rain', sandstorm: 'Sand', hail: 'Hail', snow: 'Snow', snowscape: 'Snow',
  desolateland: 'Harsh Sunshine', primordialsea: 'Heavy Rain', deltastream: 'Strong Winds',
};
const TERRAIN = /\b(Electric|Grassy|Misty|Psychic)\s+Terrain\b/i;
const turnsLeft = (s: string) => num(s.match(/(\d+)\s*(?:more\s+)?turns?\b/i)?.[1] ?? s.match(/(\d+)\s*left\b/i)?.[1]);

/**
 * Weather and terrain on screen. GUESS: the markup is known only from the game's stylesheet
 * (`.battle-field-status > .battle-field-effect` buttons, `.battle-weather-visual[data-weather]`);
 * button labels are read tolerantly ("Rain · 3 turns left", "Electric Terrain (2 turns)").
 * Returns undefined when nothing is shown.
 */
export function readField(arena: ParentNode): BattleField | undefined {
  const labels = [...arena.querySelectorAll(SEL.fieldEffect)]
    .map((b) => clean(b.getAttribute('aria-label') || b.textContent))
    .filter(Boolean);
  const out: BattleField = {};
  for (const label of labels) {
    const t = label.match(TERRAIN);
    if (t && !out.terrain) {
      out.terrain = t[1][0].toUpperCase() + t[1].slice(1).toLowerCase();
      out.terrainTurns = turnsLeft(label);
      continue;
    }
    const w = WEATHER.find(([re]) => re.test(label));
    if (w && !out.weather) {
      out.weather = w[1];
      out.weatherTurns = turnsLeft(label);
    }
  }
  if (!out.weather) {
    const id = arena.querySelector(SEL.weatherVisual)?.getAttribute('data-weather')?.toLowerCase() ?? '';
    if (WEATHER_ID[id]) out.weather = WEATHER_ID[id];
  }
  if (labels.length) out.labels = labels;
  for (const k of Object.keys(out) as (keyof BattleField)[]) if (out[k] === undefined) delete out[k];
  return Object.keys(out).length ? out : undefined;
}

/** Stat stages from the Showdown-style tags inside `root` ("Attack +2"), or undefined. */
function tagStages(root: Element | null): Boosts | undefined {
  if (!root) return undefined;
  const changes = [...root.querySelectorAll(SEL.statChange)].map((t) => t.getAttribute('aria-label') || t.getAttribute('title') || t.textContent || '').join(', ');
  const st = changes ? parseStatChanges(changes) : undefined;
  return st && Object.keys(st).length ? st : undefined;
}

/**
 * World Boss raid screen (seen live 2026-11-23). Your side reads like any battle; the boss comes from its
 * hero panel: name ("GMAX X" → the wiki's "Gigantamax X"), shared HP, status and stat stages. No level is shown.
 */
function readWorldBoss(doc: ParentNode, now: number): BattleSnapshot | null {
  const hero = doc.querySelector(SEL.bossHero);
  const combat = doc.querySelector(SEL.bossCombat);
  if (!hero || !combat) return null;
  const name = wikiBossName(clean(hero.querySelector(SEL.bossName)?.textContent));
  const log = readLog(combat, undefined, wikiBossName);
  const playerRoot = combat.querySelector(SEL.playerCombatant);
  const player = readCombatant(playerRoot);
  const stages = tagStages(hero.querySelector(SEL.bossStages));
  const status = hero.querySelector(SEL.status)?.getAttribute('data-status') || undefined;
  // The shared HP counts down smoothly (many DOM changes a second): round it to 1% steps so the snapshot,
  // and the advice computed from it, only change when it really moved.
  const hp = parseHp(clean(hero.querySelector(SEL.bossHp)?.textContent));
  if (hp.hp !== undefined && hp.maxHp) hp.hp = Math.round((hp.hp / hp.maxHp) * 100) * (hp.maxHp / 100);
  const opponent: BattleMon | undefined = name
    ? { name, ...hp, ...(status ? { status } : {}), ...(stages ? { stages } : {}) }
    : undefined;
  const bench = readBench(combat);
  const forcedSwitch = (!!player && hasFntBadge(playerRoot)) || hasNextPrompt(combat) || activeFainted({ player, bench } as BattleSnapshot);
  const bag = readBattleBag(combat);
  const field = readField(combat.parentElement ?? combat);
  const turns = [...combat.querySelectorAll(SEL.logTurn)].map((t) => t.textContent?.match(/Turn (\d+)/i)?.[1]).filter(Boolean);
  return {
    v: 2,
    at: now,
    status: 'active',
    kind: 'world-boss',
    opponentName: name || undefined,
    turn: num(turns[turns.length - 1]),
    player,
    opponent,
    moves: readMoves(combat),
    bench,
    opponentTeam: [],
    boosts: { player: player?.stages ?? log.boosts.player, opponent: stages ?? log.boosts.opponent },
    log: log.lines,
    events: log.events,
    ...(forcedSwitch ? { forcedSwitch: true } : {}),
    ...(bag ? { bag } : {}),
    sides: { player: 1, opponent: 1 },
    ...(field ? { field } : {}),
  };
}

export function readBattle(doc: ParentNode, now = Date.now()): BattleSnapshot | null {
  const arena = doc.querySelector(SEL.arena);
  if (!arena) return readWorldBoss(doc, now);
  const log = readLog(arena, clean(arena.querySelector(SEL.opponentName)?.textContent) || undefined);
  const myActives = readActives(arena.querySelector(SEL.playerStats));
  const theirActives = readActives(arena.querySelector(SEL.opponentStats));
  // Doubles layout: per-position cards (seen live). Kept even when a side is down to one card (end of a doubles battle).
  const doubles = myActives.length > 0 && theirActives.length > 0 && arena.querySelector(SEL.activeCard) !== null;
  // Doubles: position 1 stands in for "the" active Pokémon (singles callers keep working).
  const player = doubles ? myActives[0] : readCombatant(arena.querySelector(SEL.playerStats));
  const opponent = doubles ? theirActives[0] : readCombatant(arena.querySelector(SEL.opponentStats));
  // Stages: the on-screen badge wins; else the log's per-Pokémon stages.
  const withStages = (side: 'player' | 'opponent') => (m: BattleMon): BattleMon => {
    const fromLog = log.monBoosts[`${side}|${lcName(m.name)}`];
    return m.stages || !fromLog || !Object.keys(fromLog).length ? m : { ...m, stages: fromLog };
  };
  const movesFor = clean(arena.querySelector(SEL.commandHeading)?.textContent).match(/^Choose for\s+(.+?)(?:\s*·\s*Position\s*\d+)?$/i)?.[1]?.trim();
  const bench = readBench(arena);
  const playerRoot = arena.querySelector(SEL.playerStats);
  // Your active Pokémon is down and the game asks for the next one: only switch-ins make sense.
  const forcedSwitch = (!!player && hasFntBadge(playerRoot))
    || hasNextPrompt(arena)
    || activeFainted({ player, bench } as BattleSnapshot);
  const bag = readBattleBag(arena);
  const field = readField(arena);
  return {
    v: 2,
    at: now,
    status: arena.getAttribute('data-status') ?? 'unknown',
    kind: arena.getAttribute('data-kind') ?? undefined,
    format: arena.getAttribute('data-format') ?? undefined,
    opponentName: clean(arena.querySelector(SEL.opponentName)?.textContent) || undefined,
    turn: num(arena.querySelector(SEL.turn)?.textContent?.match(/Turn (\d+)/i)?.[1]),
    player,
    opponent,
    moves: readMoves(arena),
    bench,
    opponentTeam: readOpponentTeam(arena),
    // The screen shows stages next to the name when any are active ("Evasion +1"); trust that over the log.
    boosts: { player: player?.stages ?? log.boosts.player, opponent: opponent?.stages ?? log.boosts.opponent },
    log: log.lines,
    events: log.events,
    ...(forcedSwitch ? { forcedSwitch: true } : {}),
    ...(bag ? { bag } : {}),
    // Seen live (Tate & Liza, 2026-11-19): doubles has ONE stats box per side holding a card per position.
    sides: { player: countActives(arena, SEL.playerStats), opponent: countActives(arena, SEL.opponentStats) },
    ...(doubles ? { actives: { player: myActives.map(withStages('player')), opponent: theirActives.map(withStages('opponent')) } } : {}),
    ...(doubles && movesFor ? { movesFor } : {}),
    ...(field ? { field } : {}),
  };
}
