import type { WildBall, WildLead, WildSnapshot } from '../shared/wild';

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
  copy.querySelectorAll('button, svg, img, .encounter-level-held, .battle-pokemon-level, .battle-status, small').forEach((n) => n.remove());
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

function readLead(root: Element | null): WildLead | undefined {
  if (!root) return undefined;
  const name = nameOf(root.querySelector(WILD_SEL.name) ?? root);
  if (!name) return undefined;
  const { hp, maxHp } = hpOf(root);
  return { name, level: levelOf(root), hp, maxHp, item: itemOf(root) };
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
  const { hp, maxHp, hpPct } = opp ? hpOf(opp) : {};
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
    lead: readLead(card.querySelector(WILD_SEL.lead)),
  };
}
