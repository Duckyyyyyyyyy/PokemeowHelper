import type { BattleMon, BattleMove, BattleSnapshot, BoostKey, Boosts, RosterMon } from '../shared/battle';

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
} as const;

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
    if (e.matches('button, [aria-hidden="true"], [role="img"], svg')) return;
    e.childNodes.forEach(walk);
  };
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
  return {
    name,
    level: num(root.querySelector(SEL.level)?.textContent?.match(/(\d+)/)?.[1]),
    ...parseHp(root.querySelector(SEL.hp)?.textContent ?? ''),
    status: statusEl?.getAttribute('data-status') || undefined,
    item,
  };
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

function readMoves(doc: ParentNode): BattleMove[] {
  return [...doc.querySelectorAll(SEL.moveButton)].map((b) => {
    const parsed = parseMoveLabel(b.getAttribute('aria-label') ?? clean(b.textContent));
    const disabled = b.hasAttribute('disabled') || b.getAttribute('aria-disabled') === 'true' || b.closest('[data-no-pp="true"]') !== null || parsed.pp === 0;
    return { ...parsed, disabled };
  });
}

function readBench(doc: ParentNode): RosterMon[] {
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

const STAT_WORDS: [RegExp, BoostKey][] = [
  [/special attack|sp\. ?atk/i, 'spa'],
  [/special defense|sp\. ?def/i, 'spd'],
  [/attack/i, 'atk'],
  [/defense/i, 'def'],
  [/speed/i, 'spe'],
  [/accuracy/i, 'accuracy'],
  [/evasion|evasiveness/i, 'evasion'],
];

/**
 * Stage change in one log line, mainline wording (seen in-game: "Your Timburr's Defense
 * fell harshly!", "Your Turtwig's Speed fell!"). Returns null when the line has none.
 */
export function parseBoostLine(text: string): { side: 'player' | 'opponent'; stats: BoostKey[]; delta: number } | null {
  const m = text.match(/^(Your|Opponent[’']s)\s+(.+?)[’']s\s+(.+?)\s+(rose|fell)(?:\s+(sharply|harshly|drastically|severely))?!/i);
  if (!m) return null;
  const side = /^Your/i.test(m[1]) ? 'player' : 'opponent';
  const stats: BoostKey[] = [];
  for (const chunk of m[3].split(/,|\band\b/)) {
    const hit = STAT_WORDS.find(([re]) => re.test(chunk));
    if (hit && !stats.includes(hit[1])) stats.push(hit[1]);
  }
  if (!stats.length) return null;
  const size = /drastically|severely/i.test(m[5] ?? '') ? 3 : m[5] ? 2 : 1;
  return { side, stats, delta: /rose/i.test(m[4]) ? size : -size };
}

/** A line where a side sends in a new Pokémon (its stat stages start fresh). */
export function switchSide(text: string): 'player' | 'opponent' | null {
  if (/^Go,\s/i.test(text)) return 'player';
  if (/\bsent out\b/i.test(text)) return 'opponent';
  return null;
}

function readLog(doc: ParentNode): { lines: string[]; boosts: BattleSnapshot['boosts'] } {
  const lines = [...doc.querySelectorAll(SEL.logLine)].map((li) => {
    const turn = li.querySelector(SEL.logTurn)?.textContent ?? '';
    // Gender is shown as text after the name ("CottoneeFemale"); drop it so lines read naturally.
    return clean((li.textContent ?? '').replace(turn, '')).replace(/(\S)(Male|Female)\b/g, '$1');
  });
  const boosts: { player: Boosts; opponent: Boosts } = { player: {}, opponent: {} };
  for (const line of lines) {
    const sw = switchSide(line);
    if (sw) boosts[sw] = {};
    const b = parseBoostLine(line);
    if (!b) continue;
    for (const s of b.stats) boosts[b.side][s] = Math.max(-6, Math.min(6, (boosts[b.side][s] ?? 0) + b.delta));
  }
  return { lines: lines.slice(-12), boosts };
}

export function readBattle(doc: ParentNode, now = Date.now()): BattleSnapshot | null {
  const arena = doc.querySelector(SEL.arena);
  if (!arena) return null;
  const log = readLog(arena);
  return {
    v: 1,
    at: now,
    status: arena.getAttribute('data-status') ?? 'unknown',
    kind: arena.getAttribute('data-kind') ?? undefined,
    format: arena.getAttribute('data-format') ?? undefined,
    opponentName: clean(arena.querySelector(SEL.opponentName)?.textContent) || undefined,
    turn: num(arena.querySelector(SEL.turn)?.textContent?.match(/Turn (\d+)/i)?.[1]),
    player: readCombatant(arena.querySelector(SEL.playerStats)),
    opponent: readCombatant(arena.querySelector(SEL.opponentStats)),
    moves: readMoves(arena),
    bench: readBench(arena),
    opponentTeam: readOpponentTeam(arena),
    boosts: log.boosts,
    log: log.lines,
  };
}
