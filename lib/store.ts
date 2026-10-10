// RelayBoard Campus Fix — P1 localStorage-first store (SSR-safe).
//
// Storage is namespaced per seed: `relayboard:{SEED_ID}:items/events/meta`.
// Every localStorage access is guarded by `typeof window === "undefined"`
// (server prerender) and wrapped in try/catch (private mode / quota), with
// an in-memory mirror as fallback so the queue still renders.
//
// Idempotency: canonical seed payloads contain NO Date.now()/Math.random()
// values, and the meta record is {seedId, hash} only (no timestamps), so
// running reseedDemo() twice yields byte-identical storage with no dupes.

import seedData from "./seed.json";
import { validateItem, type Event, type Item } from "./schema";

export const SEED_ID = "campus-maint-v1";

const ITEMS_KEY = `relayboard:${SEED_ID}:items`;
const EVENTS_KEY = `relayboard:${SEED_ID}:events`;
const META_KEY = `relayboard:${SEED_ID}:meta`;

interface SeedMeta {
  seedId: string;
  hash: string;
}

// In-memory mirror: used on the server (no window) and when localStorage
// throws or is unavailable. Never seeded with random/time values.
let memoryItems: Item[] | null = null;
let memoryEvents: Event[] = [];
let memoryMeta: SeedMeta | null = null;

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function readKey(key: string): string | null {
  if (!isBrowser()) return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeKey(key: string, value: string): boolean {
  if (!isBrowser()) return false;
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

// Canonical seed items as validated Item[] (fresh deep copy per call so
// callers can never mutate the imported seed payload). Seed order is the
// canonical order; listItems() preserves it (board sorts for display).
export function canonicalSeedItems(): Item[] {
  const raw = JSON.parse(JSON.stringify(seedData.items)) as unknown[];
  const items = raw.filter(validateItem);
  return items;
}

function canonicalSeedEvents(): Event[] {
  return [];
}

function buildMeta(): SeedMeta {
  return { seedId: SEED_ID, hash: canonicalSeedHash() };
}

function parseItems(raw: string | null): Item[] | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    if (!parsed.every(validateItem)) return null;
    return parsed as Item[];
  } catch {
    return null;
  }
}

function parseEvents(raw: string | null): Event[] | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed as Event[];
  } catch {
    return null;
  }
}

function persistAll(items: Item[], events: Event[], meta: SeedMeta): void {
  const itemsJson = JSON.stringify(items);
  const eventsJson = JSON.stringify(events);
  const metaJson = JSON.stringify(meta);
  // Byte-identical on repeat runs: same input objects serialize identically.
  writeKey(ITEMS_KEY, itemsJson);
  writeKey(EVENTS_KEY, eventsJson);
  writeKey(META_KEY, metaJson);
  memoryItems = JSON.parse(itemsJson) as Item[];
  memoryEvents = JSON.parse(eventsJson) as Event[];
  memoryMeta = JSON.parse(metaJson) as SeedMeta;
}

// Seed the store only when empty/malformed. Never wipes valid existing
// state (user submissions from P2+ survive). Safe to call on every mount.
export function ensureSeeded(): Item[] {
  const items = canonicalSeedItems();
  const events = canonicalSeedEvents();
  const meta = buildMeta();
  if (!isBrowser()) {
    if (memoryItems === null) {
      memoryItems = items;
      memoryEvents = events;
      memoryMeta = meta;
    }
    return memoryItems;
  }
  const stored = parseItems(readKey(ITEMS_KEY));
  const storedMeta = readKey(META_KEY);
  if (stored !== null && storedMeta !== null) {
    try {
      const m = JSON.parse(storedMeta) as Partial<SeedMeta>;
      if (m.seedId === SEED_ID && m.hash === meta.hash) {
        memoryItems = stored;
        memoryEvents = parseEvents(readKey(EVENTS_KEY)) ?? [];
        memoryMeta = m as SeedMeta;
        return stored;
      }
      // Same seed id but stale hash: keep user state, just refresh meta.
      if (m.seedId === SEED_ID) {
        writeKey(META_KEY, JSON.stringify(meta));
        memoryItems = stored;
        memoryEvents = parseEvents(readKey(EVENTS_KEY)) ?? [];
        memoryMeta = meta;
        return stored;
      }
    } catch {
      // Fall through to reseed on malformed meta.
    }
  }
  if (stored !== null && storedMeta === null) {
    // Items valid but meta missing (e.g. cleared keys): restore meta only.
    writeKey(META_KEY, JSON.stringify(meta));
    memoryItems = stored;
    memoryEvents = parseEvents(readKey(EVENTS_KEY)) ?? [];
    memoryMeta = meta;
    return stored;
  }
  persistAll(items, events, meta);
  return items;
}

// Overwrite the store with canonical seeds. Idempotent: byte-identical
// storage on repeat runs, no duplicates. Used by `?demo=1`.
export function reseedDemo(): Item[] {
  const items = canonicalSeedItems();
  persistAll(items, canonicalSeedEvents(), buildMeta());
  return items;
}

// List items in canonical seed order. Malformed/unavailable storage falls
// back to a full reseed so the board never renders a broken queue.
export function listItems(): Item[] {
  if (!isBrowser()) {
    return memoryItems ?? canonicalSeedItems();
  }
  const stored = parseItems(readKey(ITEMS_KEY));
  if (stored !== null) {
    memoryItems = stored;
    return stored;
  }
  // localStorage readable but malformed/absent: reseed fallback.
  // If writes also fail (quota), serve the in-memory mirror.
  const items = canonicalSeedItems();
  const meta = buildMeta();
  const ok = writeKey(ITEMS_KEY, JSON.stringify(items));
  if (!ok) {
    if (memoryItems === null) {
      memoryItems = items;
      memoryEvents = [];
      memoryMeta = meta;
    }
    return memoryItems;
  }
  persistAll(items, canonicalSeedEvents(), meta);
  return items;
}

export function getItem(id: string): Item | null {
  const found = listItems().find((i) => i.id === id);
  return found ?? null;
}

export function listEvents(): Event[] {
  if (!isBrowser()) return memoryEvents;
  const stored = parseEvents(readKey(EVENTS_KEY));
  if (stored !== null) {
    memoryEvents = stored;
    return stored;
  }
  return memoryEvents;
}

// Canonical JSON: recursive key sort, no whitespace (JSON.stringify emits
// none by default). MUST stay logic-identical to scripts/verify-seeds.mjs —
// reviewers cross-check `canonicalSeedHash()` against the script output.
function canonicalize(value: unknown): string {
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalize).join(",") + "]";
  }
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return (
      "{" +
      keys
        .map(
          (k) =>
            JSON.stringify(k) +
            ":" +
            canonicalize((value as Record<string, unknown>)[k]),
        )
        .join(",") +
      "}"
    );
  }
  return JSON.stringify(value) ?? "null";
}

// FNV-1a 32-bit over the UTF-8 bytes of the canonical JSON, returned as
// 8-char lowercase hex. Algorithm: h=0x811c9dc5; per byte h^=b, h*=0x01000193
// (32-bit); hex of h>>>0. MUST stay logic-identical to verify-seeds.mjs.
function fnv1a32(str: string): string {
  let h = 0x811c9dc5;
  const bytes = new TextEncoder().encode(str);
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function canonicalSeedHash(): string {
  return fnv1a32(canonicalize(seedData.items));
}
