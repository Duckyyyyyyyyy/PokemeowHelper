import { bossKey, type BossBuild, type BossLobbySnapshot, type BossNext } from '../shared/bossLobby';

/**
 * Reads the World Boss page (READ-ONLY). See shared/bossLobby.ts. The "Next Scheduled Boss" card was
 * checked live on 2026-11-23 (tests/fixtures/worldboss/next-card.live.html): it shows "GMAX Melmetal" and
 * its build (facts + "Moves this appearance") in the card itself. The details dialog is still unverified.
 */

const txt = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s);

function typesIn(root: Element | null): string[] {
  if (!root) return [];
  return [...root.querySelectorAll('.type-badges .type, .type-badges [class*="type-"]')]
    .map((el) => {
      const cls = [...el.classList].find((c) => /^type-[a-z]+$/.test(c));
      return cap(cls ? cls.slice(5) : txt(el));
    })
    .filter((t, i, a) => t && a.indexOf(t) === i);
}

/** Form from the name icons (pokemon-name-eternamax / -gmax) or the sprite's file name / alt. */
function formIn(root: Element | null): string | undefined {
  if (!root) return undefined;
  if (root.querySelector('.pokemon-name-eternamax')) return 'eternamax';
  if (root.querySelector('.pokemon-name-gmax')) return 'gmax';
  const img = root.querySelector('img');
  const hint = `${img?.getAttribute('alt') ?? ''} ${img?.getAttribute('src') ?? ''}`.toLowerCase();
  if (/eternamax/.test(hint)) return 'eternamax';
  if (/gmax|gigantamax/.test(hint)) return 'gmax';
  return undefined;
}

/** "GMAX Melmetal" → "Melmetal" once the form is known (the wiki calls it "Gigantamax Melmetal"). */
const bareName = (name: string, form: string | undefined) =>
  form ? name.replace(/^(?:g-?max|gigantamax|eternamax)\s+/i, '') : name;

function readNext(doc: Document): BossNext | undefined {
  const sec = doc.querySelector('section.world-boss-next');
  if (!sec) return undefined;
  const identity = sec.querySelector('.world-boss-next-identity');
  const nameEl = sec.querySelector('.world-boss-next-name') ?? identity?.querySelector('h3');
  const form = formIn(identity);
  const name = bareName(txt(nameEl), form);
  if (!name) return undefined;
  const time = sec.querySelector('time[datetime]')?.getAttribute('datetime') ?? undefined;
  return {
    name,
    form,
    types: typesIn(identity),
    startsAt: time || undefined,
    staff: sec.getAttribute('data-staff') === 'true' || undefined,
  };
}

/**
 * A boss build: from the details dialog when one is open, else from the Next card (live page: the card
 * lists Level / Ability / Nature and "Moves this appearance" itself).
 */
function readBuild(doc: Document, at: number): BossBuild | undefined {
  const dialog = doc.querySelector('.world-boss-schedule-info');
  const card = doc.querySelector('section.world-boss-next');
  const info = dialog ?? card?.querySelector('.world-boss-next-build');
  if (!info) return undefined;
  const identity = dialog ? dialog.querySelector('.world-boss-detail-identity') : card!.querySelector('.world-boss-next-identity');
  const form = formIn(identity);
  const nameEl = dialog ? identity?.querySelector('h3') : card!.querySelector('.world-boss-next-name') ?? identity?.querySelector('h3');
  const name = bareName(txt(nameEl), form);
  if (!name) return undefined;
  const facts: Record<string, string> = {};
  for (const row of info.querySelectorAll('dl.world-boss-info-facts > div')) {
    const k = txt(row.querySelector('dt')).toLowerCase();
    if (k) facts[k] = txt(row.querySelector('dd'));
  }
  const list = info.querySelector('ul.world-boss-info-moves');
  const moves = list
    ? [...list.querySelectorAll('li')].map((li) => {
        const t = li.querySelector('.type');
        const cls = t ? [...t.classList].find((c) => /^type-[a-z]+$/.test(c)) : undefined;
        const catEl = li.querySelector('.world-boss-info-move-category');
        return {
          name: txt(li.querySelector('.world-boss-info-move, strong')),
          type: cls ? cap(cls.slice(5)) : txt(t) ? cap(txt(t)) : undefined,
          category: catEl?.getAttribute('aria-label') || txt(li.querySelector('small')) || undefined,
        };
      }).filter((m) => m.name)
    : [];
  const level = Number((facts.level ?? '').replace(/[^\d]/g, ''));
  const notes = [...(dialog ?? card!).querySelectorAll('.world-boss-note')].map(txt).join(' ');
  return {
    name,
    form,
    types: typesIn(identity),
    level: level > 0 ? level : undefined,
    ability: facts.ability || undefined,
    nature: facts.nature || undefined,
    moves: moves.length ? moves : undefined,
    staff: /staff-summoned/i.test(notes) || undefined,
    at,
  };
}

/** Null when no World Boss page is open. */
export function readBossLobby(doc: Document, now = Date.now()): { next?: BossNext; build?: BossBuild } | null {
  const page = doc.querySelector('.world-boss-page, .world-boss-lobby, section.world-boss-next, .world-boss-schedule-info');
  if (!page) return null;
  const next = readNext(doc);
  const build = readBuild(doc, now);
  if (!next && !build) return null;
  return { next, build };
}

/**
 * Keeps builds from earlier reads (the dialog closes), replaced by a newer read of the same boss.
 * A newer read without moves replaces the old one too: the game no longer lists them.
 */
export function mergeBossLobby(prev: BossLobbySnapshot | null | undefined, read: NonNullable<ReturnType<typeof readBossLobby>>, now = Date.now()): BossLobbySnapshot {
  const builds = { ...(prev?.v === 1 ? prev.builds : {}) };
  if (read.build) {
    const key = bossKey(read.build.name, read.build.form);
    const next = read.next ?? prev?.next;
    const isNext = !!next && bossKey(next.name, next.form) === key;
    builds[key] = isNext && next.startsAt ? { ...read.build, startsAt: next.startsAt } : read.build;
  }
  return { v: 1, at: now, next: read.next ?? prev?.next, builds };
}

/** Change signature for publishing: ignores read times (the countdown ticks every second). */
export function lobbySig(read: ReturnType<typeof readBossLobby>): string {
  if (!read) return 'none';
  const { build } = read;
  return JSON.stringify({ next: read.next, build: build && { ...build, at: 0 } });
}
