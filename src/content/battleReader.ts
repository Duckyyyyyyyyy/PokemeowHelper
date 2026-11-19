import { activeFainted, type BattleEvent, type BattleMon, type BattleMove, type BattleSnapshot, type BoostKey, type Boosts, type RosterMon } from '../shared/battle';

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
  log: '.battle-log',
} as const;

/** Seen live (Drake, 2026-11-18) after your Pokémon fainted. Matched as text: its markup is not known yet. */
const NEXT_PROMPT = /choose your next pok[eé]mon/i;
/** Badge next to a fainted Pokémon's level ("FNT"), matched as text for the same reason (an element reading just "FNT"). */
const hasFntBadge = (root: Element | null) => !!root && [...root.querySelectorAll('*')].some((e) => clean(e.textContent) === 'FNT');

/** The "Choose your next Pokémon" prompt anywhere in the arena except the battle log. Read-only: works on a detached copy. */
export function hasNextPrompt(arena: Element): boolean {
  if (!NEXT_PROMPT.test(arena.textContent ?? '')) return false;
  const copy = arena.cloneNode(true) as Element;
  copy.querySelectorAll(SEL.log).forEach((l) => l.remove());
  return NEXT_PROMPT.test(copy.textContent ?? '');
}

const num = (s?: string | null) => {
  const n = s ? parseInt(s, 10) : NaN;
  return Number.isFinite(n) ? n : undefined;
};
const clean = (s?: string | null) => (s ?? '').replace(/\s+/g, ' ').trim();

/** "43/43 HP", "43 / 43 HP", "45 of 45 HP" */
export function parseHp(text: string): { hp?: number; maxHp?: number } {
  const m = text.match(/(\d+)\s*(?:\/|of)\s*(\d+)\s*HP/i);
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

function readCombatant(root: Element | null): BattleMon | undefined {
  if (!root) return undefined;
  const name = monName(root.querySelector(SEL.name));
  if (!name) return undefined;
  const statusEl = root.querySelector(SEL.status);
  const itemLabel = root.querySelector(SEL.item)?.getAttribute('aria-label') ?? '';
  const item = itemLabel.match(/Held item:\s*([^.]+)/i)?.[1]?.trim();
  // One badge per stat or one list: read them all. Unparsed text gives undefined, so the log's stages are used instead.
  const changes = [...root.querySelectorAll(SEL.statChanges)].map((c) => c.getAttribute('title') || c.textContent || '').join(', ');
  const stages = changes ? parseStatChanges(changes) : undefined;
  return {
    name,
    level: num(root.querySelector(SEL.level)?.textContent?.match(/(\d+)/)?.[1]),
    ...parseHp(root.querySelector(SEL.hp)?.textContent ?? ''),
    status: statusEl?.getAttribute('data-status') || undefined,
    item,
    stages: stages && Object.keys(stages).length ? stages : undefined,
  };
}

/** "Evasion +1" (seen live), also "Attack +2, Speed -1" style lists. */
export function parseStatChanges(text: string): Boosts {
  const out: Boosts = {};
  for (const m of text.matchAll(/([A-Za-z. ]+?)\s*([+\-−]\s*\d)/g)) {
    const key = STAT_WORDS.find(([re]) => re.test(m[1]))?.[1];
    if (key) out[key] = parseInt(m[2].replace('−', '-').replace(/\s/g, ''), 10);
  }
  return out;
}

/** "Fairy Wind · Fairy · Special · Power 40 · Accuracy 100% · 30/30 PP. No additional effect." */
export function parseMoveLabel(label: string): Omit<BattleMove, 'disabled'> {
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
    const disabled = b.hasAttribute('disabled') || b.getAttribute('aria-disabled') === 'true' || b.closest('[data-no-pp="true"]') !== null || parsed.pp === 0;
    return { ...parsed, disabled };
  });
}

export function readBench(doc: ParentNode): RosterMon[] {
  return [...doc.querySelectorAll(SEL.switchCard)].map((card) => {
    const label = card.querySelector(SEL.switchButton)?.getAttribute('aria-label') ?? '';
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

function readOpponentTeam(doc: ParentNode): RosterMon[] {
  return [...doc.querySelectorAll(SEL.rosterRow)].map((row) => {
    const heading = row.querySelector(SEL.rosterHeading);
    const name = monName(heading);
    return {
      name,
      level: num(clean(heading?.textContent).match(/Lv\.?\s*(\d+)/i)?.[1]),
      ...parseHp(clean(row.querySelector(SEL.rosterHealth)?.textContent ?? row.textContent)),
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
export function parseBoostLine(text: string, who: Who = {}): { side: 'player' | 'opponent'; stats: BoostKey[]; delta: number } | null {
  const subj = splitSubject(text, who);
  if (!subj) return null;
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
  return { side, stats, delta: /rose/i.test(m[3]) ? size : -size };
}

/** A line where a side sends in a new Pokémon (its stat stages start fresh). */
export function switchSide(text: string): 'player' | 'opponent' | null {
  if (/^Go,\s/i.test(text)) return 'player';
  if (/\bsent out\b/i.test(text)) return 'opponent';
  return null;
}

/** Name of the Pokémon sent in: "Go, Turtwig!" / "Brock sent out Onix!" */
export function switchedIn(text: string): string | undefined {
  return (text.match(/^Go,\s+(.+?)!/i) ?? text.match(/\bsent out\s+(.+?)!/i))?.[1]?.trim();
}

/** Who is battling: the opponent trainer's name and each side's active Pokémon (from the log so far). */
export interface Who {
  trainer?: string;
  active?: { player?: string; opponent?: string };
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
  return player || opponent ? undefined : 'player';
}

/** "Opponent’s Onix used Rock Tomb! It dealt 12 damage." / "Lt. Surge’s Voltorb used Screech!" / "Gloom used Giga Drain!" */
export function parseUseLine(text: string, who: Who = {}): { side: Side; mon: string; move: string; damage?: number } | null {
  const subj = splitSubject(text, who);
  if (!subj) return null;
  const m = subj.rest.match(/^(.+?)\s+used\s+(.+?)!/i);
  if (!m) return null;
  const side = resolveSide(subj, m[1], who);
  if (!side) return null;
  const dmg = text.match(/dealt (\d+) damage/i);
  return { side, mon: m[1].trim(), move: m[2].trim(), damage: dmg ? parseInt(dmg[1], 10) : undefined };
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

export function parseLog(lines: LogLine[], trainer?: string): { boosts: BattleSnapshot['boosts']; events: BattleEvent[] } {
  const boosts: { player: Boosts; opponent: Boosts } = { player: {}, opponent: {} };
  const active: { player?: string; opponent?: string } = {};
  const who: Who = { trainer, active };
  const events: BattleEvent[] = [];
  const other = (s: 'player' | 'opponent') => (s === 'player' ? 'opponent' : 'player');
  lines.forEach(({ text, turn }, idx) => {
    const sw = switchSide(text);
    if (sw) {
      boosts[sw] = {};
      active[sw] = switchedIn(text);
    }
    const use = parseUseLine(text, who);
    if (use) {
      active[use.side] ??= use.mon;
      events.push({
        idx, turn, side: use.side, mon: use.mon, move: use.move, target: active[other(use.side)], damage: use.damage,
        unusual: UNUSUAL.test(text) || undefined,
        crit: CRIT.test(text) || undefined,
        stages: { attacker: { ...boosts[use.side] }, target: { ...boosts[other(use.side)] } },
      });
      return;
    }
    const last = events[events.length - 1];
    if (last) {
      // Follow-up lines about the last move: "Your Cottonee's attack missed.", "It dealt 9 damage.", "Opponent’s Geodude fainted."
      const missed = subjectLine(text, /^(.+?)[’']s attack missed/i, who);
      const avoided = subjectLine(text, /^(.+?) avoided the attack/i, who);
      if ((missed && missed.side === last.side) || (avoided && avoided.side !== last.side)) last.missed = true;
      const dmg = text.match(/^It dealt (\d+) damage/i);
      if (dmg && last.damage === undefined) last.damage = parseInt(dmg[1], 10);
      if (UNUSUAL.test(text) && idx === last.idx + 1) last.unusual = true;
      // The crit line may come after "It dealt N damage.": any line up to the next move use counts.
      if (CRIT.test(text)) last.crit = true;
      const fainted = subjectLine(text, /^(.+?)\s+fainted/i, who);
      if (fainted && fainted.side !== last.side && fainted.mon === last.target) last.targetFainted = true;
    }
    const b = parseBoostLine(text, who);
    if (b) for (const s of b.stats) boosts[b.side][s] = Math.max(-6, Math.min(6, (boosts[b.side][s] ?? 0) + b.delta));
  });
  return { boosts, events };
}

function readLog(doc: ParentNode, trainer?: string): { lines: string[]; boosts: BattleSnapshot['boosts']; events: BattleEvent[] } {
  let turn: number | undefined;
  const lines: LogLine[] = [...doc.querySelectorAll(SEL.logLine)].map((li) => {
    const label = li.querySelector(SEL.logTurn)?.textContent ?? '';
    const t = label.match(/Turn (\d+)/i);
    if (t) turn = parseInt(t[1], 10);
    // Gender is shown as text after the name ("CottoneeFemale"); drop it so lines read naturally.
    return { text: clean((li.textContent ?? '').replace(label, '')).replace(/(\S)(Male|Female)\b/g, '$1'), turn };
  });
  const { boosts, events } = parseLog(lines, trainer);
  return { lines: lines.slice(-12).map((l) => l.text), boosts, events: events.slice(-80) };
}

export function readBattle(doc: ParentNode, now = Date.now()): BattleSnapshot | null {
  const arena = doc.querySelector(SEL.arena);
  if (!arena) return null;
  const log = readLog(arena, clean(arena.querySelector(SEL.opponentName)?.textContent) || undefined);
  const player = readCombatant(arena.querySelector(SEL.playerStats));
  const opponent = readCombatant(arena.querySelector(SEL.opponentStats));
  const bench = readBench(arena);
  const playerRoot = arena.querySelector(SEL.playerStats);
  // Your active Pokémon is down and the game asks for the next one: only switch-ins make sense.
  const forcedSwitch = (!!player && hasFntBadge(playerRoot))
    || hasNextPrompt(arena)
    || activeFainted({ player, bench } as BattleSnapshot);
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
  };
}
