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
import {
  canTransition,
  isCategory,
  isRole,
  validateEvent,
  validateItem,
  type Event,
  type Item,
  type Role,
  type Status,
} from "./schema";
import { classify, contentHashFor } from "./fallbacks";

export const SEED_ID = "campus-maint-v1";

const ITEMS_KEY = `relayboard:${SEED_ID}:items`;
const EVENTS_KEY = `relayboard:${SEED_ID}:events`;
const META_KEY = `relayboard:${SEED_ID}:meta`;

interface SeedMeta {
  seedId: string;
  hash: string;
  // P3 workflow counter: number of IDs issued past RPT-1010. Optional so
  // pre-P3 stored meta ({seedId, hash}) still parses; missing means 0.
  seq?: number;
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

// Deterministic fixture history: every seed carries its own created +
// classified events at the seed's fixed instant, so a fresh demo board
// shows a real timeline (F9) without any user action. Timestamps are
// fixture constants copied from the seed items, never generated here.
function canonicalSeedEvents(): Event[] {
  const events: Event[] = [];
  for (const item of canonicalSeedItems()) {
    events.push(
      {
        id: `${item.id}-evt-created`,
        itemId: item.id,
        actor: "student",
        type: "created",
        from: null,
        to: "open",
        at: item.createdAt,
      },
      {
        id: `${item.id}-evt-classified`,
        itemId: item.id,
        actor: "coordinator",
        type: "classified",
        from: "open",
        to: "open",
        note: "rule fallback",
        at: item.createdAt,
      },
    );
  }
  return events;
}

function buildMeta(): SeedMeta {
  return { seedId: SEED_ID, hash: canonicalSeedHash() };
}

// Per-record filtering (G3): one malformed stored record no longer wipes
// the whole queue/timeline. All-invalid or unparseable input still returns
// null so callers keep their corrupt-storage fallback. Exported for tests.
export function parseItems(raw: string | null): Item[] | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const valid = parsed.filter(validateItem);
    return valid.length > 0 || parsed.length === 0 ? valid : null;
  } catch {
    return null;
  }
}

export function parseEvents(raw: string | null): Event[] | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const valid = parsed.filter(validateEvent);
    return valid.length > 0 || parsed.length === 0 ? valid : null;
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

// ---------------------------------------------------------------------------
// P3 workflow mutations (append-only addition; P1/P2 functions above unchanged).
//
// Plain-text invariant: title/description/location are stored VERBATIM after
// trimming (no HTML stripping, no escaping at rest). Rendering relies on React
// auto-escaping — app/ must contain no raw-HTML injection sink (enforced by
// scripts/verify-workflow.mjs). Dup deferral: createItem ALWAYS sets duplicateOfId null (new-report dup
// DETECTION is deferred; only seeded duplicateOfId links are displayed).
// Role gate matrix (enforced in transitionItem):
//   student     -> create only; EVERY transition FAILS.
//   coordinator -> every allowlisted canTransition edge (incl. approve, reject,
//                  mark-duplicate via to="duplicate").
//   assignee    -> approved->in_progress and in_progress->resolved ONLY.
// ---------------------------------------------------------------------------

export interface CreateItemInput {
  title: unknown;
  description: unknown;
  location: unknown;
  category?: unknown;
  reporter?: unknown;
}

export type CreateItemResult =
  | { ok: true; item: Item; event: Event; events: Event[] }
  | { ok: false; error: string };

export type TransitionResult =
  | { ok: true; item: Item; event: Event }
  | { ok: false; error: string };

const NEXT_ID_BASE = 1011;

function readP3Meta(): SeedMeta {
  const fallback: SeedMeta = {
    seedId: SEED_ID,
    hash: canonicalSeedHash(),
    seq: 0,
  };
  try {
    if (!isBrowser()) {
      if (memoryMeta !== null && memoryMeta.seedId === SEED_ID) {
        const s = memoryMeta.seq;
        return {
          ...fallback,
          ...memoryMeta,
          hash: fallback.hash,
          seq:
            typeof s === "number" && Number.isInteger(s) && s >= 0 ? s : 0,
        };
      }
      return fallback;
    }
    const raw = readKey(META_KEY);
    if (raw === null) {
      if (memoryMeta !== null && memoryMeta.seedId === SEED_ID) {
        const s = memoryMeta.seq;
        return {
          ...fallback,
          ...memoryMeta,
          hash: fallback.hash,
          seq:
            typeof s === "number" && Number.isInteger(s) && s >= 0 ? s : 0,
        };
      }
      return fallback;
    }
    const m = JSON.parse(raw) as Partial<SeedMeta>;
    if (m.seedId !== SEED_ID) return fallback;
    const s = m.seq;
    return {
      seedId: SEED_ID,
      hash: fallback.hash,
      seq: typeof s === "number" && Number.isInteger(s) && s >= 0 ? s : 0,
    };
  } catch {
    return fallback;
  }
}

function persistP3State(
  items: Item[],
  events: Event[],
  meta: SeedMeta,
): void {
  const itemsJson = JSON.stringify(items);
  const eventsJson = JSON.stringify(events);
  const metaJson = JSON.stringify(meta);
  // Best-effort localStorage writes (quota/private-mode may fail); the
  // in-memory mirror is always updated so the queue still works (E11).
  writeKey(ITEMS_KEY, itemsJson);
  writeKey(EVENTS_KEY, eventsJson);
  writeKey(META_KEY, metaJson);
  memoryItems = JSON.parse(itemsJson) as Item[];
  memoryEvents = JSON.parse(eventsJson) as Event[];
  memoryMeta = JSON.parse(metaJson) as SeedMeta;
}

function nextSeqFor(items: Item[], metaSeq: number): number {
  let maxIssued = -1;
  for (const it of items) {
    const m = /^RPT-(\d+)$/.exec(it.id);
    if (m !== null) {
      const n = Number.parseInt(m[1], 10);
      if (Number.isInteger(n) && n >= NEXT_ID_BASE) {
        maxIssued = Math.max(maxIssued, n - NEXT_ID_BASE);
      }
    }
  }
  return metaSeq <= maxIssued ? maxIssued + 1 : metaSeq;
}

export function createItem(input: CreateItemInput): CreateItemResult {
  try {
    if (input === null || typeof input !== "object") {
      return { ok: false, error: "Invalid input." };
    }
    const o = input as unknown as Record<string, unknown>;
    if (
      typeof o.title !== "string" ||
      typeof o.description !== "string" ||
      typeof o.location !== "string"
    ) {
      return {
        ok: false,
        error: "Title, description and location must be strings.",
      };
    }
    // Trimmed for length checks; stored trimmed but otherwise VERBATIM
    // (HTML such as <script> is preserved as plain text; React escapes it).
    const title = o.title.trim();
    const description = o.description.trim();
    const location = o.location.trim();
    if (title.length < 4 || title.length > 120) {
      return {
        ok: false,
        error: "Field 'title' must be 4..120 characters.",
      };
    }
    if (description.length < 10 || description.length > 2000) {
      return {
        ok: false,
        error: "Field 'description' must be 10..2000 characters.",
      };
    }
    if (location.length < 2 || location.length > 80) {
      return {
        ok: false,
        error: "Field 'location' must be 2..80 characters.",
      };
    }
    let overrideCategory: Item["category"] | null = null;
    const catRaw = o.category;
    if (catRaw !== undefined && catRaw !== null && catRaw !== "") {
      if (!isCategory(catRaw)) {
        return { ok: false, error: "Invalid category." };
      }
      overrideCategory = catRaw;
    }
    // reporter (o.reporter) is intentionally NOT persisted: createdBy is
    // always "student" so no free-text PII leaves this path.

    const ticket = classify({ title, description, location });
    const category = overrideCategory ?? ticket.category;

    const items = listItems();
    const events = listEvents();
    const meta = readP3Meta();
    const seq = nextSeqFor(items, meta.seq ?? 0);
    const id = `RPT-${NEXT_ID_BASE + seq}`;
    const contentHash = contentHashFor({ title, description, location });
    const short = "#" + contentHash.slice(0, 4).toUpperCase();
    const now = new Date().toISOString();
    const item: Item = {
      id,
      short,
      title,
      description,
      location,
      category,
      severity: ticket.severity,
      priority_score: ticket.priority_score,
      status: "open",
      recommended_action: ticket.recommended_action,
      confidence: ticket.confidence,
      duplicateOfId: null,
      contentHash,
      createdBy: "student",
      createdAt: now,
      updatedAt: now,
      source: "fallback",
    };
    if (!validateItem(item)) {
      return { ok: false, error: "Classified item failed validation." };
    }
    const createdEvent: Event = {
      id: `${id}-created-${seq}`,
      itemId: id,
      actor: "student",
      type: "created",
      from: null,
      to: "open",
      at: now,
    };
    const classifiedEvent: Event = {
      id: `${id}-classified-${seq}`,
      itemId: id,
      actor: "student",
      type: "classified",
      from: null,
      to: "open",
      at: now,
    };
    if (!validateEvent(createdEvent) || !validateEvent(classifiedEvent)) {
      return { ok: false, error: "Event failed validation." };
    }
    persistP3State(
      [...items, item],
      [...events, createdEvent, classifiedEvent],
      { ...meta, seq: seq + 1 },
    );
    return {
      ok: true,
      item,
      event: createdEvent,
      events: [createdEvent, classifiedEvent],
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Storage failure.",
    };
  }
}

export function transitionItem(
  id: string,
  to: Status,
  actor: Role,
  note?: string,
  duplicateOfId?: string | null,
): TransitionResult {
  try {
    if (typeof id !== "string" || id.length === 0) {
      return { ok: false, error: "Unknown item." };
    }
    if (!isRole(actor)) {
      return { ok: false, error: "Invalid role." };
    }
    const validStatuses: readonly string[] = [
      "open",
      "approved",
      "in_progress",
      "resolved",
      "rejected",
      "duplicate",
    ];
    if (!validStatuses.includes(to)) {
      return { ok: false, error: `Invalid status '${String(to)}'.` };
    }
    if (note !== undefined && typeof note !== "string") {
      return { ok: false, error: "Note must be a string." };
    }
    const items = listItems();
    const found = items.find((i) => i.id === id) ?? null;
    if (found === null) {
      return { ok: false, error: `Unknown item '${id}'.` };
    }
    if (!validateItem(found)) {
      return { ok: false, error: "Stored item failed validation." };
    }
    const from = found.status;
    if (!canTransition(from, to)) {
      return {
        ok: false,
        error: `Transition ${from} -> ${to} is not allowed.`,
      };
    }
    // Role gate matrix (see header comment).
    if (actor === "student") {
      return { ok: false, error: "Students cannot change status." };
    }
    if (actor === "assignee") {
      const allowed =
        (from === "approved" && to === "in_progress") ||
        (from === "in_progress" && to === "resolved");
      if (!allowed) {
        return {
          ok: false,
          error: `Assignees cannot move ${from} -> ${to}.`,
        };
      }
    }

    let nextDuplicateOfId: string | null = found.duplicateOfId;
    if (to === "duplicate") {
      if (
        typeof duplicateOfId !== "string" ||
        duplicateOfId.trim().length === 0
      ) {
        return {
          ok: false,
          error: "Marking duplicate requires a target duplicateOfId.",
        };
      }
      const targetId = duplicateOfId.trim();
      if (targetId === id) {
        return {
          ok: false,
          error: "An item cannot duplicate itself.",
        };
      }
      const target = items.find((i) => i.id === targetId) ?? null;
      if (target === null) {
        return {
          ok: false,
          error: `Duplicate target '${targetId}' not found.`,
        };
      }
      nextDuplicateOfId = targetId;
    }

    const type: Event["type"] =
      to === "approved"
        ? "approved"
        : to === "rejected"
          ? "rejected"
          : to === "duplicate"
            ? "marked_duplicate"
            : "status_changed";
    const events = listEvents();
    const now = new Date().toISOString();
    const event: Event = {
      id: `${id}-${from}-to-${to}-${Date.now()}-${events.length}`,
      itemId: id,
      actor,
      type,
      from,
      to,
      at: now,
    };
    if (typeof note === "string" && note.length > 0) {
      event.note = note;
    }
    if (!validateEvent(event)) {
      return { ok: false, error: "Event failed validation." };
    }
    const next: Item = {
      ...found,
      status: to,
      duplicateOfId: nextDuplicateOfId,
      updatedAt: now,
    };
    if (!validateItem(next)) {
      return { ok: false, error: "Updated item failed validation." };
    }
    // Persist ONLY on success: failures above return before any write, so
    // no audit entry is appended for rejected transitions (E12).
    const nextItems = items.map((i) => (i.id === id ? next : i));
    persistP3State(
      nextItems,
      [...events, event],
      readP3Meta(),
    );
    return { ok: true, item: next, event };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Storage failure.",
    };
  }
}
