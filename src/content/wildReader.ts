import type { RosterMon } from '../shared/battle';
import type { WildBall, WildLead, WildSnapshot } from '../shared/wild';
import { readBench, readMoves } from './battleReader';

/**
 * Reads the wild encounter card on the Explore page. Pure and READ-ONLY: it never clicks,
 * writes to the DOM or fetches. Intro view checked live on 2026-11-18 (Doduo, Grasslands 3):
 *   h1.page-title "Grasslands 3"
 *   .wild-encounter[data-view="intro"]
 *     .encounter-rarity "Common"
 *     .encounter-title h3: .dex-caught-status.dex-status-caught, name text, svg.pokemon-gender-F,
 *       .encounter-level-held > .battle-pokemon-level "Lv. 6" (+ .battle-held-item when it holds one)
 *     small.encounter-owned-count "[in box: 0]"
 *     .quick-catch-slot button[aria-label="Quick catch: Throw Poké Ball, 15 in bag"]
 *     .battle-partner (your lead): strong[title], .battle-pokemon-level, .battle-held-item, .battle-hp-numbers
 * The battle view that follows "Battle" is NOT verified live: it is read from the class names
 * the game's stylesheet uses for it (.encounter-opponent, .health-track, .battle-status).
 */
export const WILD_SEL = {
  card: '.wild-encounter',
  pageTitle: 'h1.page-title',
  rarity: '.encounter-rarity',
  title: '.encounter-title h3',
  opponent: '.encounter-opponent',
  name: '.battle-combatant-name',
  level: '.battle-pokemon-level',
  item: '.battle-held-item',
  gender: '.pokemon-gender',
  dexCaught: '.dex-status-caught',
  dexUncaught: '.dex-status-uncaught',
  owned: '.encounter-owned-count',
  ballSlot: '.quick-catch-slot button[aria-label^="Quick catch"]',
  lead: '.battle-partner',
  hp: '.battle-hp-numbers',
  healthBar: '.health-track > span',
  status: '[data-status], .battle-status',
  shiny: '.encounter-rarity-shiny, .pokemon-name-shiny, .shiny-encounter-reveal, .battle-shiny-sparkles',
  /** Explore team panel (class names from the game stylesheet; markup not seen live). */
  teamSlot: '.starter-options > li[data-explore-team-slot]',
  /** Slot 1, the starter: its own block above the list, not an li. */
  teamStarter: '.starter-panel .starter-summary',
  teamName: '.starter-info h3, h3, .explore-team-name',
  teamLevel: '.explore-team-level',
};

const clean = (s?: string | null) => (s ?? '').replace(/\s+/g, ' ').trim();
const num = (s?: string | null) => {
  const n = s ? parseInt(s, 10) : NaN;
  return Number.isFinite(n) ? n : undefined;
};
const STATUS: Record<string, string> = { par: 'par', brn: 'brn', psn: 'psn', tox: 'tox', slp: 'slp', frz: 'frz' };

/** Name text of a heading, without buttons, level, gender icons or held item. */
function nameOf(el: Element | null | undefined): string {
  if (!el) return '';
  const title = el.querySelector('strong[title]')?.getAttribute('title');
  if (title) return clean(title);
  const copy = el.cloneNode(true) as Element;
  copy.querySelectorAll('button, svg, img, .encounter-level-held, .battle-pokemon-level, .explore-team-level, .battle-status, small').forEach((n) => n.remove());
  return clean(copy.textContent);
}

const levelOf = (el: Element | null | undefined) => num(clean(el?.querySelector(WILD_SEL.level)?.textContent).match(/Lv\.?\s*(\d+)/i)?.[1]);

function itemOf(el: Element | null | undefined): string | undefined {
  const b = el?.querySelector(WILD_SEL.item);
  if (!b) return undefined;
  const label = b.getAttribute('aria-label') ?? '';
  const m = label.match(/Held item:\s*([^.]+)/i) ?? (b.getAttribute('title') ?? '').match(/About\s+(.+)/i);
  return m ? clean(m[1]) : undefined;
}

function genderOf(el: Element | null | undefined): 'M' | 'F' | undefined {
  const g = el?.querySelector(WILD_SEL.gender);
  if (!g) return undefined;
  const cls = g.getAttribute('class') ?? '';
  if (/gender-F\b/.test(cls) || g.getAttribute('aria-label') === 'Female') return 'F';
  if (/gender-M\b/.test(cls) || g.getAttribute('aria-label') === 'Male') return 'M';
  return undefined;
}

function hpOf(el: Element | null | undefined): { hp?: number; maxHp?: number; hpPct?: number } {
  const m = clean(el?.querySelector(WILD_SEL.hp)?.textContent).match(/(\d+)\s*\/\s*(\d+)/);
  if (m) return { hp: num(m[1]), maxHp: num(m[2]) };
  const w = (el?.querySelector(WILD_SEL.healthBar) as HTMLElement | null)?.style?.width ?? '';
  const p = w.match(/([\d.]+)%/);
  return p ? { hpPct: Math.max(0, Math.min(100, parseFloat(p[1]))) } : {};
}

function statusOf(el: Element | null | undefined): string | undefined {
  for (const s of el?.querySelectorAll(WILD_SEL.status) ?? []) {
    const code = (s.getAttribute('data-status') ?? clean(s.textContent)).toLowerCase();
    if (STATUS[code]) return STATUS[code];
  }
  return undefined;
}

/**
 * Your Pokémon on the card. Intro view (seen live): .battle-partner.quick-catch-lead with
 * strong[title]. Battle view (game stylesheet only, 2026-11-19): still a .battle-partner, but with
 * `strong > span` text and a .battle-deployment sprite, so the name may carry extra words; the
 * sprite's alt text is the clean species name. The last non-quick-catch card wins in battle.
 */
function leadCard(card: Element): Element | null {
  const scope = card.closest('.encounter-card') ?? card;
  const all = [...scope.querySelectorAll(WILD_SEL.lead)];
  return all.filter((e) => !e.classList.contains('quick-catch-lead')).pop() ?? all.pop() ?? null;
}

function readLead(root: Element | null): WildLead | undefined {
  if (!root) return undefined;
  const title = root.querySelector('strong[title]')?.getAttribute('title');
  const alt = clean(root.querySelector('.pokemon-sprite[alt], img[alt]:not([alt=""])')?.getAttribute('alt'));
  const name = clean(title) || alt || nameOf(root.querySelector(WILD_SEL.name) ?? root);
  if (!name) return undefined;
  let { hp, maxHp } = hpOf(root);
  const text = spacedText(root);
  if (hp === undefined) {
    const m = text.match(/(\d+)\s*\/\s*(\d+)\s*HP/i);
    if (m) [hp, maxHp] = [num(m[1]), num(m[2])];
  }
  const level = levelOf(root) ?? num(text.match(/Lv\.?\s*(\d+)/i)?.[1]);
  return { name, level, hp, maxHp, item: itemOf(root), gender: genderOf(root) };
}

/** "Go, Slaking!" in the card's battle log: the last Pokémon you sent out (that line is gone a turn later). */
function sentOutOf(card: Element): string | undefined {
  const scope = card.closest('.encounter-card') ?? card;
  let out: string | undefined;
  scope.querySelectorAll('.battle-log li, .battle-log-column li, .battle-log p').forEach((line) => {
    // The first line of a turn starts with its label: "Turn 2 Go, Slaking!".
    const text = spacedText(line).replace(clean(line.querySelector('.battle-log-turn')?.textContent), '').trim();
    if (!/^Go,/i.test(text)) return;
    const mon = line.querySelector('.battle-log-pokemon');
    const name = clean(mon?.querySelector('span')?.textContent) || clean(text.match(/^Go,\s*(.+?)\s*[♂♀]?\s*!/)?.[1]);
    if (name) out = name;
  });
  return out;
}

/** Text with a space between elements, so "Lv. 56" and "166/166 HP" never run together. */
function spacedText(el: Element): string {
  const parts: string[] = [];
  const walk = (n: Node) => (n.nodeType === 3 ? parts.push(n.textContent ?? '') : n.childNodes.forEach(walk));
  walk(el);
  return clean(parts.join(' '));
}

/** One team-panel entry (starter summary or a slot row). */
function teamEntry(el: Element, slot: number): RosterMon | null {
  const heading = el.querySelector(WILD_SEL.teamName);
  const alt = clean(el.querySelector('img.pokemon-sprite[alt], .pokemon-sprite[alt]')?.getAttribute('alt'));
  const text = spacedText(el);
  const name = (heading && nameOf(heading)) || alt || clean(text.split(/\s+Lv\.?\s*\d+/i)[0]).replace(/[♂♀]/g, '').trim();
  if (!name) return null;
  const level = num((clean(el.querySelector(WILD_SEL.teamLevel)?.textContent) || text).match(/Lv\.?\s*(\d+)/i)?.[1]);
  const hpm = text.match(/(\d+)\s*\/\s*(\d+)\s*HP/i);
  const hp = num(hpm?.[1]);
  const slotText = num(text.match(/\bSlot\s*(\d+)/i)?.[1]);
  return {
    name, level, hp, maxHp: num(hpm?.[2]),
    // The panel does not say who leads: the encounter card's lead decides (see wildParty).
    active: false,
    fainted: hp === 0 || el.getAttribute('data-fainted') === 'true',
    gender: genderOf(heading ?? el),
    slot: slotText ?? slot,
  };
}

/**
 * Explore team panel. Checked against the user's live screenshot (2026-11-18) and the game's
 * stylesheet: slot 1 (the starter, "★ Starter") is NOT a list row but a separate summary block,
 *   .starter-panel-compact .starter-summary > .pokemon-sprite + .starter-info h3 (name, .explore-team-level)
 * and slots 2–6 are `.starter-options > li[data-explore-team-slot]`. Returned in slot order.
 */
export function readTeamPanel(doc: ParentNode): RosterMon[] {
  const out: RosterMon[] = [];
  const starter = doc.querySelector(WILD_SEL.teamStarter);
  if (starter) {
    const r = teamEntry(starter, 1);
    if (r) out.push(r);
  }
  doc.querySelectorAll(WILD_SEL.teamSlot).forEach((li) => {
    const r = teamEntry(li, out.length + 1);
    if (r) out.push(r);
  });
  return out.sort((x, y) => (x.slot ?? 99) - (y.slot ?? 99));
}

export function readWild(doc: ParentNode, now = Date.now()): WildSnapshot | null {
  const card = doc.querySelector(WILD_SEL.card);
  if (!card) return null;
  const view = card.getAttribute('data-view') ?? 'intro';
  // Battle view: the wild Pokémon sits in .encounter-opponent; intro view: in the title h3.
  const opp = card.querySelector(WILD_SEL.opponent);
  const head = opp ?? card.querySelector(WILD_SEL.title);
  let name = nameOf(opp ? opp.querySelector(WILD_SEL.name) ?? opp : head);
  if (!name) name = clean(card.querySelector('.encounter-announcement-pokemon > span')?.textContent);
  if (!name) return null;

  const balls: WildBall[] = [];
  card.querySelectorAll(WILD_SEL.ballSlot).forEach((b) => {
    const m = (b.getAttribute('aria-label') ?? '').match(/Throw\s+(.+?),\s*(\d+)\s+in bag/i);
    if (m) balls.push({ name: clean(m[1]), count: parseInt(m[2], 10) });
  });

  const ownedText = clean(card.querySelector(WILD_SEL.owned)?.textContent);
  const rarity = clean(card.querySelector(WILD_SEL.rarity)?.textContent) || undefined;
  const pageTitle = (doc as Document).querySelector?.(WILD_SEL.pageTitle);
  const registered = card.querySelector(WILD_SEL.dexCaught) ? true : card.querySelector(WILD_SEL.dexUncaught) ? false : undefined;
  let { hp, maxHp, hpPct } = opp ? hpOf(opp) : {};
  if (opp && hp === undefined) {
    // Battle view per the stylesheet may put the numbers in .battle-health strong instead.
    const m = spacedText(opp).match(/(\d+)\s*\/\s*(\d+)\s*HP/i);
    if (m) [hp, maxHp, hpPct] = [num(m[1]), num(m[2]), undefined];
  }
  // Your team: the battle's switch cards (same markup the battle reader knows), else the Explore team panel.
  const bench = readBench(card);
  const party = bench.length ? bench : readTeamPanel(doc);
  const moves = readMoves(card);
  return {
    v: 1,
    at: now,
    view,
    map: clean(pageTitle?.textContent) || undefined,
    name,
    gender: genderOf(head),
    level: levelOf(head),
    rarity,
    shiny: !!card.querySelector(WILD_SEL.shiny) || /shiny/i.test(rarity ?? ''),
    item: itemOf(head),
    registered,
    inBox: num(ownedText.match(/in box:\s*(\d+)/i)?.[1]),
    hp,
    maxHp,
    hpPct,
    status: opp ? statusOf(opp) : undefined,
    balls,
    lead: readLead(leadCard(card)),
    sentOut: view === 'intro' ? undefined : sentOutOf(card),
    ...(party.length ? { party } : {}),
    ...(moves.length ? { moves } : {}),
  };
}
