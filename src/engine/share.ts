import type { Dataset } from '../shared/types';
import { lc } from './turnAdvisor';
import { obsKey, type ObservedStore } from './observed';

/**
 * Sharing what MeowRPGAdvisor learned about NPCs, by file only (no server). The file holds NPC ids,
 * variant labels, Pokémon names and move ids — nothing about the player (no name, box, team, bag).
 * `sourceId` is a random id made once on this computer, used only so importing the same
 * contributor twice replaces instead of double-counting.
 */
export const SHARE_FORMAT = 'meowhelper-npc-data';
export const SHARE_VERSION = 1;
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_IMPORT_SOURCES = 50;
const MAX_NPCS = 1500;
const MAX_VARIANTS = 12;
const MAX_MONS = 12;
const MAX_MOVES = 40;

export interface ShareMon { name: string; level?: number; moves: string[] }
export interface ShareFile {
  format: typeof SHARE_FORMAT;
  formatVersion: number;
  exportedAt: string;
  appVersion: string;
  sourceId: string;
  /** npc id → variant label → Pokémon. */
  npcs: Record<string, Record<string, ShareMon[]>>;
}

/** One imported file, as remembered locally (key "mdImports", by sourceId). */
export interface ImportedSource {
  at: number;
  exportedAt: string;
  hash: string;
  /** obsKey → mon (moves only seen by that source). */
  mons: Record<string, ShareMon>;
}
export type ImportLedger = Record<string, ImportedSource>;

export const newSourceId = () => crypto.randomUUID();

/** Builds the export. `onlyWithData` skips NPCs nothing was observed for. Only YOUR observations. */
export function buildExport(ds: Dataset, store: ObservedStore, meta: { sourceId: string; appVersion: string; now?: Date }, onlyWithData: boolean): ShareFile {
  const npcs: ShareFile['npcs'] = {};
  for (const npc of ds.npcs) {
    const variants: Record<string, ShareMon[]> = {};
    for (const v of npc.variants) {
      const prefix = `${npc.id}#${lc(v.label)}|`;
      const mons: ShareMon[] = [];
      for (const [k, o] of Object.entries(store)) {
        if (!k.startsWith(prefix) || !o.moves.length) continue;
        const mon: ShareMon = { name: o.name, moves: [...o.moves] };
        if (o.level !== undefined) mon.level = o.level;
        mons.push(mon);
      }
      if (mons.length || !onlyWithData) variants[v.label] = mons;
    }
    if (Object.keys(variants).length) npcs[npc.id] = variants;
  }
  return {
    format: SHARE_FORMAT,
    formatVersion: SHARE_VERSION,
    exportedAt: (meta.now ?? new Date()).toISOString(),
    appVersion: meta.appVersion,
    sourceId: meta.sourceId,
    npcs,
  };
}

export interface ParsedImport {
  sourceId: string;
  exportedAt: string;
  mons: Record<string, ShareMon>;
  /** Counts for the result message. */
  accepted: number;
  skipped: number;
}

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const ID_RE = /^[A-Za-z0-9-]{8,64}$/;

/** Strict validation. Throws Error(message) for a bad file; unknown NPCs/moves/fields are dropped. */
export function parseImport(text: string, ds: Dataset): ParsedImport {
  if (text.length > MAX_IMPORT_BYTES) throw new Error('File is too large (max 2 MB).');
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Not a valid JSON file.');
  }
  if (!isObj(data) || data.format !== SHARE_FORMAT) throw new Error('This is not a MeowRPGAdvisor NPC data file.');
  if (data.formatVersion !== SHARE_VERSION) throw new Error('Unsupported file version.');
  if (typeof data.sourceId !== 'string' || !ID_RE.test(data.sourceId)) throw new Error('Missing or invalid source id.');
  const exportedAt = typeof data.exportedAt === 'string' && !Number.isNaN(Date.parse(data.exportedAt)) ? data.exportedAt : '';
  if (!exportedAt) throw new Error('Missing or invalid export date.');
  if (!isObj(data.npcs)) throw new Error('Missing NPC data.');
  const npcIds = Object.keys(data.npcs);
  if (npcIds.length > MAX_NPCS) throw new Error('Too many NPCs in the file.');

  const byId = new Map(ds.npcs.map((n) => [n.id, n]));
  const mons: Record<string, ShareMon> = {};
  let accepted = 0;
  let skipped = 0;
  for (const id of npcIds) {
    const npc = byId.get(id);
    const variants = (data.npcs as Record<string, unknown>)[id];
    if (!npc || !isObj(variants) || Object.keys(variants).length > MAX_VARIANTS) {
      skipped++;
      continue;
    }
    for (const [label, list] of Object.entries(variants)) {
      const variant = npc.variants.find((v) => lc(v.label) === lc(label));
      if (!variant || !Array.isArray(list) || list.length > MAX_MONS) {
        skipped++;
        continue;
      }
      for (const raw of list) {
        if (!isObj(raw) || typeof raw.name !== 'string' || raw.name.length > 40 || !Array.isArray(raw.moves) || raw.moves.length > MAX_MOVES) {
          skipped++;
          continue;
        }
        const level = typeof raw.level === 'number' && Number.isInteger(raw.level) && raw.level >= 1 && raw.level <= 100 ? raw.level : undefined;
        // Must be a Pokémon of that very team (by name; level too when both are known).
        const wiki = variant.team.find((m) => lc(m.name) === lc(raw.name as string) && (level === undefined || m.level === undefined || m.level === level));
        if (!wiki) {
          skipped++;
          continue;
        }
        const moves = [...new Set(raw.moves.filter((m): m is string => typeof m === 'string' && Object.prototype.hasOwnProperty.call(ds.moves, m)))];
        if (!moves.length) {
          skipped++;
          continue;
        }
        const key = obsKey(`${npc.id}#${lc(variant.label)}`, wiki.name, level);
        const cur = mons[key];
        mons[key] = { name: wiki.name, level, moves: [...new Set([...(cur?.moves ?? []), ...moves])] };
        accepted++;
      }
    }
  }
  if (!accepted) throw new Error('No known NPC data in this file (sync the wiki data first, or the file is from a different version).');
  return { sourceId: data.sourceId, exportedAt, mons, accepted, skipped };
}

/** Hash of the observations only (not the export date), so a copy re-saved later is still recognised. */
export async function contentHash(mons: Record<string, ShareMon>): Promise<string> {
  const canon = Object.keys(mons).sort().map((k) => `${k}:${[...mons[k].moves].sort().join(',')}`).join(';');
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canon));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export type AddResult =
  | { ok: true; ledger: ImportLedger; replaced: boolean }
  | { ok: false; reason: string };

/**
 * Adds a parsed file to the ledger. The same source id REPLACES its earlier contribution (newer
 * export wins); the same content under another id, or your own export, is refused.
 */
export function addImport(ledger: ImportLedger, p: ParsedImport, hash: string, ownSourceId: string | undefined, now = Date.now()): AddResult {
  if (ownSourceId && p.sourceId === ownSourceId) return { ok: false, reason: 'This file was exported from this computer.' };
  const prev = ledger[p.sourceId];
  if (prev && Date.parse(prev.exportedAt) > Date.parse(p.exportedAt)) return { ok: false, reason: 'A newer file from the same source is already imported.' };
  if (prev && prev.hash === hash) return { ok: false, reason: 'This file is already imported.' };
  for (const [id, s] of Object.entries(ledger)) {
    if (id !== p.sourceId && s.hash === hash) return { ok: false, reason: 'This data is already imported (same content).' };
  }
  if (!prev && Object.keys(ledger).length >= MAX_IMPORT_SOURCES) return { ok: false, reason: 'Too many imported files; remove imported data first.' };
  return { ok: true, replaced: !!prev, ledger: { ...ledger, [p.sourceId]: { at: now, exportedAt: p.exportedAt, hash, mons: p.mons } } };
}

/**
 * Rebuilds the "seen by others" part of the store from the ledger: your own moves are untouched,
 * counts = number of sources. Used for import, re-import and undo ("Remove imported data").
 */
export function applyImports(store: ObservedStore, ledger: ImportLedger, now = Date.now()): ObservedStore {
  const out: ObservedStore = {};
  for (const [k, v] of Object.entries(store)) {
    if (!v.moves.length) continue; // an imported-only entry: rebuilt below
    const { others: _drop, ...rest } = v;
    out[k] = rest;
  }
  for (const src of Object.values(ledger)) {
    for (const [k, m] of Object.entries(src.mons)) {
      const cur = out[k] ?? { name: m.name, level: m.level, moves: [], lastSeen: src.at || now };
      const others = { ...(cur.others ?? {}) };
      for (const id of m.moves) others[id] = (others[id] ?? 0) + 1;
      out[k] = { ...cur, others };
    }
  }
  return out;
}

export const importedCount = (store: ObservedStore) => Object.values(store).filter((m) => m.others && Object.keys(m.others).length).length;
