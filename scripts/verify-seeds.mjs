// RelayBoard Campus Fix — P1 seed verification (plain node, no deps).
// Reads lib/seed.json, asserts shape/enums/determinism, recomputes the
// FNV-1a hash over the SAME canonicalization as lib/store.ts
// (canonicalSeedHash). Reviewers cross-check both outputs:
//   node scripts/verify-seeds.mjs   ->  seeds=10 hash=<hex>
// NOTE: canonicalize()+fnv1a32() below MUST stay logic-identical to the
// implementations in lib/store.ts (recursive key sort, no whitespace;
// FNV-1a 32-bit over UTF-8 bytes, 8-char lowercase hex).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const seedPath = join(here, "..", "lib", "seed.json");

function canonicalize(value) {
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalize).join(",") + "]";
  }
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return (
      "{" +
      keys
        .map((k) => JSON.stringify(k) + ":" + canonicalize(value[k]))
        .join(",") +
      "}"
    );
  }
  return JSON.stringify(value) ?? "null";
}

function fnv1a32(str) {
  let h = 0x811c9dc5;
  const bytes = new TextEncoder().encode(str);
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

const failures = [];
function check(cond, msg) {
  if (!cond) failures.push(msg);
}

let seed;
try {
  seed = JSON.parse(readFileSync(seedPath, "utf8"));
} catch (e) {
  console.error(`FAIL: cannot read/parse ${seedPath}: ${e.message}`);
  process.exit(1);
}

const CATEGORIES = new Set([
  "wifi",
  "classroom_equip",
  "electrical",
  "water",
  "facility",
  "other",
]);
const SEVERITIES = new Set(["P0", "P1", "P2", "P3"]);
const STATUSES = new Set([
  "open",
  "approved",
  "in_progress",
  "resolved",
  "rejected",
  "duplicate",
]);
const ROLES = new Set(["student", "coordinator", "assignee"]);
const BANDS = { P0: [85, 100], P1: [65, 84], P2: [35, 64], P3: [0, 34] };
const REQUIRED = [
  "id",
  "short",
  "title",
  "description",
  "location",
  "category",
  "severity",
  "priority_score",
  "status",
  "recommended_action",
  "confidence",
  "duplicateOfId",
  "contentHash",
  "createdBy",
  "createdAt",
  "updatedAt",
  "source",
];

check(seed.seedId === "campus-maint-v1", "seedId must be campus-maint-v1");
check(
  typeof seed.domainLabel === "string" && seed.domainLabel.length > 0,
  "domainLabel must be a non-empty string",
);
check(
  Array.isArray(seed.buildings) && seed.buildings.length === 12,
  `buildings must have exactly 12 entries (got ${seed.buildings?.length})`,
);
check(
  Array.isArray(seed.categories) && seed.categories.length === 6,
  `categories must have exactly 6 labels (got ${seed.categories?.length})`,
);
check(
  Array.isArray(seed.items) && seed.items.length === 10,
  `items must have EXACTLY 10 entries (got ${seed.items?.length})`,
);

const expectedIds = Array.from({ length: 10 }, (_, i) => `RPT-${1001 + i}`);
if (Array.isArray(seed.items)) {
  const ids = seed.items.map((it) => it?.id);
  check(
    JSON.stringify(ids) === JSON.stringify(expectedIds),
    `item IDs must be deterministic ${expectedIds.join(",")} (got ${ids.join(",")})`,
  );
  const byId = new Map(seed.items.map((it) => [it?.id, it]));
  for (const it of seed.items) {
    const tag = it?.id ?? "?";
    for (const f of REQUIRED) {
      check(it != null && f in it, `${tag}: missing field ${f}`);
    }
    if (it == null) continue;
    check(CATEGORIES.has(it.category), `${tag}: bad category ${it.category}`);
    check(SEVERITIES.has(it.severity), `${tag}: bad severity ${it.severity}`);
    check(STATUSES.has(it.status), `${tag}: bad status ${it.status}`);
    check(ROLES.has(it.createdBy), `${tag}: bad createdBy ${it.createdBy}`);
    check(
      Number.isFinite(it.priority_score) &&
        it.priority_score >= 0 &&
        it.priority_score <= 100,
      `${tag}: priority_score out of range`,
    );
    const band = BANDS[it.severity];
    check(
      band === undefined ||
        (it.priority_score >= band[0] && it.priority_score <= band[1]),
      `${tag}: priority_score ${it.priority_score} outside ${it.severity} band [${band}]`,
    );
    check(
      Number.isFinite(it.confidence) &&
        it.confidence >= 0 &&
        it.confidence <= 1,
      `${tag}: confidence out of range`,
    );
    check(it.status === "open", `${tag}: seed status must be open`);
    check(it.source === "fallback", `${tag}: seed source must be fallback`);
    check(
      typeof it.short === "string" && it.short.length > 0,
      `${tag}: short must be non-empty`,
    );
    check(
      typeof it.contentHash === "string" && it.contentHash.length > 0,
      `${tag}: contentHash must be non-empty`,
    );
    check(
      !Number.isNaN(Date.parse(it.createdAt)) &&
        !Number.isNaN(Date.parse(it.updatedAt)),
      `${tag}: createdAt/updatedAt must be ISO dates`,
    );
    const text = `${it.title} ${it.description} ${it.location}`.toLowerCase();
    check(
      !text.includes("@") && !/\d{3}[-. ]\d{3}[-. ]\d{4}/.test(text),
      `${tag}: possible PII (email/phone pattern)`,
    );
    if (it.recommended_action === "mark_duplicate") {
      check(
        typeof it.duplicateOfId === "string" &&
          byId.has(it.duplicateOfId) &&
          it.duplicateOfId !== it.id,
        `${tag}: mark_duplicate requires a valid duplicateOfId`,
      );
    } else {
      check(
        it.duplicateOfId === null,
        `${tag}: non-duplicate item must have duplicateOfId null`,
      );
    }
  }
  const dupes = seed.items.filter(
    (it) => it?.recommended_action === "mark_duplicate",
  );
  check(dupes.length === 2, `expected 2 mark_duplicate items (got ${dupes.length})`);
  const p0 = seed.items.filter((it) => it?.severity === "P0");
  check(p0.length >= 1, "expected at least 1 P0 safety seed");
}

if (failures.length > 0) {
  for (const f of failures) console.error(`FAIL: ${f}`);
  process.exit(1);
}

const hash = fnv1a32(canonicalize(seed.items));
console.log(`seeds=${seed.items.length} hash=${hash}`);
