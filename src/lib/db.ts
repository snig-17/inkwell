// IndexedDB layer for inkwell's single local notebook.
//
// One store holds pages with their data inlined (the data/layout split is a
// later "Should"; for now data is an opaque JSON blob the page owns). A second
// store keeps one most-recent backup per page — the ".bak" snapshot taken
// before a re-prompt overwrites a page, so an accidental data loss is
// recoverable.
//
// IndexedDB only exists in the browser. Every function here must run inside an
// effect or event handler, never during render or module init, or it will throw
// during Next.js server rendering.

import { openDB, type DBSchema, type IDBPDatabase } from "idb";

export type PageData = Record<string, unknown>;

export interface Page {
  id: string;
  title: string;
  html: string;
  data: PageData;
  order: number;
  createdAt: number;
  updatedAt: number;
}

export interface Backup {
  pageId: string;
  html: string;
  data: PageData;
  savedAt: number;
}

interface InkwellDB extends DBSchema {
  pages: { key: string; value: Page };
  backups: { key: string; value: Backup };
}

const DB_NAME = "inkwell";
const DB_VERSION = 1;

// Memoized so React 19 Strict-Mode double-mounts share one connection.
let dbPromise: Promise<IDBPDatabase<InkwellDB>> | null = null;

function db() {
  if (!dbPromise) {
    dbPromise = openDB<InkwellDB>(DB_NAME, DB_VERSION, {
      upgrade(database) {
        database.createObjectStore("pages", { keyPath: "id" });
        database.createObjectStore("backups", { keyPath: "pageId" });
      },
    });
  }
  return dbPromise;
}

// Browser-only id; crypto.randomUUID is available in all target browsers.
function newId() {
  return crypto.randomUUID();
}

export async function listPages(): Promise<Page[]> {
  const all = await (await db()).getAll("pages");
  return all.sort((a, b) => a.order - b.order);
}

export async function getPage(id: string): Promise<Page | undefined> {
  return (await db()).get("pages", id);
}

export async function createPage(input: {
  title: string;
  html: string;
}): Promise<Page> {
  const now = Date.now();
  const page: Page = {
    id: newId(),
    title: input.title,
    html: input.html,
    data: {},
    order: now, // creation order — monotonic without reading the whole store
    createdAt: now,
    updatedAt: now,
  };
  await (await db()).put("pages", page);
  return page;
}

// Swap a page's layout (and refreshed title) while preserving its data verbatim.
export async function updatePageHtml(
  id: string,
  html: string,
  title: string,
): Promise<Page | undefined> {
  const database = await db();
  const page = await database.get("pages", id);
  if (!page) return undefined;
  const updated: Page = { ...page, html, title, updatedAt: Date.now() };
  await database.put("pages", updated);
  return updated;
}

// Merge a single field into a page's data blob (never replace wholesale), so a
// write that arrives before init can't clobber existing fields.
export async function mergeData(
  id: string,
  field: string,
  value: unknown,
): Promise<void> {
  const database = await db();
  const page = await database.get("pages", id);
  if (!page) return;
  page.data = { ...page.data, [field]: value };
  page.updatedAt = Date.now();
  await database.put("pages", page);
}

// Snapshot the current layout + data before a re-prompt overwrites it.
export async function snapshotBackup(id: string): Promise<void> {
  const database = await db();
  const page = await database.get("pages", id);
  if (!page) return;
  const backup: Backup = {
    pageId: page.id,
    html: page.html,
    data: page.data,
    savedAt: Date.now(),
  };
  await database.put("backups", backup);
}

// Restore the most-recent pre-regenerate snapshot (one level of undo) and clear
// it, so a re-prompt the user dislikes is recoverable. Returns the restored page,
// or undefined if there is nothing to restore.
export async function restoreBackup(pageId: string): Promise<Page | undefined> {
  const database = await db();
  const backup = await database.get("backups", pageId);
  const page = await database.get("pages", pageId);
  if (!backup || !page) return undefined;
  const restored: Page = {
    ...page,
    html: backup.html,
    data: backup.data,
    updatedAt: Date.now(),
  };
  await database.put("pages", restored);
  await database.delete("backups", pageId);
  return restored;
}

export async function deletePage(id: string): Promise<void> {
  const database = await db();
  await database.delete("pages", id);
  await database.delete("backups", id);
}
