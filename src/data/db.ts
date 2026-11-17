import { openDB, type IDBPDatabase } from 'idb';
import type { BoxMon, BoxSyncMeta, Dataset } from '../shared/types';

/** IndexedDB persistence (works both in the extension and in the dev harness). */
const DB_NAME = 'meowdex';
let dbp: Promise<IDBPDatabase> | null = null;

function db() {
  dbp ??= openDB(DB_NAME, 1, {
    upgrade(d) {
      d.createObjectStore('kv');
    },
  });
  return dbp;
}

export async function loadDataset(): Promise<Dataset | undefined> {
  return (await db()).get('kv', 'dataset');
}
export async function saveDataset(ds: Dataset): Promise<void> {
  await (await db()).put('kv', ds, 'dataset');
}
export async function clearDataset(): Promise<void> {
  await (await db()).delete('kv', 'dataset');
}

export async function loadBox(): Promise<BoxMon[]> {
  return ((await (await db()).get('kv', 'box')) as BoxMon[] | undefined) ?? [];
}
export async function saveBox(box: BoxMon[]): Promise<void> {
  await (await db()).put('kv', box, 'box');
}

export async function loadBoxMeta(): Promise<BoxSyncMeta | undefined> {
  return (await db()).get('kv', 'boxMeta');
}
export async function saveBoxMeta(meta: BoxSyncMeta): Promise<void> {
  await (await db()).put('kv', meta, 'boxMeta');
}
