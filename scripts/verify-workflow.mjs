// RelayBoard Campus Fix — P3 workflow verification (plain node, no deps).
//
// Compiles lib/schema.ts + lib/fallbacks.ts + lib/store.ts to a temp dir with
// the project's OWN tsc binary (node_modules/.bin/tsc, commonjs output),
// requires the result, and asserts create/transition role gates. Prints PASS
// lines, exits nonzero on any failure.
//
// Usage: node scripts/verify-workflow.mjs   (Node 22; no flags needed)
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const tscBin = join(root, "node_modules", ".bin", "tsc");
const outDir = mkdtempSync(join(tmpdir(), "relayboard-workflow-"));

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
      join(root, "lib", "store.ts"),
      join(root, "lib", "fallbacks.ts"),
      join(root, "lib", "schema.ts"),
    ],
    { stdio: "pipe" },
  );
} catch (e) {
  const err = e.stderr ? String(e.stderr) : String(e);
  console.error(`FAIL: tsc compile of lib/store.ts failed:\n${err}`);
  process.exit(1);
}
// tsc does not emit the imported seed.json; copy it next to store.js.
copyFileSync(join(root, "lib", "seed.json"), join(outDir, "seed.json"));

const require = createRequire(import.meta.url);
const store = require(join(outDir, "store.js"));
const schema = require(join(outDir, "schema.js"));

const {
  createItem,
  transitionItem,
  getItem,
  listItems,
  listEvents,
  reseedDemo,
  ensureSeeded,
  parseItems,
  parseEvents,
  setActiveSeedId,
  getActiveSeedId,
  queueKeys,
} = store;
const { validateEvent, validateItem, canTransition } = schema;

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

function validInput(over = {}) {
  return {
    title: "Projector dead in test hall, class waiting",
    description:
      "The ceiling projector in the test hall is dead and shows no signal for the waiting class.",
    location: "BUS 110",
    ...over,
  };
}

// --- Fresh seed state ---
reseedDemo();
check(listItems().length === 10, "reseed gives 10 items");
check(
  listEvents().length === 20 &&
    listEvents().every(validateEvent) &&
    listEvents().filter((e) => e.type === "created").length === 10 &&
    listEvents().filter((e) => e.type === "classified").length === 10,
  "reseed seeds 20 canonical events (created+classified per item)",
);

// --- Per-record filtering: one malformed record must not wipe the list ---
check(
  (() => {
    const good = listItems()[0];
    const parsed = parseItems(JSON.stringify([good, { bogus: 1 }, null]));
    return (
      parsed !== null && parsed.length === 1 && parsed[0].id === good.id
    );
  })(),
  "parseItems filters single malformed record, keeps valid",
);
check(
  parseItems(JSON.stringify([{ bogus: 1 }])) === null,
  "parseItems all-invalid still returns null (corrupt fallback)",
);
check(
  (() => {
    const good = listEvents()[0];
    const parsed = parseEvents(
      JSON.stringify([good, { bogus: 2 }, "nope"]),
    );
    return (
      parsed !== null && parsed.length === 1 && parsed[0].id === good.id
    );
  })(),
  "parseEvents filters single malformed record, keeps valid",
);
check(
  parseEvents("not json{{{") === null,
  "parseEvents unparseable still returns null",
);

// --- createItem valid ---
const c1 = createItem(validInput());
check(c1.ok === true, "createItem valid ok");
check(
  c1.ok && c1.item.id === "RPT-1011",
  "createItem first id RPT-1011",
  c1.ok ? c1.item.id : c1.error,
);
check(c1.ok && c1.item.status === "open", "createItem status open");
check(
  c1.ok && c1.item.duplicateOfId === null,
  "createItem duplicateOfId null (detection deferred)",
);
check(
  c1.ok && /^[0-9a-f]{8}$/.test(c1.item.contentHash),
  "createItem contentHash 8-hex",
);
check(
  c1.ok && validateItem(c1.item),
  "createItem item passes validateItem",
);
check(
  c1.ok &&
    Array.isArray(c1.events) &&
    c1.events.length === 2 &&
    c1.events[0].type === "created" &&
    c1.events[1].type === "classified",
  "createItem appends created+classified events",
);
check(
  c1.ok && c1.events.every(validateEvent),
  "createItem events pass validateEvent",
);
check(
  c1.ok && !Number.isNaN(Date.parse(c1.item.createdAt)),
  "createItem createdAt real ISO",
);
check(listItems().length === 11, "createItem grows list to 11");
check(
  c1.ok && getItem(c1.item.id) !== null,
  "createItem getItem resolves new id",
);

// --- createItem invalid (each must fail, no insert) ---
const beforeInvalid = listItems().length;
const badTitle = createItem(validInput({ title: "abc" }));
check(!badTitle.ok, "createItem short title fails");
const badDesc = createItem(validInput({ description: "too short" }));
check(!badDesc.ok, "createItem short description fails");
const badLoc = createItem(validInput({ location: " " }));
check(!badLoc.ok, "createItem blank location fails");
const badCat = createItem(validInput({ category: "nope" }));
check(!badCat.ok, "createItem invalid category fails");
const bigDesc = createItem(validInput({ description: "x".repeat(2001) }));
check(!bigDesc.ok, "createItem 2001ch description fails (cap 2000)");
check(
  listItems().length === beforeInvalid,
  "invalid creates add no items",
);

// --- Plain-text invariant: <script> stored verbatim ---
const xss = createItem(
  validInput({
    title: "<script>alert(1)</script> projector down",
    description:
      '<img src=x onerror=alert(2)> projector dead, no signal in hall, help now please',
  }),
);
check(xss.ok === true, "createItem xss input accepted");
check(
  xss.ok && xss.item.title.includes("<script>alert(1)</script>"),
  "xss title stored verbatim (no strip)",
);
check(
  xss.ok && xss.item.description.includes("onerror=alert(2)"),
  "xss description stored verbatim (no strip)",
);
// No execution sink anywhere in app/: scan for the raw-HTML JSX prop used as
// an attribute (bare mentions in comments do not count — require `=`).
const appFiles = [];
(function walk(dir) {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, name.name);
    if (name.isDirectory()) walk(p);
    else if (/\.(tsx|ts)$/.test(name.name)) appFiles.push(p);
  }
})(join(root, "app"));
let sinkFound = null;
for (const f of appFiles) {
  const src = readFileSync(f, "utf8");
  if (/dangerouslySetInnerHTML\s*=/.test(src)) {
    sinkFound = f;
    break;
  }
}
check(sinkFound === null, "no raw-HTML sink in app/");

// --- Approve happy path (coordinator) ---
const evBeforeApprove = listEvents().length;
const appr = transitionItem(c1.item.id, "approved", "coordinator", "looks good");
check(appr.ok === true, "coordinator approve open->approved ok");
check(
  appr.ok && appr.item.status === "approved",
  "approve lands approved",
);
check(
  appr.ok && appr.event.actor === "coordinator",
  "approve event actor coordinator",
);
check(
  appr.ok && appr.event.from === "open" && appr.event.to === "approved",
  "approve event from/to",
);
check(
  appr.ok && appr.event.note === "looks good",
  "approve event keeps note",
);
check(
  listEvents().length === evBeforeApprove + 1,
  "approve appends exactly 1 event",
);

// --- Double-approve second FAILS, no dup event ---
const evBeforeDouble = listEvents().length;
const double = transitionItem(c1.item.id, "approved", "coordinator");
check(!double.ok, "double-approve second fails");
check(
  listEvents().length === evBeforeDouble,
  "failed double-approve appends no event",
);

// --- Role gates ---
const c2 = createItem(
  validInput({
    title: "Wifi down across study floor, many affected",
    description:
      "No wifi signal across the study floor since morning, nobody can connect at all.",
    location: "N-Dorm 3F",
  }),
);
check(c2.ok === true, "second create ok for gate tests");
const studentApprove = transitionItem(c2.item.id, "approved", "student");
check(!studentApprove.ok, "student approve FAILS");
const assigneeReject = transitionItem(c2.item.id, "rejected", "assignee");
check(!assigneeReject.ok, "assignee reject FAILS");
// Coordinator reject happy path on a fresh item.
const c3 = createItem(
  validInput({
    title: "Leak near desk in reading room needs cleanup",
    description:
      "Steady water leak near the reading desks is pooling on the floor, needs cleanup soon.",
    location: "LIB 2F",
  }),
);
const rej = transitionItem(c3.item.id, "rejected", "coordinator", "not a facility issue");
check(rej.ok === true, "coordinator reject open->rejected ok");
check(rej.ok && rej.item.status === "rejected", "reject lands rejected");

// --- Invalid transition open->resolved FAILS, no state change/audit ---
const c4 = createItem(
  validInput({
    title: "Door lock jammed at hall entrance this morning",
    description:
      "The main entrance door lock is jammed and the door will not latch properly at all.",
    location: "SCI B",
  }),
);
const evBeforeInvalid = listEvents().length;
const badTrans = transitionItem(c4.item.id, "resolved", "coordinator");
check(!badTrans.ok, "invalid open->resolved FAILS");
check(
  getItem(c4.item.id).status === "open",
  "failed transition leaves status open",
);
check(
  listEvents().length === evBeforeInvalid,
  "failed transition appends no audit entry",
);
check(
  canTransition("open", "resolved") === false,
  "canTransition open->resolved false",
);

// --- Stepper happy path (assignee approved->in_progress->resolved) ---
const s1 = transitionItem(c2.item.id, "approved", "coordinator");
check(s1.ok === true, "stepper setup approve ok");
const s2 = transitionItem(c2.item.id, "in_progress", "assignee");
check(s2.ok === true, "assignee approved->in_progress ok");
check(s2.ok && s2.item.status === "in_progress", "stepper in_progress");
const s3 = transitionItem(c2.item.id, "resolved", "assignee");
check(s3.ok === true, "assignee in_progress->resolved ok");
check(s3.ok && s3.item.status === "resolved", "stepper resolved");

// --- Unknown id ---
check(getItem("NOPE") === null, "unknown id getItem null");
const unknownTrans = transitionItem("NOPE", "approved", "coordinator");
check(!unknownTrans.ok, "unknown id transition fails");

// --- Duplicate transition requires target ---
const c5 = createItem(
  validInput({
    title: "Same projector flicker repeat report this hour",
    description:
      "Same hall projector flickers again every few minutes, matching the earlier dead report.",
    location: "BUS 110",
  }),
);
const dupNoTarget = transitionItem(c5.item.id, "duplicate", "coordinator");
check(!dupNoTarget.ok, "duplicate without target fails");
const dupOk = transitionItem(
  c5.item.id,
  "duplicate",
  "coordinator",
  "same unit",
  "RPT-1001",
);
check(dupOk.ok === true, "coordinator mark-duplicate with target ok");
check(
  dupOk.ok && dupOk.item.duplicateOfId === "RPT-1001",
  "duplicate sets duplicateOfId",
);

// --- Malformed event filtered ---
check(
  validateEvent({ bogus: true }) === false,
  "malformed event fails validateEvent",
);
check(
  listEvents().every(validateEvent),
  "stored events all pass validateEvent",
);

// --- Seeded dup link resolves ---
ensureSeeded();
const seedDup = getItem("RPT-1002");
check(
  seedDup !== null && seedDup.duplicateOfId === "RPT-1001",
  "seed RPT-1002 links RPT-1001",
);
check(
  seedDup !== null && getItem(seedDup.duplicateOfId) !== null,
  "seeded dup link resolves to target title",
);

// --- ID sequencing kept unique ---
const ids = listItems().map((i) => i.id);
check(new Set(ids).size === ids.length, "all item ids unique");

// --- AD-5 seed namespaces (P5): validated selection, isolated keys ---
reseedDemo();
check(listItems().length === 10, "reseed restores 10 canonical seeds");
check(getActiveSeedId() === "campus-maint-v1", "active seed defaults canonical");
check(setActiveSeedId("evil!") === false, "setActiveSeedId rejects malformed id");
check(setActiveSeedId("unknown-pack") === false, "setActiveSeedId rejects unregistered id");
check(
  getActiveSeedId() === "campus-maint-v1",
  "rejected switch leaves active namespace unchanged",
);
check(setActiveSeedId("campus-maint-v1") === true, "setActiveSeedId accepts registered id");
const ka = queueKeys("campus-maint-v1");
const kb = queueKeys("night-pack");
check(
  ka.items !== kb.items && ka.events !== kb.events && ka.meta !== kb.meta,
  "per-pack namespaces never collide",
);
check(
  ka.items === "relayboard:campus-maint-v1:items",
  "canonical namespace keys exact",
);
check(
  listItems().length === 10,
  "namespace switch-back still lists 10 canonical seeds",
);

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures > 0 ? 1 : 0);
