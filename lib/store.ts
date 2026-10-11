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
import challengePackData from "./seed-challenge-wifi-1.json";
import {
  canTransition,
  departmentForCategory,
  isCategory,
  isDepartment,
  isRole,
  validateEvent,
  validateIncident,
  validateIncidentEvent,
  validateItem,
  canTransitionIncident,
  type Department,
  type Event,
  type IncidentEvent,
  type Item,
  type MasterIncident,
  type Role,
  type Status,
} from "./schema";
import { classify, contentHashFor } from "./fallbacks";
import {
  matchReportToIncidents,
  type MatchBand,
  type MatchCandidate,
} from "./clustering";

export const SEED_ID = "campus-maint-v1";
// Challenge-1 demo pack namespace (isolated storage, ?seed= activation).
export const CHALLENGE_SEED_ID = "challenge-wifi-1";

export interface SeedMeta {
  seedId: string;
  hash: string;
  // P3 workflow counter: number of IDs issued past RPT-1010. Optional so
  // pre-P3 stored meta ({seedId, hash}) still parses; missing means 0.
  seq?: number;
  // Challenge-1 incident counter: number of INC ids issued past INC-1100.
  // Separate from seq so report sequencing (RPT-1011+, verified by
  // scripts/verify-workflow.mjs) is never disturbed. Missing means 0.
  incidentSeq?: number;
}

// F hardening: user-controlled note/reason strings are type-checked AND
// length-capped so unbounded text can't bloat localStorage or the timeline.
export const MAX_NOTE_CHARS = 500;
export function invalidNoteText(u: unknown): string | null {
  if (u === undefined) return null;
  if (typeof u !== "string") return "Note must be a string.";
  if (u.length > MAX_NOTE_CHARS) {
    return `Note must be at most ${MAX_NOTE_CHARS} characters.`;
  }
  return null;
}
export function invalidReasonText(reason: unknown, action: string): string | null {
  if (typeof reason !== "string" || reason.trim().length === 0) {
    return `A reason is required to ${action}.`;
  }
  if (reason.length > MAX_NOTE_CHARS) {
    return `Reason must be at most ${MAX_NOTE_CHARS} characters.`;
  }
  return null;
}
// In-memory mirror: used on the server (no window) and when localStorage
// throws or is unavailable. Never seeded with random/time values.
let memoryItems: Item[] | null = null;
let memoryEvents: Event[] = [];
let memoryMeta: SeedMeta | null = null;
// Challenge-1 mirrors: null = not yet persisted this session (lazy
// derive/pack-fixture path); non-null = persisted snapshot.
let memoryIncidents: MasterIncident[] | null = null;
let memoryIncidentEvents: IncidentEvent[] = [];

// AD-5 seed namespaces: ?seed=<id> isolates storage per pack. Only
// registered pack ids are selectable; today the registry holds the canonical
// pack plus the Challenge-1 demo pack. Authoring a new pack (<60min path):
// add its items/events providers beside canonicalSeedItems/canonicalSeedEvents,
// append its id to REGISTERED_SEED_IDS, and extend packItems()/packEvents()
// (+ packIncidents()/packIncidentEvents() when the pack ships explicit
// incident fixtures) to serve it.
export const REGISTERED_SEED_IDS: readonly string[] = [
  SEED_ID,
  CHALLENGE_SEED_ID,
];

let activeSeedId: string = SEED_ID;

export function getActiveSeedId(): string {
  return activeSeedId;
}

// Returns false (and changes nothing) for unknown ids — callers keep the
// default namespace. Resets the in-memory mirrors so the newly active
// namespace loads fresh on the next read.
export function setActiveSeedId(id: unknown): boolean {
  if (typeof id !== "string" || !REGISTERED_SEED_IDS.includes(id)) {
    return false;
  }
  if (id !== activeSeedId) {
    activeSeedId = id;
    memoryItems = null;
    memoryEvents = [];
    memoryMeta = null;
    memoryIncidents = null;
    memoryIncidentEvents = [];
  }
  return true;
}

// Pure key derivation (exported for tests): per-pack namespaces can never
// collide with each other or with the prefs key. Challenge-1 ADDS the
// incidents/incidentEvents keys; items/events/meta values are unchanged
// (scripts/verify-workflow.mjs asserts the canonical three exactly).
export function queueKeys(seedId: string): {
  items: string;
  events: string;
  meta: string;
  incidents: string;
  incidentEvents: string;
} {
  return {
    items: `relayboard:${seedId}:items`,
    events: `relayboard:${seedId}:events`,
    meta: `relayboard:${seedId}:meta`,
    incidents: `relayboard:${seedId}:incidents`,
    incidentEvents: `relayboard:${seedId}:incident_events`,
  };
}

// One vote per browser namespace for verification display (latest wins;
// every vote still appends an audit event). Exported for UI + tests.
export function verifyVoteKey(seedId: string, incidentId: string): string {
  return `relayboard:${seedId}:verify:${incidentId}`;
}

// Pack content for the active namespace. Only registered packs serve
// content; any other active id yields empty lists (never foreign content
// under a new id).
function packItems(): Item[] {
  if (activeSeedId === CHALLENGE_SEED_ID) return challengeSeedItems();
  if (activeSeedId !== SEED_ID) return [];
  return canonicalSeedItems();
}

function packEvents(): Event[] {
  if (activeSeedId === CHALLENGE_SEED_ID) return challengeSeedEvents();
  if (activeSeedId !== SEED_ID) return [];
  return canonicalSeedEvents();
}

// Challenge-1 pack items/events/incidents: explicit fixtures from
// lib/seed-challenge-wifi-1.json (fresh deep copies so callers can never
// mutate the imported payload). Items carry incidentId backfills matching
// the explicit incidents below, so the pack board is stable on first paint.
export function challengeSeedItems(): Item[] {
  const raw = JSON.parse(
    JSON.stringify(
      (challengePackData as unknown as { items: unknown }).items,
    ),
  ) as unknown[];
  return raw.filter(validateItem);
}

function challengeSeedEvents(): Event[] {
  const raw = JSON.parse(
    JSON.stringify(
      (challengePackData as unknown as { events: unknown }).events,
    ),
  ) as unknown[];
  return raw.filter(validateEvent);
}

// Explicit incident fixtures for the demo pack ONLY (resolved+verified
// INC-2106 needs synthetic history that lazy derivation never fabricates —
// those events are labeled "synthetic demo fixture" and the DEMO guide says
// so). The canonical namespace NEVER serves fixtures here: it always
// derives via deriveIncidents() with EMPTY incident events.
function packIncidents(): MasterIncident[] {
  if (activeSeedId !== CHALLENGE_SEED_ID) return [];
  const raw = JSON.parse(
    JSON.stringify(
      (challengePackData as unknown as { incidents: unknown }).incidents,
    ),
  ) as unknown[];
  return raw.filter(validateIncident);
}

function packIncidentEvents(): IncidentEvent[] {
  if (activeSeedId !== CHALLENGE_SEED_ID) return [];
  const raw = JSON.parse(
    JSON.stringify(
      (challengePackData as unknown as { incidentEvents: unknown })
        .incidentEvents,
    ),
  ) as unknown[];
  return raw.filter(validateIncidentEvent);
}

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
  return {
    seedId: activeSeedId,
    hash: activeSeedId === SEED_ID ? canonicalSeedHash() : "no-pack",
  };
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
  writeKey(queueKeys(activeSeedId).items, itemsJson);
  writeKey(queueKeys(activeSeedId).events, eventsJson);
  writeKey(queueKeys(activeSeedId).meta, metaJson);
  memoryItems = JSON.parse(itemsJson) as Item[];
  memoryEvents = JSON.parse(eventsJson) as Event[];
  memoryMeta = JSON.parse(metaJson) as SeedMeta;
}

// Seed the store only when empty/malformed. Never wipes valid existing
// state (user submissions from P2+ survive). Safe to call on every mount.
export function ensureSeeded(): Item[] {
  const items = packItems();
  const events = packEvents();
  const meta = buildMeta();
  if (!isBrowser()) {
    if (memoryItems === null) {
      memoryItems = items;
      memoryEvents = events;
      memoryMeta = meta;
    }
    return memoryItems;
  }
  const stored = parseItems(readKey(queueKeys(activeSeedId).items));
  const storedMeta = readKey(queueKeys(activeSeedId).meta);
  if (stored !== null && storedMeta !== null) {
    try {
      const m = JSON.parse(storedMeta) as Partial<SeedMeta>;
      if (m.seedId === activeSeedId && m.hash === meta.hash) {
        memoryItems = stored;
        memoryEvents = parseEvents(readKey(queueKeys(activeSeedId).events)) ?? [];
        memoryMeta = m as SeedMeta;
        return stored;
      }
      // Same seed id but stale hash: keep user state, just refresh meta.
      if (m.seedId === activeSeedId) {
        writeKey(queueKeys(activeSeedId).meta, JSON.stringify(meta));
        memoryItems = stored;
        memoryEvents = parseEvents(readKey(queueKeys(activeSeedId).events)) ?? [];
        memoryMeta = meta;
        return stored;
      }
    } catch {
      // Fall through to reseed on malformed meta.
    }
  }
  if (stored !== null && storedMeta === null) {
    // Items valid but meta missing (e.g. cleared keys): restore meta only.
    writeKey(queueKeys(activeSeedId).meta, JSON.stringify(meta));
    memoryItems = stored;
    memoryEvents = parseEvents(readKey(queueKeys(activeSeedId).events)) ?? [];
    memoryMeta = meta;
    return stored;
  }
  persistAll(items, events, meta);
  return items;
}

// Overwrite the store with canonical seeds. Idempotent: byte-identical
// storage on repeat runs, no duplicates. Used by `?demo=1`. Challenge-1:
// also resets the incident layer (in-memory mirrors + stored incident keys)
// so the next listIncidents() lazily re-derives (canonical) or re-serves
// pack fixtures (challenge). Report-level behavior is unchanged.
export function reseedDemo(): Item[] {
  const items = packItems();
  persistAll(items, packEvents(), buildMeta());
  memoryIncidents = null;
  memoryIncidentEvents = [];
  if (isBrowser()) {
    try {
      window.localStorage.removeItem(queueKeys(activeSeedId).incidents);
      window.localStorage.removeItem(queueKeys(activeSeedId).incidentEvents);
    } catch {
      // Storage unavailable: mirrors above already reset.
    }
  }
  return items;
}

// List items in canonical seed order. Malformed/unavailable storage falls
// back to a full reseed so the board never renders a broken queue.
export function listItems(): Item[] {
  if (!isBrowser()) {
    return memoryItems ?? packItems();
  }
  const stored = parseItems(readKey(queueKeys(activeSeedId).items));
  if (stored !== null) {
    memoryItems = stored;
    return stored;
  }
  // localStorage readable but malformed/absent: reseed fallback.
  // If writes also fail (quota), serve the in-memory mirror.
  const items = packItems();
  const meta = buildMeta();
  const ok = writeKey(queueKeys(activeSeedId).items, JSON.stringify(items));
  if (!ok) {
    if (memoryItems === null) {
      memoryItems = items;
      memoryEvents = packEvents();
      memoryMeta = meta;
    }
    return memoryItems;
  }
  persistAll(items, packEvents(), meta);
  return items;
}

export function getItem(id: string): Item | null {
  const found = listItems().find((i) => i.id === id);
  return found ?? null;
}

export function listEvents(): Event[] {
  if (!isBrowser()) return memoryEvents;
  const stored = parseEvents(readKey(queueKeys(activeSeedId).events));
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
    seedId: activeSeedId,
    hash: activeSeedId === SEED_ID ? canonicalSeedHash() : "no-pack",
    seq: 0,
    incidentSeq: 0,
  };
  const normalizeSeq = (s: unknown): number =>
    typeof s === "number" && Number.isInteger(s) && s >= 0 ? s : 0;
  try {
    if (!isBrowser()) {
      if (memoryMeta !== null && memoryMeta.seedId === activeSeedId) {
        return {
          ...fallback,
          ...memoryMeta,
          hash: fallback.hash,
          seq: normalizeSeq(memoryMeta.seq),
          incidentSeq: normalizeSeq(memoryMeta.incidentSeq),
        };
      }
      return fallback;
    }
    const raw = readKey(queueKeys(activeSeedId).meta);
    if (raw === null) {
      if (memoryMeta !== null && memoryMeta.seedId === activeSeedId) {
        return {
          ...fallback,
          ...memoryMeta,
          hash: fallback.hash,
          seq: normalizeSeq(memoryMeta.seq),
          incidentSeq: normalizeSeq(memoryMeta.incidentSeq),
        };
      }
      return fallback;
    }
    const m = JSON.parse(raw) as Partial<SeedMeta>;
    if (m.seedId !== activeSeedId) return fallback;
    return {
      seedId: activeSeedId,
      hash: fallback.hash,
      seq: normalizeSeq(m.seq),
      incidentSeq: normalizeSeq(m.incidentSeq),
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
  writeKey(queueKeys(activeSeedId).items, itemsJson);
  writeKey(queueKeys(activeSeedId).events, eventsJson);
  writeKey(queueKeys(activeSeedId).meta, metaJson);
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
    const noteErr = invalidNoteText(note);
    if (noteErr !== null) {
      return { ok: false, error: noteErr };
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
      // P4-C cycle prevention: walk the target's duplicateOfId chain (cap 50
      // hops, bounded). Reject when the chain reaches the source id — no
      // A→B→A cycles. Self/unknown/empty targets are already rejected above.
      let cursor: string | null = targetId;
      for (let hop = 0; hop < 50; hop++) {
        if (cursor === null) break;
        if (cursor === id) {
          return {
            ok: false,
            error: "Marking duplicate would create a cycle.",
          };
        }
        const current = items.find((i) => i.id === cursor) ?? null;
        if (current === null) break;
        cursor = current.duplicateOfId;
      }
      if (cursor === id) {
        return {
          ok: false,
          error: "Marking duplicate would create a cycle.",
        };
      }
      nextDuplicateOfId = targetId;
    }

    // P4-C reversal: duplicate→open (coordinator only) clears the hard link.
    // The role matrix above already blocks students (all transitions) and
    // assignees (only approved→in_progress→resolved), but the explicit check
    // keeps the error specific. History is preserved: a "status_changed"
    // event (existing enum, from duplicate→open) is appended below and no
    // prior event is removed.
    if (from === "duplicate" && to === "open") {
      if (actor !== "coordinator") {
        return {
          ok: false,
          error: "Only coordinators can clear a duplicate link.",
        };
      }
      nextDuplicateOfId = null;
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

// ---------------------------------------------------------------------------
// Challenge-1 incident layer (append-only addition; every P1–P4 function
// above is behavior-identical).
//
// Lazy migration: listIncidents() derives from items in memory while the
// :incidents key is absent and persists to the NEW incidents/incident_events
// keys on the first incident mutation. Report items/events payloads are
// never rewritten except the additive incidentId backfill on attach/move.
// Derived canonical incidents start with EMPTY incident events (no
// fabricated history); the UI shows attached reports (which carry their own
// P3 history) plus a "history starts with your first action" empty state.
// ---------------------------------------------------------------------------

export type IncidentResult =
  | { ok: true; incident: MasterIncident; event: IncidentEvent }
  | { ok: false; error: string };

export type SubmitClusteringResult =
  | {
      ok: true;
      item: Item;
      incident: MasterIncident;
      attached: boolean;
      band: MatchBand;
      score: number | null;
      message: string;
      candidates: MatchCandidate[];
    }
  | { ok: false; error: string };

// Per-record filtering for the incident keys (same G3 pattern as
// parseItems/parseEvents): one malformed record never wipes the layer.
export function parseIncidents(raw: string | null): MasterIncident[] | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const valid = parsed.filter(validateIncident);
    return valid.length > 0 || parsed.length === 0 ? valid : null;
  } catch {
    return null;
  }
}

export function parseIncidentEvents(
  raw: string | null,
): IncidentEvent[] | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const valid = parsed.filter(validateIncidentEvent);
    return valid.length > 0 || parsed.length === 0 ? valid : null;
  } catch {
    return null;
  }
}

// Progress rank for migration status: the canonical incident takes the
// furthest-progressed member status. Terminal report states (rejected,
// duplicate) rank below open so one closed report never drags a live
// cluster backwards; all-rejected/all-duplicate groups keep that state.
const MIGRATION_STATUS_RANK: Record<Status, number> = {
  open: 0,
  approved: 1,
  in_progress: 2,
  resolved: 3,
  rejected: -1,
  duplicate: -2,
};

// Pure migration: group items by duplicateOfId roots (bounded 50-hop walk;
// orphans whose target is missing group under the dangling item, lone
// items are singletons), survivor = oldest createdAt (tie: smallest id),
// incident id INC-<survivor numeric suffix>. Canonical fields come from the
// survivor; department is derived; status is max member progress;
// attachedReportIds are survivor-first. No events are fabricated here.
export function deriveIncidents(items: Item[]): MasterIncident[] {
  if (!Array.isArray(items)) return [];
  const valid = items.filter(validateItem);
  const byId = new Map<string, Item>(valid.map((i) => [i.id, i]));

  function rootOf(startId: string): string {
    let cur = startId;
    const seen = new Set<string>([startId]);
    for (let hop = 0; hop < 50; hop++) {
      const it = byId.get(cur);
      if (it === undefined || it.duplicateOfId === null) return cur;
      const nxt = it.duplicateOfId;
      if (nxt === cur || seen.has(nxt)) return cur;
      if (!byId.has(nxt)) return cur;
      seen.add(nxt);
      cur = nxt;
    }
    return cur;
  }

  const groups = new Map<string, Item[]>();
  for (const it of valid) {
    const root = rootOf(it.id);
    const list = groups.get(root);
    if (list === undefined) groups.set(root, [it]);
    else list.push(it);
  }

  const out: MasterIncident[] = [];
  groups.forEach((members) => {
    const sorted = [...members].sort((a, b) => {
      const ta = Date.parse(a.createdAt);
      const tb = Date.parse(b.createdAt);
      if (ta !== tb) return ta - tb;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    const survivor = sorted[0];
    const suffixMatch = /(\d+)$/.exec(survivor.id);
    const suffix = suffixMatch !== null ? suffixMatch[1] : "0";
    let status: Status = survivor.status;
    let best = MIGRATION_STATUS_RANK[survivor.status] ?? 0;
    for (const m of sorted) {
      const r = MIGRATION_STATUS_RANK[m.status] ?? 0;
      if (r > best) {
        best = r;
        status = m.status;
      }
    }
    let updatedAt = survivor.updatedAt;
    for (const m of sorted) {
      if (Date.parse(m.updatedAt) > Date.parse(updatedAt)) {
        updatedAt = m.updatedAt;
      }
    }
    const incident: MasterIncident = {
      id: `INC-${suffix}`,
      title: survivor.title,
      category: survivor.category,
      severity: survivor.severity,
      locationLabel: survivor.location,
      department: departmentForCategory(survivor.category, survivor.severity),
      status,
      attachedReportIds: sorted.map((m) => m.id),
      mergedIntoId: null,
      createdFrom: survivor.id,
      createdAt: survivor.createdAt,
      updatedAt,
      verification: { state: "unverified", by: null, at: null },
    };
    if (validateIncident(incident)) out.push(incident);
  });
  out.sort((a, b) => {
    const ta = Date.parse(a.createdAt);
    const tb = Date.parse(b.createdAt);
    if (ta !== tb) return ta - tb;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return out;
}

// Canonical list: stored snapshot when the :incidents key exists, otherwise
// pack fixtures (challenge pack only) or lazy derivation (canonical, never
// persisted by a read — only incident mutations persist).
export function listIncidents(): MasterIncident[] {
  if (!isBrowser()) {
    if (memoryIncidents !== null) return memoryIncidents;
    if (activeSeedId === CHALLENGE_SEED_ID) return packIncidents();
    return deriveIncidents(memoryItems ?? packItems());
  }
  const stored = parseIncidents(readKey(queueKeys(activeSeedId).incidents));
  if (stored !== null) {
    memoryIncidents = stored;
    return stored;
  }
  if (activeSeedId === CHALLENGE_SEED_ID) return packIncidents();
  return deriveIncidents(listItems());
}

export function listIncidentEvents(): IncidentEvent[] {
  if (!isBrowser()) {
    // Persisted this session (mutations set memoryIncidents) -> snapshot;
    // otherwise pack fixtures (challenge) or EMPTY (canonical derivation
    // fabricates no history).
    if (memoryIncidents !== null) return memoryIncidentEvents;
    if (activeSeedId === CHALLENGE_SEED_ID) return packIncidentEvents();
    return [];
  }
  const hasStored =
    parseIncidents(readKey(queueKeys(activeSeedId).incidents)) !== null;
  if (hasStored) {
    const stored = parseIncidentEvents(
      readKey(queueKeys(activeSeedId).incidentEvents),
    );
    if (stored !== null) {
      memoryIncidentEvents = stored;
      return stored;
    }
    return memoryIncidentEvents;
  }
  if (activeSeedId === CHALLENGE_SEED_ID) return packIncidentEvents();
  return [];
}

export function getIncident(id: string): MasterIncident | null {
  const found = listIncidents().find((i) => i.id === id);
  return found ?? null;
}

// Follow merge aliases deterministically (50-hop cap). Returns the canonical
// incident, or null when unknown / dangling / cyclic.
export function resolveIncident(id: string): MasterIncident | null {
  if (typeof id !== "string" || id.length === 0) return null;
  const incidents = listIncidents();
  const byId = new Map(incidents.map((i) => [i.id, i]));
  let cur: MasterIncident | null = byId.get(id) ?? null;
  for (let hop = 0; hop < 50; hop++) {
    if (cur === null) return null;
    if (cur.mergedIntoId === null) return cur;
    cur = byId.get(cur.mergedIntoId) ?? null;
  }
  return null;
}

function persistIncidentState(opts: {
  incidents: MasterIncident[];
  events: IncidentEvent[];
  meta: SeedMeta;
  items?: Item[];
}): void {
  const k = queueKeys(activeSeedId);
  writeKey(k.incidents, JSON.stringify(opts.incidents));
  writeKey(k.incidentEvents, JSON.stringify(opts.events));
  writeKey(k.meta, JSON.stringify(opts.meta));
  memoryIncidents = JSON.parse(JSON.stringify(opts.incidents)) as MasterIncident[];
  memoryIncidentEvents = JSON.parse(
    JSON.stringify(opts.events),
  ) as IncidentEvent[];
  memoryMeta = JSON.parse(JSON.stringify(opts.meta)) as SeedMeta;
  if (opts.items !== undefined) {
    writeKey(k.items, JSON.stringify(opts.items));
    memoryItems = JSON.parse(JSON.stringify(opts.items)) as Item[];
  }
}

function nextIncidentId(
  incidents: MasterIncident[],
  seq: number,
): { id: string; nextSeq: number } {
  const ids = new Set(incidents.map((i) => i.id));
  let s = seq;
  while (ids.has(`INC-${1100 + s}`)) s++;
  return { id: `INC-${1100 + s}`, nextSeq: s + 1 };
}

// True once the incident layer has been explicitly persisted (first
// mutation). While false, listIncidents() is a live derivation where a new
// report shows up as its own singleton placeholder — attach/create collapse
// that placeholder instead of failing, because it represents "ungrouped",
// not a real grouping decision. Persisted singletons are never collapsed
// (their history must survive; moving their only member out is rejected).
function incidentsArePersisted(): boolean {
  if (!isBrowser()) return memoryIncidents !== null;
  return (
    parseIncidents(readKey(queueKeys(activeSeedId).incidents)) !== null
  );
}

function backfillIncidentId(
  items: Item[],
  reportIds: readonly string[],
  incidentId: string,
): Item[] {
  const set = new Set(reportIds);
  return items.map((i) =>
    set.has(i.id) ? { ...i, incidentId } : i,
  );
}

export function createIncidentForReport(
  reportId: string,
  actor: Role,
  note?: string,
): IncidentResult {
  try {
    if (!isRole(actor)) return { ok: false, error: "Invalid role." };
    // F hardening: incident creation is coordinator-only, like every other
    // incident-structure mutation. The submit flow calls with "coordinator"
    // internally (submitReportWithClustering); direct callers must too.
    if (actor !== "coordinator") {
      return { ok: false, error: "Only coordinators can create incidents." };
    }
    const noteErr = invalidNoteText(note);
    if (noteErr !== null) {
      return { ok: false, error: noteErr };
    }
    const items = listItems();
    const report = items.find((i) => i.id === reportId) ?? null;
    if (report === null || !validateItem(report)) {
      return { ok: false, error: `Unknown report '${reportId}'.` };
    }
    const incidents = listIncidents();
    const holder = incidents.find((inc) =>
      inc.attachedReportIds.includes(reportId),
    ) ?? null;
    if (holder !== null) {
      // Collapse an unpersisted derivation placeholder (the report's own
      // singleton): it stands for "ungrouped", not a decision. A persisted
      // grouping is never silently replaced.
      const placeholder =
        holder.attachedReportIds.length === 1 &&
        !incidentsArePersisted();
      if (!placeholder) {
        return { ok: false, error: "Report is already grouped." };
      }
    }
    const working =
      holder !== null
        ? incidents.filter((inc) => inc.id !== holder.id)
        : incidents;
    const meta = readP3Meta();
    const { id, nextSeq } = nextIncidentId(working, meta.incidentSeq ?? 0);
    const now = new Date().toISOString();
    const incident: MasterIncident = {
      id,
      title: report.title,
      category: report.category,
      severity: report.severity,
      locationLabel: report.location,
      department: departmentForCategory(report.category, report.severity),
      status: "open",
      attachedReportIds: [reportId],
      mergedIntoId: null,
      createdFrom: reportId,
      createdAt: report.createdAt,
      updatedAt: now,
      verification: { state: "unverified", by: null, at: null },
    };
    if (!validateIncident(incident)) {
      return { ok: false, error: "Incident failed validation." };
    }
    const event: IncidentEvent = {
      id: `${id}-evt-created`,
      incidentId: id,
      reportId,
      actor,
      type: "incident_created",
      from: null,
      to: "open",
      at: now,
    };
    if (typeof note === "string" && note.length > 0) event.note = note;
    if (!validateIncidentEvent(event)) {
      return { ok: false, error: "Event failed validation." };
    }
    persistIncidentState({
      incidents: [...working, incident],
      events: [...listIncidentEvents(), event],
      meta: { ...meta, incidentSeq: nextSeq },
      items: backfillIncidentId(items, [reportId], id),
    });
    return { ok: true, incident, event };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Storage failure.",
    };
  }
}

// Attach (or move) a report to a canonical incident. Coordinator-only:
// candidate review and the submit-flow auto-attach both run with coordinator
// authority and record it in the event. Attaching an already-member report
// to the same incident fails with zero side effects (no-dup-attach).
export function attachReportToIncident(
  reportId: string,
  incidentId: string,
  actor: Role,
  note?: string,
): IncidentResult {
  try {
    if (!isRole(actor)) return { ok: false, error: "Invalid role." };
    if (actor !== "coordinator") {
      return { ok: false, error: "Only coordinators can attach reports." };
    }
    const noteErr = invalidNoteText(note);
    if (noteErr !== null) {
      return { ok: false, error: noteErr };
    }
    const items = listItems();
    const report = items.find((i) => i.id === reportId) ?? null;
    if (report === null || !validateItem(report)) {
      return { ok: false, error: `Unknown report '${reportId}'.` };
    }
    const target = resolveIncident(incidentId);
    if (target === null) {
      return { ok: false, error: `Unknown incident '${incidentId}'.` };
    }
    if (target.attachedReportIds.includes(reportId)) {
      return { ok: false, error: "Report is already attached." };
    }
    const incidents = listIncidents();
    let oldIncidentId: string | null = null;
    let collapsePlaceholder = false;
    for (const inc of incidents) {
      if (inc.id !== target.id && inc.attachedReportIds.includes(reportId)) {
        oldIncidentId = inc.id;
        // Same placeholder rule as createIncidentForReport: an unpersisted
        // derivation singleton for this very report collapses (it is
        // deleted as its member moves); a persisted singleton keeps its
        // history and the move is rejected below instead.
        collapsePlaceholder =
          inc.attachedReportIds.length === 1 && !incidentsArePersisted();
        break;
      }
    }
    const now = new Date().toISOString();
    let next = incidents.map((inc) => {
      if (inc.id === target.id) {
        return {
          ...inc,
          attachedReportIds: [...inc.attachedReportIds, reportId],
          updatedAt: now,
        };
      }
      if (inc.id === oldIncidentId && !collapsePlaceholder) {
        return {
          ...inc,
          attachedReportIds: inc.attachedReportIds.filter(
            (r) => r !== reportId,
          ),
          updatedAt: now,
        };
      }
      return inc;
    });
    if (collapsePlaceholder && oldIncidentId !== null) {
      next = next.filter((inc) => inc.id !== oldIncidentId);
    }
    // A move must never leave an incident empty (non-empty invariant):
    // dropping the only member is rejected instead.
    const emptied = next.find(
      (inc) =>
        inc.id === oldIncidentId && inc.attachedReportIds.length === 0,
    );
    if (emptied !== undefined) {
      return {
        ok: false,
        error: "Cannot move the only report out of its incident.",
      };
    }
    const event: IncidentEvent = {
      id: `${target.id}-attach-${reportId}-${Date.now()}-${listIncidentEvents().length}`,
      incidentId: target.id,
      reportId,
      actor,
      type: "report_attached",
      from: oldIncidentId,
      to: target.id,
      at: now,
    };
    if (typeof note === "string" && note.length > 0) event.note = note;
    if (!validateIncidentEvent(event)) {
      return { ok: false, error: "Event failed validation." };
    }
    const updated = next.find((inc) => inc.id === target.id);
    if (updated === undefined || !validateIncident(updated)) {
      return { ok: false, error: "Incident failed validation." };
    }
    persistIncidentState({
      incidents: next,
      events: [...listIncidentEvents(), event],
      meta: readP3Meta(),
      items: backfillIncidentId(items, [reportId], target.id),
    });
    return { ok: true, incident: updated, event };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Storage failure.",
    };
  }
}

// Merge source into target (coordinator + reason required). Both must exist,
// be canonical (mergedIntoId null) and distinct; a 50-hop cycle walk runs in
// BOTH directions. Attachments move as a deduped union; the source keeps its
// historical member list (non-empty invariant) but resolves to the target,
// flips to duplicate and gains mergedIntoId. Full history is kept on both
// sides (no event is deleted); one incident_merged event is appended to the
// target. Repeats fail with zero side effects.
export function mergeIncidents(
  sourceId: string,
  targetId: string,
  actor: Role,
  reason: string,
): IncidentResult {
  try {
    if (!isRole(actor)) return { ok: false, error: "Invalid role." };
    if (actor !== "coordinator") {
      return { ok: false, error: "Only coordinators can merge." };
    }
    const mergeReasonErr = invalidReasonText(reason, "merge");
    if (mergeReasonErr !== null) {
      return { ok: false, error: mergeReasonErr };
    }
    const incidents = listIncidents();
    const byId = new Map<string, MasterIncident>(
      incidents.map((i) => [i.id, i] as [string, MasterIncident]),
    );
    const source = byId.get(sourceId) ?? null;
    const target = byId.get(targetId) ?? null;
    if (source === null) {
      return { ok: false, error: `Unknown incident '${sourceId}'.` };
    }
    if (target === null) {
      return { ok: false, error: `Unknown incident '${targetId}'.` };
    }
    if (sourceId === targetId) {
      return { ok: false, error: "Cannot merge an incident into itself." };
    }
    if (source.mergedIntoId !== null || target.mergedIntoId !== null) {
      return { ok: false, error: "Only canonical incidents can merge." };
    }
    // 50-hop cycle walk, both directions.
    for (const [from, to] of [
      [targetId, sourceId],
      [sourceId, targetId],
    ] as const) {
      let cursor: string | null = from;
      for (let hop = 0; hop < 50; hop++) {
        if (cursor === null) break;
        if (cursor === to && cursor !== from) {
          return {
            ok: false,
            error: "Merging would create a cycle.",
          };
        }
        const found: MasterIncident | null = byId.get(cursor) ?? null;
        if (found === null) break;
        cursor = found.mergedIntoId;
      }
      if (cursor === to && cursor !== from) {
        return { ok: false, error: "Merging would create a cycle." };
      }
    }
    const now = new Date().toISOString();
    const union = [
      ...target.attachedReportIds,
      ...source.attachedReportIds.filter(
        (r) => !target.attachedReportIds.includes(r),
      ),
    ];
    const moved = source.attachedReportIds.filter(
      (r) => !target.attachedReportIds.includes(r),
    );
    const next = incidents.map((inc) => {
      if (inc.id === targetId) {
        return { ...inc, attachedReportIds: union, updatedAt: now };
      }
      if (inc.id === sourceId) {
        return {
          ...inc,
          status: "duplicate" as Status,
          mergedIntoId: targetId,
          updatedAt: now,
        };
      }
      return inc;
    });
    const event: IncidentEvent = {
      id: `${targetId}-merged-${sourceId}-${Date.now()}-${listIncidentEvents().length}`,
      incidentId: targetId,
      reportId: null,
      actor,
      type: "incident_merged",
      from: sourceId,
      to: targetId,
      at: now,
      note: reason.trim(),
    };
    if (!validateIncidentEvent(event)) {
      return { ok: false, error: "Event failed validation." };
    }
    const updatedTarget = next.find((inc) => inc.id === targetId);
    const updatedSource = next.find((inc) => inc.id === sourceId);
    if (
      updatedTarget === undefined ||
      updatedSource === undefined ||
      !validateIncident(updatedTarget) ||
      !validateIncident(updatedSource)
    ) {
      return { ok: false, error: "Incident failed validation." };
    }
    const items = listItems();
    persistIncidentState({
      incidents: next,
      events: [...listIncidentEvents(), event],
      meta: readP3Meta(),
      items:
        moved.length > 0
          ? backfillIncidentId(items, moved, targetId)
          : undefined,
    });
    return { ok: true, incident: updatedTarget, event };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Storage failure.",
    };
  }
}

// Reclassify (coordinator + reason required). The canonical category changes
// ONLY here via a reclassified event (old->new); Item originals are NEVER
// mutated. Department is kept (use reassign to change it).
export function reclassifyIncident(
  id: string,
  newCategory: Item["category"],
  actor: Role,
  reason: string,
): IncidentResult {
  try {
    if (!isRole(actor)) return { ok: false, error: "Invalid role." };
    if (actor !== "coordinator") {
      return { ok: false, error: "Only coordinators can reclassify." };
    }
    if (!isCategory(newCategory)) {
      return { ok: false, error: "Invalid category." };
    }
    const reclassifyReasonErr = invalidReasonText(reason, "reclassify");
    if (reclassifyReasonErr !== null) {
      return { ok: false, error: reclassifyReasonErr };
    }
    const incidents = listIncidents();
    const found = incidents.find((i) => i.id === id) ?? null;
    if (found === null || !validateIncident(found)) {
      return { ok: false, error: `Unknown incident '${id}'.` };
    }
    if (found.mergedIntoId !== null) {
      return { ok: false, error: "Only canonical incidents can change." };
    }
    if (found.category === newCategory) {
      return { ok: false, error: "Category is already set." };
    }
    const now = new Date().toISOString();
    const updated: MasterIncident = {
      ...found,
      category: newCategory,
      updatedAt: now,
    };
    if (!validateIncident(updated)) {
      return { ok: false, error: "Incident failed validation." };
    }
    const event: IncidentEvent = {
      id: `${id}-reclassified-${Date.now()}-${listIncidentEvents().length}`,
      incidentId: id,
      reportId: null,
      actor,
      type: "reclassified",
      from: found.category,
      to: newCategory,
      at: now,
      note: reason.trim(),
    };
    if (!validateIncidentEvent(event)) {
      return { ok: false, error: "Event failed validation." };
    }
    persistIncidentState({
      incidents: incidents.map((i) => (i.id === id ? updated : i)),
      events: [...listIncidentEvents(), event],
      meta: readP3Meta(),
    });
    return { ok: true, incident: updated, event };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Storage failure.",
    };
  }
}

// Reassign department (coordinator + reason required). Mirrors reclassify:
// canonical field changes ONLY via a reassigned event; items untouched.
export function reassignIncident(
  id: string,
  newDepartment: Department,
  actor: Role,
  reason: string,
): IncidentResult {
  try {
    if (!isRole(actor)) return { ok: false, error: "Invalid role." };
    if (actor !== "coordinator") {
      return { ok: false, error: "Only coordinators can reassign." };
    }
    if (!isDepartment(newDepartment)) {
      return { ok: false, error: "Invalid department." };
    }
    const reassignReasonErr = invalidReasonText(reason, "reassign");
    if (reassignReasonErr !== null) {
      return { ok: false, error: reassignReasonErr };
    }
    const incidents = listIncidents();
    const found = incidents.find((i) => i.id === id) ?? null;
    if (found === null || !validateIncident(found)) {
      return { ok: false, error: `Unknown incident '${id}'.` };
    }
    if (found.mergedIntoId !== null) {
      return { ok: false, error: "Only canonical incidents can change." };
    }
    if (found.department === newDepartment) {
      return { ok: false, error: "Department is already set." };
    }
    const now = new Date().toISOString();
    const updated: MasterIncident = {
      ...found,
      department: newDepartment,
      updatedAt: now,
    };
    if (!validateIncident(updated)) {
      return { ok: false, error: "Incident failed validation." };
    }
    const event: IncidentEvent = {
      id: `${id}-reassigned-${Date.now()}-${listIncidentEvents().length}`,
      incidentId: id,
      reportId: null,
      actor,
      type: "reassigned",
      from: found.department,
      to: newDepartment,
      at: now,
      note: reason.trim(),
    };
    if (!validateIncidentEvent(event)) {
      return { ok: false, error: "Event failed validation." };
    }
    persistIncidentState({
      incidents: incidents.map((i) => (i.id === id ? updated : i)),
      events: [...listIncidentEvents(), event],
      meta: readP3Meta(),
    });
    return { ok: true, incident: updated, event };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Storage failure.",
    };
  }
}

// Incident status transitions (INCIDENT_TRANSITIONS; the Item matrix stays
// frozen). Role parity: coordinator every edge; assignee
// approved<->in_progress<->resolved + verify; student verify/reopen ONLY.
export function transitionIncident(
  id: string,
  to: Status,
  actor: Role,
  note?: string,
): IncidentResult {
  try {
    if (typeof id !== "string" || id.length === 0) {
      return { ok: false, error: "Unknown incident." };
    }
    if (!isRole(actor)) return { ok: false, error: "Invalid role." };
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
    const noteErr = invalidNoteText(note);
    if (noteErr !== null) {
      return { ok: false, error: noteErr };
    }
    const incidents = listIncidents();
    const found = incidents.find((i) => i.id === id) ?? null;
    if (found === null || !validateIncident(found)) {
      return { ok: false, error: `Unknown incident '${id}'.` };
    }
    if (found.mergedIntoId !== null) {
      return { ok: false, error: "Merged incidents cannot transition." };
    }
    const from = found.status;
    if (!canTransitionIncident(from, to)) {
      return {
        ok: false,
        error: `Transition ${from} -> ${to} is not allowed.`,
      };
    }
    // THE student carve-out (one if-statement, documented): students may
    // ONLY reopen a resolved incident (report a bad fix) — verifyIncident is
    // the only other student path. Every other student edge fails here.
    if (actor === "student" && !(from === "resolved" && to === "in_progress")) {
      return {
        ok: false,
        error: "Students can only reopen a resolved incident.",
      };
    }
    if (actor === "assignee") {
      const allowed =
        (from === "approved" && to === "in_progress") ||
        (from === "in_progress" && to === "resolved") ||
        (from === "resolved" && to === "in_progress");
      if (!allowed) {
        return {
          ok: false,
          error: `Assignees cannot move ${from} -> ${to}.`,
        };
      }
    }
    const type: IncidentEvent["type"] =
      to === "approved"
        ? "approved"
        : to === "rejected"
          ? "rejected"
          : "status_changed";
    const now = new Date().toISOString();
    const event: IncidentEvent = {
      id: `${id}-${from}-to-${to}-${Date.now()}-${listIncidentEvents().length}`,
      incidentId: id,
      reportId: null,
      actor,
      type,
      from,
      to,
      at: now,
    };
    if (typeof note === "string" && note.length > 0) event.note = note;
    if (!validateIncidentEvent(event)) {
      return { ok: false, error: "Event failed validation." };
    }
    const updated: MasterIncident = {
      ...found,
      status: to,
      updatedAt: now,
    };
    if (!validateIncident(updated)) {
      return { ok: false, error: "Incident failed validation." };
    }
    // Persist ONLY on success (failed writes stay silent: no event appended).
    persistIncidentState({
      incidents: incidents.map((i) => (i.id === id ? updated : i)),
      events: [...listIncidentEvents(), event],
      meta: readP3Meta(),
    });
    return { ok: true, incident: updated, event };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Storage failure.",
    };
  }
}

export type VerifyIncidentResult =
  | { ok: true; incident: MasterIncident; event: IncidentEvent; reopened: boolean }
  | { ok: false; error: string };

// Verification: fixed -> verified event + confirmed_fixed (status stays
// resolved); broken -> verified event + resolved→in_progress reopen +
// still_broken (department kept). Any role may verify (the student carve-out
// explicitly includes it). One vote per browser namespace
// (relayboard:{seed}:verify:{incidentId}, latest wins for display); every
// vote appends an event. Only resolved incidents can be verified.
export function verifyIncident(
  id: string,
  fixed: boolean,
  actor: Role,
): VerifyIncidentResult {
  try {
    if (typeof id !== "string" || id.length === 0) {
      return { ok: false, error: "Unknown incident." };
    }
    if (typeof fixed !== "boolean") {
      return { ok: false, error: "Vote must be a boolean." };
    }
    if (!isRole(actor)) return { ok: false, error: "Invalid role." };
    const incidents = listIncidents();
    const found = incidents.find((i) => i.id === id) ?? null;
    if (found === null || !validateIncident(found)) {
      return { ok: false, error: `Unknown incident '${id}'.` };
    }
    if (found.mergedIntoId !== null) {
      return { ok: false, error: "Merged incidents cannot be verified." };
    }
    if (found.status !== "resolved") {
      return { ok: false, error: "Only resolved incidents can be verified." };
    }
    const now = new Date().toISOString();
    const updated: MasterIncident = {
      ...found,
      status: fixed ? "resolved" : "in_progress",
      updatedAt: now,
      verification: {
        state: fixed ? "confirmed_fixed" : "still_broken",
        by: actor,
        at: now,
      },
    };
    if (!validateIncident(updated)) {
      return { ok: false, error: "Incident failed validation." };
    }
    const event: IncidentEvent = {
      id: `${id}-verified-${Date.now()}-${listIncidentEvents().length}`,
      incidentId: id,
      reportId: null,
      actor,
      type: "verified",
      from: "resolved",
      to: fixed ? "resolved" : "in_progress",
      at: now,
    };
    if (!validateIncidentEvent(event)) {
      return { ok: false, error: "Event failed validation." };
    }
    // Latest vote wins for display (best-effort; memory still works when
    // storage throws).
    writeKey(
      verifyVoteKey(activeSeedId, id),
      JSON.stringify({ fixed, by: actor, at: now }),
    );
    persistIncidentState({
      incidents: incidents.map((i) => (i.id === id ? updated : i)),
      events: [...listIncidentEvents(), event],
      meta: readP3Meta(),
    });
    return { ok: true, incident: updated, event, reopened: !fixed };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Storage failure.",
    };
  }
}

// Latest browser vote for display (null when nobody voted here yet).
export function readVerifyVote(
  incidentId: string,
): { fixed: boolean; by: Role; at: string } | null {
  try {
    const raw = readKey(verifyVoteKey(activeSeedId, incidentId));
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as {
      fixed?: unknown;
      by?: unknown;
      at?: unknown;
    };
    if (
      typeof parsed.fixed !== "boolean" ||
      !isRole(parsed.by) ||
      typeof parsed.at !== "string" ||
      Number.isNaN(Date.parse(parsed.at))
    ) {
      return null;
    }
    return { fixed: parsed.fixed, by: parsed.by, at: parsed.at };
  } catch {
    return null;
  }
}

// Submit flow: createItem (UNCHANGED) -> match against pre-submit incidents
// -> auto-attach ONLY on the auto band (the store confirms; the message
// never claims an attachment that failed) -> else open a NEW incident.
// Uncertain placements (confidence < 0.6 or missing location) report
// "awaiting review". Every report ends in exactly one incident.
export function submitReportWithClustering(
  input: CreateItemInput,
): SubmitClusteringResult {
  // Snapshot BEFORE create so the new report can never self-match.
  const incidentsBefore = listIncidents();
  const itemsByIdBefore = new Map(listItems().map((i) => [i.id, i]));
  const created = createItem(input);
  if (!created.ok) return { ok: false, error: created.error };
  const report = created.item;
  const itemsById = new Map(listItems().map((i) => [i.id, i]));
  let candidates: MatchCandidate[] = [];
  try {
    candidates = matchReportToIncidents(
      report,
      incidentsBefore.filter(
        (inc) => !inc.attachedReportIds.includes(report.id),
      ),
      itemsByIdBefore.size > 0 ? itemsById : itemsById,
      3,
    );
  } catch {
    candidates = [];
  }
  const best = candidates.find((c) => c.band === "auto") ?? null;
  if (best !== null) {
    const attach = attachReportToIncident(
      report.id,
      best.incidentId,
      "coordinator",
      `auto-attached (similarity ${Math.round(best.score * 100)}%)`,
    );
    if (attach.ok) {
      return {
        ok: true,
        item: getItem(report.id) ?? report,
        incident: attach.incident,
        attached: true,
        band: "auto",
        score: best.score,
        message: `Attached to ${attach.incident.id} (similarity ${Math.round(best.score * 100)}%).`,
        candidates,
      };
    }
    // Attach unconfirmed: fall through to open a new incident (never claim
    // an attachment the store did not confirm).
  }
  const opened = createIncidentForReport(report.id, "coordinator");
  if (!opened.ok) {
    return {
      ok: true,
      item: report,
      incident: {
        id: "INC-?",
        title: report.title,
        category: report.category,
        severity: report.severity,
        locationLabel: report.location,
        department: departmentForCategory(report.category, report.severity),
        status: "open",
        attachedReportIds: [report.id],
        mergedIntoId: null,
        createdFrom: report.id,
        createdAt: report.createdAt,
        updatedAt: report.updatedAt,
        verification: { state: "unverified", by: null, at: null },
      },
      attached: false,
      band:
        candidates.length > 0 && candidates[0].band === "review"
          ? "review"
          : "separate",
      score: candidates.length > 0 ? candidates[0].score : null,
      message: `Report ${report.id} submitted as open (incident grouping unavailable).`,
      candidates,
    };
  }
  const uncertain =
    report.confidence < 0.6 || report.location.trim().length < 2;
  const topBand =
    candidates.length > 0 ? candidates[0].band : ("separate" as MatchBand);
  return {
    ok: true,
    item: getItem(report.id) ?? report,
    incident: opened.incident,
    attached: false,
    band: topBand,
    score: candidates.length > 0 ? candidates[0].score : null,
    message: uncertain
      ? `New incident ${opened.incident.id} opened — awaiting review (low confidence or missing location).`
      : `New incident ${opened.incident.id} opened.`,
    candidates,
  };
}
