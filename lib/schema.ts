// RelayBoard Campus Fix — P1 data schema (hand-rolled guards).
//
// Explicit decision: NO zod dependency. Zod arrives with P2 server-side
// validation (app/api/classify). Until then, the runtime type-guards below
// (isCategory/isSeverity/isStatus/isRole + validateItem) are the single
// source of truth on both client and server. Keep them in sync with
// PROJECT_BLUEPRINT.md §2/§4 — schema/statuses/roles are frozen.

export type Role = "student" | "coordinator" | "assignee";
export type Category =
  | "wifi"
  | "classroom_equip"
  | "electrical"
  | "water"
  | "facility"
  | "other";
export type Severity = "P0" | "P1" | "P2" | "P3";
export type Status =
  | "open"
  | "approved"
  | "in_progress"
  | "resolved"
  | "rejected"
  | "duplicate";

export const ROLES: readonly Role[] = [
  "student",
  "coordinator",
  "assignee",
] as const;
export const CATEGORIES: readonly Category[] = [
  "wifi",
  "classroom_equip",
  "electrical",
  "water",
  "facility",
  "other",
] as const;
export const SEVERITIES: readonly Severity[] = [
  "P0",
  "P1",
  "P2",
  "P3",
] as const;
export const STATUSES: readonly Status[] = [
  "open",
  "approved",
  "in_progress",
  "resolved",
  "rejected",
  "duplicate",
] as const;

// Priority-score bands per blueprint §2 (score drives sort, severity drives chip).
export const SEVERITY_BANDS: Record<Severity, readonly [number, number]> = {
  P0: [85, 100],
  P1: [65, 84],
  P2: [35, 64],
  P3: [0, 34],
};

export interface Item {
  id: string;
  short: string;
  title: string;
  description: string;
  location: string;
  category: Category;
  severity: Severity;
  priority_score: number;
  status: Status;
  recommended_action: string;
  confidence: number;
  duplicateOfId: string | null;
  // Seed placeholder: short stable strings (e.g. "seed-hash-01"). Real
  // content hashing of user-submitted content arrives in P2 with the
  // server-side classify route; seeds carry no user content to hash.
  contentHash: string;
  createdBy: Role;
  createdAt: string;
  updatedAt: string;
  source: "llm" | "fallback";
}

export interface Event {
  id: string;
  itemId: string;
  actor: Role;
  type:
    | "created"
    | "classified"
    | "approved"
    | "status_changed"
    | "marked_duplicate"
    | "rejected";
  from: string | null;
  to: string;
  at: string;
  note?: string;
}

export function isRole(u: unknown): u is Role {
  return (
    u === "student" || u === "coordinator" || u === "assignee"
  );
}

export function isCategory(u: unknown): u is Category {
  return (
    u === "wifi" ||
    u === "classroom_equip" ||
    u === "electrical" ||
    u === "water" ||
    u === "facility" ||
    u === "other"
  );
}

export function isSeverity(u: unknown): u is Severity {
  return u === "P0" || u === "P1" || u === "P2" || u === "P3";
}

export function isStatus(u: unknown): u is Status {
  return (
    u === "open" ||
    u === "approved" ||
    u === "in_progress" ||
    u === "resolved" ||
    u === "rejected" ||
    u === "duplicate"
  );
}

function isNonEmptyString(u: unknown): u is string {
  return typeof u === "string" && u.length > 0;
}

function isIsoDateString(u: unknown): u is string {
  return (
    typeof u === "string" && u.length > 0 && !Number.isNaN(Date.parse(u))
  );
}

export function validateItem(u: unknown): u is Item {
  if (u === null || typeof u !== "object") return false;
  const o = u as Record<string, unknown>;
  if (!isNonEmptyString(o.id)) return false;
  if (!isNonEmptyString(o.short)) return false;
  if (!isNonEmptyString(o.title)) return false;
  if (typeof o.description !== "string" || o.description.length === 0)
    return false;
  if (!isNonEmptyString(o.location)) return false;
  if (!isCategory(o.category)) return false;
  if (!isSeverity(o.severity)) return false;
  if (
    typeof o.priority_score !== "number" ||
    !Number.isFinite(o.priority_score) ||
    o.priority_score < 0 ||
    o.priority_score > 100
  )
    return false;
  if (!isStatus(o.status)) return false;
  if (!isNonEmptyString(o.recommended_action)) return false;
  if (
    typeof o.confidence !== "number" ||
    !Number.isFinite(o.confidence) ||
    o.confidence < 0 ||
    o.confidence > 1
  )
    return false;
  if (o.duplicateOfId !== null && typeof o.duplicateOfId !== "string")
    return false;
  if (!isNonEmptyString(o.contentHash)) return false;
  if (!isRole(o.createdBy)) return false;
  if (!isIsoDateString(o.createdAt)) return false;
  if (!isIsoDateString(o.updatedAt)) return false;
  if (o.source !== "llm" && o.source !== "fallback") return false;
  return true;
}

// Allowlisted transitions per blueprint §4. Terminal states (resolved,
// rejected, duplicate) have no outgoing edges here; duplicate-linking rules
// (duplicateOfId required) are enforced by callers in P2/P3.
const ALLOWED_TRANSITIONS: Record<Status, readonly Status[]> = {
  open: ["approved", "rejected", "duplicate"],
  approved: ["in_progress", "rejected"],
  in_progress: ["resolved", "rejected"],
  resolved: [],
  rejected: [],
  duplicate: [],
};

export function canTransition(from: Status, to: Status): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}
