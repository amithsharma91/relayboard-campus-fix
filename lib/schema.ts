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
  // Challenge-1 (incident clustering): backfilled membership pointer set when
  // the report is attached to a MasterIncident (submit flow auto-attach,
  // candidate Attach, merge moves). OPTIONAL so pre-challenge stored records
  // without it still validate; absence means "not yet grouped" (lazy
  // deriveIncidents groups by duplicateOfId roots instead).
  incidentId?: string | null;
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

export function isEventType(u: unknown): u is Event["type"] {
  return (
    u === "created" ||
    u === "classified" ||
    u === "approved" ||
    u === "status_changed" ||
    u === "marked_duplicate" ||
    u === "rejected"
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
  if (o.duplicateOfId !== null && !isNonEmptyString(o.duplicateOfId))
    return false;
  // incidentId is OPTIONAL (Challenge-1): missing/undefined/null all accept
  // (old records); a present non-null value must be a non-empty string.
  if (
    o.incidentId !== undefined &&
    o.incidentId !== null &&
    !isNonEmptyString(o.incidentId)
  )
    return false;
  if (!isNonEmptyString(o.contentHash)) return false;
  if (!isRole(o.createdBy)) return false;
  if (!isIsoDateString(o.createdAt)) return false;
  if (!isIsoDateString(o.updatedAt)) return false;
  if (o.source !== "llm" && o.source !== "fallback") return false;
  return true;
}

export function validateEvent(u: unknown): u is Event {
  if (u === null || typeof u !== "object") return false;
  const o = u as Record<string, unknown>;
  if (!isNonEmptyString(o.id)) return false;
  if (!isNonEmptyString(o.itemId)) return false;
  if (!isRole(o.actor)) return false;
  if (!isEventType(o.type)) return false;
  if (o.from !== null && typeof o.from !== "string") return false;
  if (!isNonEmptyString(o.to)) return false;
  if (!isIsoDateString(o.at)) return false;
  if (o.note !== undefined && typeof o.note !== "string") return false;
  return true;
}

// Allowlisted transitions per blueprint §4. Terminal states (resolved,
// rejected, duplicate) have no outgoing edges here; duplicate-linking rules
// (duplicateOfId required) are enforced by callers in P2/P3.
// Transition invariant for P2/P3 status writers (no status writer exists
// yet): every mutation of Item.status MUST pass through
// canTransition(from, to); any transition TO "duplicate" MUST also set a
// non-empty duplicateOfId pointing at an existing item (validateItem rejects
// ""); every transition MUST append an audit Event that passes
// validateEvent (actor/type/from/to/at).
const ALLOWED_TRANSITIONS: Record<Status, readonly Status[]> = {
  open: ["approved", "rejected", "duplicate"],
  approved: ["in_progress", "rejected"],
  in_progress: ["resolved", "rejected"],
  resolved: [],
  rejected: [],
  // P4-C reversal edge (the ONE authorized schema change): duplicate→open
  // lets a coordinator undo a wrong mark via transitionItem, which clears
  // duplicateOfId and appends a "status_changed" event. History is preserved
  // (append-only; no event is deleted) and every other edge stays frozen.
  duplicate: ["open"],
};

export function canTransition(from: Status, to: Status): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

// ---------------------------------------------------------------------------
// Challenge-1: Intelligent Incident Clustering + Audit Integrity (additive).
//
// Stored incident model (not a derived view): merges, reclassify, reassign
// and verification persist to relayboard:{seed}:incidents / :incident_events.
// Item.duplicateOfId semantics + the 50-hop cycle walk in lib/store.ts are
// untouched; Item originals are NEVER mutated by incident operations (only
// the additive incidentId backfill on attach/move).
// ---------------------------------------------------------------------------

export type Department =
  | "network_ops"
  | "classroom_support"
  | "facilities"
  | "safety"
  | "triage";

export const DEPARTMENTS: readonly Department[] = [
  "network_ops",
  "classroom_support",
  "facilities",
  "safety",
  "triage",
] as const;

export function isDepartment(u: unknown): u is Department {
  return (
    u === "network_ops" ||
    u === "classroom_support" ||
    u === "facilities" ||
    u === "safety" ||
    u === "triage"
  );
}

// Default department derived from category (+ severity for the electrical
// safety split). Coordinators may override via reassign (reassigned event);
// verification never changes it.
export function departmentForCategory(
  category: Category,
  severity: Severity,
): Department {
  if (category === "wifi") return "network_ops";
  if (category === "classroom_equip") return "classroom_support";
  if (category === "electrical") return severity === "P0" ? "safety" : "facilities";
  if (category === "water") return "facilities";
  if (category === "facility") return "facilities";
  return "triage";
}

export type VerificationState =
  | "unverified"
  | "confirmed_fixed"
  | "still_broken";

export interface IncidentVerification {
  state: VerificationState;
  by: Role | null;
  at: string | null;
}

export interface MasterIncident {
  // Canonical id "INC-<n>" (migration: survivor report suffix; new:
  // INC-(1100+incidentSeq)).
  id: string;
  title: string;
  category: Category;
  severity: Severity;
  locationLabel: string;
  department: Department;
  // REUSES the Status union — no new member. "Assigned" is a DISPLAY label
  // for approved (UI only).
  status: Status;
  // Non-empty: every incident groups >=1 report.
  attachedReportIds: string[];
  // Merge alias: null = canonical; non-null = merged into target id.
  // resolveIncident() follows this chain (50-hop cap).
  mergedIntoId: string | null;
  // First report id ("migration" roots use the survivor report id; new
  // incidents use the creating report id).
  createdFrom: string;
  createdAt: string;
  updatedAt: string;
  verification: IncidentVerification;
}

// Old-6 report event types are reused by IncidentEvent, plus 6 new ones.
export type IncidentEventType =
  | "created"
  | "classified"
  | "approved"
  | "status_changed"
  | "marked_duplicate"
  | "rejected"
  | "incident_created"
  | "report_attached"
  | "incident_merged"
  | "reclassified"
  | "reassigned"
  | "verified";

export const INCIDENT_EVENT_TYPES: readonly IncidentEventType[] = [
  "created",
  "classified",
  "approved",
  "status_changed",
  "marked_duplicate",
  "rejected",
  "incident_created",
  "report_attached",
  "incident_merged",
  "reclassified",
  "reassigned",
  "verified",
] as const;

export interface IncidentEvent {
  id: string;
  incidentId: string;
  reportId: string | null;
  actor: Role;
  type: IncidentEventType;
  from: string | null;
  to: string;
  at: string;
  note?: string;
}

export function isIncidentEventType(u: unknown): u is IncidentEventType {
  return (
    u === "created" ||
    u === "classified" ||
    u === "approved" ||
    u === "status_changed" ||
    u === "marked_duplicate" ||
    u === "rejected" ||
    u === "incident_created" ||
    u === "report_attached" ||
    u === "incident_merged" ||
    u === "reclassified" ||
    u === "reassigned" ||
    u === "verified"
  );
}

function isVerificationState(u: unknown): u is VerificationState {
  return (
    u === "unverified" || u === "confirmed_fixed" || u === "still_broken"
  );
}

export function validateIncident(u: unknown): u is MasterIncident {
  if (u === null || typeof u !== "object") return false;
  const o = u as Record<string, unknown>;
  if (typeof o.id !== "string" || !/^INC-\d+$/.test(o.id)) return false;
  if (!isNonEmptyString(o.title)) return false;
  if (!isCategory(o.category)) return false;
  if (!isSeverity(o.severity)) return false;
  if (typeof o.locationLabel !== "string") return false;
  if (!isDepartment(o.department)) return false;
  if (!isStatus(o.status)) return false;
  if (
    !Array.isArray(o.attachedReportIds) ||
    o.attachedReportIds.length === 0 ||
    !o.attachedReportIds.every(isNonEmptyString)
  )
    return false;
  if (o.mergedIntoId !== null && !isNonEmptyString(o.mergedIntoId))
    return false;
  if (!isNonEmptyString(o.createdFrom)) return false;
  if (!isIsoDateString(o.createdAt)) return false;
  if (!isIsoDateString(o.updatedAt)) return false;
  const v = o.verification;
  if (v === null || typeof v !== "object") return false;
  const vo = v as Record<string, unknown>;
  if (!isVerificationState(vo.state)) return false;
  if (vo.by !== null && !isRole(vo.by)) return false;
  if (vo.at !== null && !isIsoDateString(vo.at)) return false;
  return true;
}

export function validateIncidentEvent(u: unknown): u is IncidentEvent {
  if (u === null || typeof u !== "object") return false;
  const o = u as Record<string, unknown>;
  if (!isNonEmptyString(o.id)) return false;
  if (!isNonEmptyString(o.incidentId)) return false;
  if (o.reportId !== null && !isNonEmptyString(o.reportId)) return false;
  if (!isRole(o.actor)) return false;
  if (!isIncidentEventType(o.type)) return false;
  if (o.from !== null && typeof o.from !== "string") return false;
  if (typeof o.to !== "string" || o.to.length === 0) return false;
  if (!isIsoDateString(o.at)) return false;
  if (o.note !== undefined && typeof o.note !== "string") return false;
  return true;
}

// Incident-level transitions. The Item matrix (ALLOWED_TRANSITIONS) is
// FROZEN — reports stay terminal at resolved. Incidents add exactly one
// edge: resolved→in_progress (reopen, incident-level ONLY).
export const INCIDENT_TRANSITIONS: Record<Status, readonly Status[]> = {
  open: ["approved", "rejected"],
  approved: ["in_progress", "rejected"],
  in_progress: ["resolved", "rejected"],
  resolved: ["in_progress"],
  rejected: [],
  duplicate: [],
};

export function canTransitionIncident(from: Status, to: Status): boolean {
  return INCIDENT_TRANSITIONS[from]?.includes(to) ?? false;
}

// Display label: approved renders as "Assigned" on incident surfaces.
// Single helper so board + detail can never drift.
export function incidentStatusLabel(status: Status): string {
  if (status === "approved") return "Assigned";
  if (status === "in_progress") return "In Progress";
  return status.charAt(0).toUpperCase() + status.slice(1);
}
