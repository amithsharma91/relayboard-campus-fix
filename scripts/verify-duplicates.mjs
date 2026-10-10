// RelayBoard Campus Fix — P4 duplicates verification (plain node, no deps).
//
// Compiles lib/schema.ts + lib/duplicates.ts + lib/fallbacks.ts +
// lib/store.ts to a temp dir with the project's OWN tsc binary
// (node_modules/.bin/tsc, commonjs output), requires the result, and asserts
// suggestion scoring plus the mark→unmark lifecycle on isolated in-memory
// fixtures (seed.json is never edited). Prints PASS lines, exits nonzero.
//
// Usage: node scripts/verify-duplicates.mjs   (Node 22; no flags needed)
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const tscBin = join(root, "node_modules", ".bin", "tsc");
const outDir = mkdtempSync(join(tmpdir(), "relayboard-duplicates-"));

try {
  execFileSync(
    tscBin,
    [
      "--outDir",
      outDir,
      "--rootDir",
      join(root, "lib"),
      "--module",
      "commonjs",
      "--target",
      "es2022",
      "--moduleResolution",
      "node",
      "--strict",
      "--skipLibCheck",
      "--resolveJsonModule",
      "--esModuleInterop",
      join(root, "lib", "duplicates.ts"),
      join(root, "lib", "store.ts"),
      join(root, "lib", "fallbacks.ts"),
      join(root, "lib", "schema.ts"),
    ],
    { stdio: "pipe" },
  );
} catch (e) {
  const err = e.stderr ? String(e.stderr) : String(e);
  console.error(`FAIL: tsc compile of lib/duplicates.ts failed:\n${err}`);
  process.exit(1);
}
// tsc does not emit the imported seed.json; copy it next to store.js.
copyFileSync(join(root, "lib", "seed.json"), join(outDir, "seed.json"));

const require = createRequire(import.meta.url);
const dup = require(join(outDir, "duplicates.js"));
const store = require(join(outDir, "store.js"));
const schema = require(join(outDir, "schema.js"));

const { suggestDuplicates, normalizeLocation, STOPWORDS } = dup;
const { createItem, transitionItem, getItem, listItems, listEvents, reseedDemo } =
  store;
const { canTransition, validateItem } = schema;

let passes = 0;
let failures = 0;
function check(cond, label, detail) {
  if (cond) {
    passes++;
    console.log(`PASS: ${label}`);
  } else {
    failures++;
    console.error(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

// Valid-Item fixture builder (isolated; never touches seed.json).
let n = 0;
function fixture(over = {}) {
  n++;
  return {
    id: `TST-${n}`,
    short: "#TST",
    title: "Projector dead with no signal in lecture hall",
    description:
      "Ceiling projector shows no signal on hdmi input, sixty students waiting for lecture to start.",
    location: "BUS 110",
    category: "classroom_equip",
    severity: "P1",
    priority_score: 70,
    status: "open",
    recommended_action: "assign_classroom_support",
    confidence: 0.75,
    duplicateOfId: null,
    contentHash: `fixture-hash-${n}`,
    createdBy: "student",
    createdAt: `2026-10-10T10:${String(n).padStart(2, "0")}:00Z`,
    updatedAt: `2026-10-10T10:${String(n).padStart(2, "0")}:00Z`,
    source: "fallback",
    ...over,
  };
}

// --- Exact dup pair scores high ---
const exactA = fixture({ id: "TST-A" });
const exactB = fixture({ id: "TST-B" });
check(validateItem(exactA) && validateItem(exactB), "fixtures validate");
const exactSug = suggestDuplicates(exactA, [exactA, exactB]);
check(
  exactSug.length === 1 && exactSug[0].id === "TST-B" && exactSug[0].score >= 0.9,
  "exact dup pair scores high",
  JSON.stringify(exactSug),
);

// --- Near match >= 0.5 ---
const nearA = fixture({
  id: "TST-NA",
  title: "Projector dead hdmi no signal lecture waiting",
  description: "Ceiling projector dead no signal hdmi sixty students waiting lecture",
});
const nearB = fixture({
  id: "TST-NB",
  title: "Projector dead hdmi no signal class waiting",
  description: "Ceiling projector dead no signal hdmi sixty class waiting session",
});
const nearSug = suggestDuplicates(nearA, [nearA, nearB]);
check(
  nearSug.length === 1 && nearSug[0].score >= 0.5,
  "near match reaches threshold",
  JSON.stringify(nearSug),
);

// --- Unrelated: different location never suggests ---
const farLoc = fixture({ id: "TST-FAR", location: "LIB 2F" });
check(
  suggestDuplicates(exactA, [exactA, farLoc]).length === 0,
  "same words different building → no match (location gate)",
);
// --- Unrelated: disjoint vocabulary same building ---
const disjoint = fixture({
  id: "TST-DIS",
  title: "Elevator car halted between levels",
  description: "Lift cabin stopped mid shaft riders inside contact notified awaiting crew",
});
check(
  suggestDuplicates(exactA, [exactA, disjoint]).length === 0,
  "disjoint vocabulary same building → no match",
);

// --- Same-broad-word-only NEVER matches (stopwords carry no signal) ---
const fillerA = fixture({
  id: "TST-FA",
  title: "Broken issue report campus",
  description: "Please help my issue broken report problem things",
  location: "SCI B",
});
const fillerB = fixture({
  id: "TST-FB",
  title: "Broken issue report campus building",
  description: "Help please broken things problem room campus",
  location: "SCI B",
});
for (const w of [
  "the",
  "broken",
  "issue",
  "issues",
  "report",
  "campus",
  "room",
  "building",
  "please",
  "help",
]) {
  if (!STOPWORDS.has(w)) {
    check(false, `stopword list contains ${w}`);
  }
}
check(
  suggestDuplicates(fillerA, [fillerA, fillerB]).length === 0,
  "broad-words-only pair → NO match (stopwords removed)",
);

// --- Self excluded ---
check(
  suggestDuplicates(exactA, [exactA]).length === 0,
  "self excluded from suggestions",
);

// --- Terminal statuses excluded ---
for (const st of ["resolved", "rejected", "duplicate"]) {
  const term = fixture({ id: `TST-${st}`, status: st });
  check(
    suggestDuplicates(exactA, [exactA, term]).length === 0,
    `terminal status ${st} excluded`,
  );
}
for (const st of ["open", "approved", "in_progress"]) {
  const live = fixture({ id: `TST-${st}`, status: st });
  check(
    suggestDuplicates(exactA, [exactA, live]).length === 1,
    `non-terminal status ${st} eligible`,
  );
}

// --- Score shape: rounded 2dp, labeled similarity ---
const shape = suggestDuplicates(exactA, [exactA, exactB])[0];
check(
  shape !== undefined &&
    Object.keys(shape).sort().join(",") === "id,score" &&
    Number.isInteger(Math.round(shape.score * 100)),
  "suggestion shape {id, score} 2dp (similarity)",
);

// --- Location normalization: case/punct variants gate together ---
check(
  normalizeLocation("  CHEM-102!! ") === normalizeLocation("chem 102"),
  "location normalization collapses case/punct",
);
const locA = fixture({ id: "TST-LA", location: "chem 102" });
const locB = fixture({ id: "TST-LB", location: "CHEM-102" });
check(
  suggestDuplicates(locA, [locA, locB]).length === 1,
  "location variants still gate together",
);

// --- Invalid source returns [] (pure, never throws) ---
check(suggestDuplicates({ bogus: 1 }, [exactA]).length === 0, "invalid source → []");
check(suggestDuplicates(exactA, [{ bogus: 2 }]).length === 0, "invalid candidates skipped");

// --- Stable ranking on ties: score desc → createdAt asc → id asc ---
const tieBase = fixture({ id: "TST-TIE" });
const tieOld = fixture({ id: "TST-T2", createdAt: "2026-10-10T09:00:00Z" });
const tieNew = fixture({ id: "TST-T1", createdAt: "2026-10-10T11:00:00Z" });
// Same content ⇒ same score; force title order by id for the third key.
const tieRes = suggestDuplicates(tieBase, [tieBase, tieNew, tieOld]);
check(
  tieRes.length === 2 && tieRes[0].id === "TST-T2" && tieRes[1].id === "TST-T1",
  "tie-break createdAt asc is stable",
  JSON.stringify(tieRes.map((s) => s.id)),
);
const tieIds = suggestDuplicates(
  tieBase,
  [
    tieBase,
    fixture({ id: "TST-ZZ", createdAt: "2026-10-10T09:00:00Z" }),
    fixture({ id: "TST-AA", createdAt: "2026-10-10T09:00:00Z" }),
  ],
);
check(
  tieIds.length === 2 && tieIds[0].id === "TST-AA" && tieIds[1].id === "TST-ZZ",
  "tie-break id asc is stable",
);

// --- Bounded scan: 250 candidates do not throw, limit honored ---
const crowd = [fixture({ id: "TST-C0" })];
for (let i = 1; i <= 250; i++) {
  crowd.push(fixture({ id: `TST-C${i}` }));
}
let crowdRes = null;
try {
  crowdRes = suggestDuplicates(crowd[0], crowd, 3);
} catch {
  crowdRes = null;
}
check(
  crowdRes !== null && crowdRes.length === 3,
  "bounded scan handles 250 items, limit honored",
);

// --- Limit parameter ---
check(
  suggestDuplicates(exactA, [exactA, exactB, nearB], 1).length <= 1,
  "limit caps suggestions",
);

// --- Store lifecycle on isolated live items ---
reseedDemo();
function liveInput(title, description, location) {
  return { title, description, location };
}
const m1 = createItem(
  liveInput(
    "Wifi outage across east wing study rooms tonight",
    "No wireless signal across the east wing study rooms since evening, dozens cannot connect.",
    "N-Dorm 3F",
  ),
);
const m2 = createItem(
  liveInput(
    "Wifi still out across east wing study rooms",
    "Wireless still down across the east wing study rooms, nobody online since evening.",
    "N-Dorm 3F",
  ),
);
check(m1.ok && m2.ok, "lifecycle fixtures created open");
const m1id = m1.item.id;
const m2id = m2.item.id;

// Unknown / empty / self targets rejected, no state change.
const evBeforeBad = listEvents().length;
check(!transitionItem(m1id, "duplicate", "coordinator", "x", "NOPE").ok, "unknown dup target rejected");
check(!transitionItem(m1id, "duplicate", "coordinator", "x", "  ").ok, "empty dup target rejected");
check(!transitionItem(m1id, "duplicate", "coordinator", "x", m1id).ok, "self dup target rejected");
check(
  getItem(m1id).status === "open" && listEvents().length === evBeforeBad,
  "rejected marks change nothing, append nothing",
);

// Mark happy path.
const evBeforeMark = listEvents().length;
const mark = transitionItem(m1id, "duplicate", "coordinator", "same outage", m2id);
check(mark.ok === true, "mark duplicate ok");
check(
  mark.ok && mark.item.status === "duplicate" && mark.item.duplicateOfId === m2id,
  "mark sets status + duplicateOfId",
);
check(
  mark.ok && mark.event.type === "marked_duplicate",
  "mark emits marked_duplicate event",
);
check(listEvents().length === evBeforeMark + 1, "mark appends exactly 1 event");

// Repeated mark fails via canTransition, no dup event.
const evBeforeReMark = listEvents().length;
check(!transitionItem(m1id, "duplicate", "coordinator", "again", m2id).ok, "repeated mark fails");
check(listEvents().length === evBeforeReMark, "failed re-mark appends no event");

// Cycle A→B→A rejected: m2 → m1 would close the loop (m1 already → m2).
check(
  !transitionItem(m2id, "duplicate", "coordinator", "cycle", m1id).ok,
  "cycle A→B→A rejected",
);
check(
  getItem(m2id).status === "open",
  "rejected cycle leaves target open",
);

// Non-coordinator unmark fails.
check(!transitionItem(m1id, "open", "student").ok, "student unmark fails");
check(!transitionItem(m1id, "open", "assignee").ok, "assignee unmark fails");
check(getItem(m1id).status === "duplicate", "failed unmarks keep duplicate");

// Unmark happy path (coordinator).
const evBeforeUnmark = listEvents().length;
const unmark = transitionItem(m1id, "open", "coordinator", "not the same outage");
check(unmark.ok === true, "coordinator unmark ok");
check(
  unmark.ok && unmark.item.status === "open" && unmark.item.duplicateOfId === null,
  "unmark clears status + duplicateOfId",
);
check(
  unmark.ok &&
    unmark.event.type === "status_changed" &&
    unmark.event.from === "duplicate" &&
    unmark.event.to === "open",
  "unmark emits status_changed duplicate→open",
);
check(listEvents().length === evBeforeUnmark + 1, "unmark appends exactly 1 event");

// Repeated unmark (already open → open) fails via canTransition, no event.
const evBeforeReUnmark = listEvents().length;
check(!transitionItem(m1id, "open", "coordinator").ok, "repeated unmark fails");
check(listEvents().length === evBeforeReUnmark, "failed re-unmark appends no event");

// Full history preserved: mark + unmark events both present (append-only).
const hist = listEvents().filter((e) => e.itemId === m1id);
check(
  hist.some((e) => e.type === "marked_duplicate") &&
    hist.some((e) => e.type === "status_changed" && e.from === "duplicate"),
  "timeline keeps full mark→unmark history",
);
check(canTransition("duplicate", "open") === true, "canTransition duplicate→open true");

// --- Seeded links preserved exactly ---
reseedDemo();
const s2 = getItem("RPT-1002");
const s4 = getItem("RPT-1004");
check(s2 !== null && s2.duplicateOfId === "RPT-1001", "seed RPT-1002→1001 preserved");
check(s4 !== null && s4.duplicateOfId === "RPT-1003", "seed RPT-1004→1003 preserved");
check(
  s2 !== null && getItem(s2.duplicateOfId) !== null,
  "seeded dup link resolves",
);

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures > 0 ? 1 : 0);
