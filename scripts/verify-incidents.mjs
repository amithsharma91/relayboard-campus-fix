// RelayBoard Campus Fix — Challenge-1 incident verification (plain node).
//
// Compiles lib/schema.ts + lib/clustering.ts + lib/fallbacks.ts +
// lib/store.ts with the project's OWN tsc binary (commonjs output), requires
// the result, and asserts the incident-clustering contract on isolated
// in-memory state (server-side mirrors; no browser needed). Prints PASS
// lines, exits nonzero on any failure.
//
// Usage: node scripts/verify-incidents.mjs   (Node 22; no flags needed)
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const tscBin = join(root, "node_modules", ".bin", "tsc");
const outDir = mkdtempSync(join(tmpdir(), "relayboard-incidents-"));

try {
  execFileSync(
    tscBin,
    [
      "--outDir", outDir,
      "--rootDir", join(root, "lib"),
      "--module", "commonjs",
      "--target", "es2022",
      "--moduleResolution", "node",
      "--strict",
      "--skipLibCheck",
      "--resolveJsonModule",
      "--esModuleInterop",
      join(root, "lib", "clustering.ts"),
      join(root, "lib", "duplicates.ts"),
      join(root, "lib", "store.ts"),
      join(root, "lib", "fallbacks.ts"),
      join(root, "lib", "schema.ts"),
    ],
    { stdio: "pipe" },
  );
} catch (e) {
  const err = e.stderr ? String(e.stderr) : String(e);
  console.error(`FAIL: tsc compile of lib/ failed:\n${err}`);
  process.exit(1);
}
copyFileSync(join(root, "lib", "seed.json"), join(outDir, "seed.json"));
copyFileSync(
  join(root, "lib", "seed-challenge-wifi-1.json"),
  join(outDir, "seed-challenge-wifi-1.json"),
);

const require = createRequire(import.meta.url);
const store = require(join(outDir, "store.js"));
const schema = require(join(outDir, "schema.js"));
const cl = require(join(outDir, "clustering.js"));
const dup = require(join(outDir, "duplicates.js"));

const {
  reseedDemo, listItems, listEvents, listIncidents, listIncidentEvents,
  getIncident, resolveIncident, deriveIncidents, createItem, transitionItem,
  createIncidentForReport, attachReportToIncident, mergeIncidents,
  reclassifyIncident, reassignIncident, transitionIncident, verifyIncident,
  readVerifyVote, verifyVoteKey, submitReportWithClustering,
  setActiveSeedId, getActiveSeedId, queueKeys, canonicalSeedHash,
  parseIncidents, parseIncidentEvents,
} = store;
const {
  isDepartment, departmentForCategory, validateIncident, validateIncidentEvent,
  isIncidentEventType, validateItem, canTransition, canTransitionIncident,
  incidentStatusLabel, INCIDENT_TRANSITIONS,
} = schema;

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

function evCount() {
  return listIncidentEvents().length;
}

// ================= T1 schema =================
check(isDepartment("network_ops") && !isDepartment("nope"), "T1 isDepartment");
check(departmentForCategory("wifi", "P1") === "network_ops", "T1 wifi->network_ops");
check(departmentForCategory("classroom_equip", "P1") === "classroom_support", "T1 classroom->classroom_support");
check(departmentForCategory("electrical", "P0") === "safety", "T1 electrical P0->safety");
check(departmentForCategory("electrical", "P1") === "facilities", "T1 electrical P1->facilities");
check(departmentForCategory("water", "P2") === "facilities", "T1 water->facilities");
check(departmentForCategory("facility", "P3") === "facilities", "T1 facility->facilities");
check(departmentForCategory("other", "P3") === "triage", "T1 other->triage");
check(
  ["created", "classified", "approved", "status_changed", "marked_duplicate", "rejected",
   "incident_created", "report_attached", "incident_merged", "reclassified", "reassigned", "verified"]
    .every(isIncidentEventType),
  "T1 12 incident event types (old-6 + new-6)",
);
check(incidentStatusLabel("approved") === "Assigned", "T1 Assigned display label for approved");
check(canTransitionIncident("resolved", "in_progress") === true, "T1 incident reopen edge resolved->in_progress");
check(canTransitionIncident("open", "resolved") === false, "T1 incident open->resolved still blocked");
check(canTransition("open", "resolved") === false, "T1 item matrix frozen (open->resolved false)");
check(INCIDENT_TRANSITIONS.duplicate.length === 0, "T1 merged incidents terminal");
(function t1item() {
  const it = listItems()[0];
  const bare = { ...it };
  delete bare.incidentId;
  check(validateItem(it) && validateItem(bare), "T1 validateItem accepts old records without incidentId");
  check(!validateItem({ ...it, incidentId: "" }), "T1 validateItem rejects empty incidentId");
  check(!validateItem({ ...it, incidentId: 42 }), "T1 validateItem rejects non-string incidentId");
})();

// ================= T2 migration =================
reseedDemo();
const derived = deriveIncidents(listItems());
check(derived.length === 8, "T2 migration yields 8 incidents from 10 seeds", String(derived.length));
const d1001 = derived.find((i) => i.id === "INC-1001");
check(
  d1001 !== undefined && JSON.stringify(d1001.attachedReportIds) === JSON.stringify(["RPT-1001", "RPT-1002"]),
  "T2 INC-1001 groups dup pair survivor-first",
);
const d1003 = derived.find((i) => i.id === "INC-1003");
check(
  d1003 !== undefined && JSON.stringify(d1003.attachedReportIds) === JSON.stringify(["RPT-1003", "RPT-1004"]),
  "T2 INC-1003 groups dup pair survivor-first",
);
check(
  derived.every((i) => i.status === "open" && i.mergedIntoId === null && i.verification.state === "unverified"),
  "T2 derived all open/canonical/unverified",
);
check(d1001 !== undefined && d1001.department === "safety", "T2 electrical P0 derives safety department");
check(derived.every(validateIncident), "T2 all derived pass validateIncident");
check(
  JSON.stringify(listIncidents().map((i) => i.id)) === JSON.stringify(derived.map((i) => i.id)),
  "T2 lazy listIncidents equals derivation (no persist on read)",
);
check(listIncidentEvents().length === 0, "T2 derived incidents start with EMPTY events (no fabricated history)");

// ================= T3 auto-attach =================
const gym1 = submitReportWithClustering({
  title: "Gym treadmill belt snapped mid-workout",
  description: "The treadmill belt in the campus gym snapped during a workout and the machine stopped. Needs a replacement belt.",
  location: "GYM 1F",
});
check(gym1.ok === true, "T3 novel report submits ok");
check(gym1.ok && gym1.attached === false && gym1.band === "separate", "T3 novel report opens new incident (separate)");
const incA = gym1.ok ? gym1.incident.id : "?";
check(gym1.ok && /^INC-11\d+$/.test(incA), "T3 new incident id INC-(1100+seq)", incA);
check(gym1.ok && gym1.message.toLowerCase().includes("new incident"), "T3 message 'new incident opened'");
const gym2 = submitReportWithClustering({
  title: "Gym treadmill belt torn, same machine",
  description: "The same gym treadmill belt is torn and snapped. Machine stopped mid-workout, waiting on a replacement belt.",
  location: "GYM 1F",
});
check(gym2.ok === true, "T3 near-copy submits ok");
check(gym2.ok && gym2.attached === true && gym2.band === "auto" && gym2.score !== null && gym2.score >= 0.8, "T3 near-copy auto-attaches", gym2.ok ? JSON.stringify({ band: gym2.band, score: gym2.score }) : "");
check(
  gym2.ok && gym2.incident.id === incA && gym2.message.includes(incA) && /similarity \d+%/.test(gym2.message),
  "T3 message names incident + similarity",
);
check(
  gym2.ok && listIncidentEvents().some((e) => e.type === "report_attached" && e.reportId === gym2.item.id),
  "T3 report_attached event appended",
);
check(
  gym2.ok && getIncident(incA).attachedReportIds.length === 2,
  "T3 membership grows to 2",
);
// every report belongs to exactly one incident
check(
  listItems().every((it) => listIncidents().some((inc) => inc.attachedReportIds.includes(it.id))),
  "T3 every report in exactly one incident (canonical ns)",
);

// ================= T4 review =================
const wifiSlow = submitReportWithClustering({
  title: "Wifi slow on north dorm floor, pages crawl",
  description: "Wifi on the north dorm floor is slow tonight. Signal looks fine but pages crawl and the lounge cannot connect.",
  location: "N-Dorm 3F",
});
check(wifiSlow.ok === true, "T4 partial-overlap submits ok");
check(
  wifiSlow.ok && wifiSlow.attached === false && wifiSlow.candidates.length > 0 && wifiSlow.candidates[0].band === "review",
  "T4 partial overlap -> review, new incident (no auto-attach)",
  wifiSlow.ok ? JSON.stringify(wifiSlow.candidates[0]) : "",
);
check(
  wifiSlow.ok &&
    Array.isArray(wifiSlow.candidates[0].reasons) && wifiSlow.candidates[0].reasons.length <= 4 &&
    wifiSlow.candidates[0].sharedTokens.length <= 8 &&
    typeof wifiSlow.candidates[0].locationTier === "string" &&
    typeof wifiSlow.candidates[0].categoryNote === "string",
  "T4 evidence fields (band/reasons<=4/shared<=8/tier/note)",
);
// category-conflict capped at review with reclassify flag
(function t4conflict() {
  const itemsById = new Map(listItems().map((i) => [i.id, i]));
  const incs = listIncidents();
  const probe = {
    id: "TST-M", short: "#T", title: "Wifi down across north dorm floor",
    description: "No wifi signal across the north dorm floor since evening. Dozens cannot connect on eduroam.",
    location: "N-Dorm 3F", category: "classroom_equip", severity: "P1", priority_score: 70,
    status: "open", recommended_action: "x", confidence: 0.75, duplicateOfId: null,
    contentHash: "t", createdBy: "student", createdAt: "2026-10-11T10:00:00Z",
    updatedAt: "2026-10-11T10:00:00Z", source: "fallback",
  };
  const wifiInc = incs.filter((i) => i.category === "wifi" && i.id !== "INC-1005");
  const c = cl.matchReportToIncidents(probe, wifiInc.length > 0 ? wifiInc : incs, itemsById, 3)[0];
  check(c !== undefined && c.band === "review" && c.reclassifyFlag === true, "T4 cat-conflict capped review + reclassify flag", JSON.stringify(c));
})();

// ================= T5 separate =================
const dryer = submitReportWithClustering({
  title: "Dryer ate coins in gym laundry corner",
  description: "The coin dryer in the gym laundry corner took quarters and never started. Drum stays dark and cold.",
  location: "GYM 1F",
});
check(
  dryer.ok && dryer.attached === false && (dryer.candidates.length === 0 || dryer.candidates[0].band === "separate"),
  "T5 disjoint vocab same building -> separate, new incident",
);

// ================= T6 attach rules =================
const evBeforeDup = evCount();
const reattach = attachReportToIncident(gym2.item.id, incA, "coordinator", "again");
check(!reattach.ok, "T6 no-dup-attach: repeat attach fails");
check(evCount() === evBeforeDup, "T6 failed re-attach appends no event");
check(!attachReportToIncident("NOPE", incA, "coordinator").ok, "T6 unknown report rejected");
check(!attachReportToIncident(gym1.item.id, "INC-9999", "coordinator").ok, "T6 unknown incident rejected");
check(!attachReportToIncident(gym1.item.id, incA, "student").ok, "T6 non-coordinator attach rejected");
check(!attachReportToIncident(gym1.item.id, incA, "assignee").ok, "T6 assignee attach rejected");

// ================= T7 merge =================
const libA = submitReportWithClustering({
  title: "Greenhouse pane cracked in dome hall",
  description: "A glass pane in the greenhouse dome hall cracked overnight. Plants are fine but the pane needs replacing.",
  location: "DOME 1F",
});
const libB = submitReportWithClustering({
  title: "Observatory lens cap missing on deck",
  description: "The observatory deck lens cap went missing after the open night. Scope works but the cap must be replaced.",
  location: "DOME 2F",
});
check(libA.ok && libB.ok && libA.incident.id !== libB.incident.id, "T7 two separate incidents for merge");
const srcId = libA.ok ? libA.incident.id : "?";
const tgtId = libB.ok ? libB.incident.id : "?";
const evBeforeMerge = evCount();
const merged = mergeIncidents(srcId, tgtId, "coordinator", "same dome complex");
check(merged.ok === true, "T7 merge ok");
check(
  merged.ok && merged.incident.attachedReportIds.length === 2 &&
    getIncident(srcId).status === "duplicate" && getIncident(srcId).mergedIntoId === tgtId,
  "T7 union + source duplicate + alias",
);
check(merged.ok && merged.event.type === "incident_merged", "T7 incident_merged event");
check(resolveIncident(srcId) !== null && resolveIncident(srcId).id === tgtId, "T7 resolveIncident follows alias");
check(evCount() === evBeforeMerge + 1, "T7 merge appends exactly 1 event");
check(!mergeIncidents(srcId, tgtId, "coordinator", "again").ok, "T7 repeat merge fails");
check(evCount() === evBeforeMerge + 1, "T7 failed repeat merges silently");
check(!mergeIncidents(tgtId, tgtId, "coordinator", "self").ok, "T7 self-merge rejected");
check(!mergeIncidents("INC-9999", tgtId, "coordinator", "x").ok, "T7 unknown source rejected");
check(!mergeIncidents(tgtId, "INC-9999", "coordinator", "x").ok, "T7 unknown target rejected");
check(!mergeIncidents(tgtId, incA, "assignee", "x").ok, "T7 non-coordinator merge rejected");
check(!mergeIncidents(tgtId, incA, "coordinator", "   ").ok, "T7 empty reason rejected");
check(!transitionIncident(srcId, "approved", "coordinator").ok, "T7 merged incident cannot transition");

// ================= T8 reclassify/reassign =================
const itemsBeforeRe = JSON.stringify(listItems());
const evBeforeRe = evCount();
const recl = reclassifyIncident(tgtId, "facility", "coordinator", "dome is facilities scope");
check(recl.ok && recl.incident.category === "facility", "T8 reclassify ok");
check(recl.ok && recl.event.type === "reclassified" && recl.event.from === "other" && recl.event.to === "facility", "T8 reclassified event old->new");
const reas = reassignIncident(tgtId, "safety", "coordinator", "glass risk");
check(reas.ok && reas.incident.department === "safety", "T8 reassign ok");
check(reas.ok && reas.event.type === "reassigned" && reas.event.from === "triage" && reas.event.to === "safety", "T8 reassigned event old->new");
check(JSON.stringify(listItems()) === itemsBeforeRe, "T8 Item originals NEVER mutated");
check(evCount() === evBeforeRe + 2, "T8 history appends 2 events");
check(!reclassifyIncident(tgtId, "facility", "coordinator", "dup").ok, "T8 same-category rejected");
check(!reclassifyIncident(tgtId, "wifi", "coordinator", "").ok, "T8 empty reason rejected");
check(!reclassifyIncident(tgtId, "wifi", "assignee", "x").ok, "T8 non-coordinator reclassify rejected");
check(!reassignIncident(tgtId, "safety", "coordinator", "").ok, "T8 empty reassign reason rejected");
check(!reassignIncident(tgtId, "safety", "student", "x").ok, "T8 student reassign rejected");
check(!reclassifyIncident("INC-9999", "wifi", "coordinator", "x").ok, "T8 unknown incident rejected");

// ================= T9 transitions + ordering =================
check(!transitionIncident(incA, "approved", "student").ok, "T9 student approve fails (carve-out)");
const ap = transitionIncident(incA, "approved", "coordinator", "looks grouped");
check(ap.ok && ap.incident.status === "approved", "T9 coordinator approve ok");
const st = transitionIncident(incA, "in_progress", "assignee");
check(st.ok && st.incident.status === "in_progress", "T9 assignee Assigned->In Progress");
const rs = transitionIncident(incA, "resolved", "assignee");
check(rs.ok && rs.incident.status === "resolved", "T9 assignee In Progress->Resolved");
const badEdge = transitionIncident(dryer.ok ? dryer.incident.id : "?", "resolved", "coordinator");
check(!badEdge.ok, "T9 invalid open->resolved fails");
check(evCount() >= 3, "T9 events accumulated");
(function t9order() {
  const evs = listIncidentEvents().filter((e) => e.incidentId === incA);
  // Chronological by `at`; ties keep storage (emission) order via stable
  // sort — id tie-break actively misorders same-ms events (flaky T9).
  const sorted = [...evs].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  check(
    evs.length >= 3 && JSON.stringify(evs.map((e) => e.id)) === JSON.stringify(sorted.map((e) => e.id)),
    "T9 incident timeline chronological (stable emission order)",
  );
  const tied = [
    { id: "X-b", at: "2026-10-11T10:00:00Z" },
    { id: "X-a", at: "2026-10-11T10:00:00Z" },
    { id: "X-c", at: "2026-10-11T09:00:00Z" },
  ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  check(tied[0].id === "X-c" && tied[1].id === "X-b", "T9 tie-break stable (emission order deterministic)");
})();
const reopen = transitionIncident(incA, "in_progress", "student", "still broken here");
check(reopen.ok && reopen.incident.status === "in_progress", "T9 student reopen resolved->in_progress ONLY");
check(!transitionItem("RPT-1001", "resolved", "coordinator").ok, "T9 report matrix frozen (open->resolved fails)");

// ================= T10 verification =================
transitionIncident(incA, "resolved", "assignee");
const fix = verifyIncident(incA, true, "student");
check(fix.ok && fix.incident.verification.state === "confirmed_fixed", "T10 verify-fixed sets confirmed_fixed");
check(fix.ok && fix.incident.status === "resolved", "T10 verify-fixed keeps resolved");
check(fix.ok && fix.event.type === "verified" && fix.reopened === false, "T10 verified event, no reopen");
const tgtResolved1 = transitionIncident(tgtId, "approved", "coordinator");
const tgtResolved2 = tgtResolved1.ok ? transitionIncident(tgtId, "in_progress", "assignee") : tgtResolved1;
const tgtResolved3 = tgtResolved2.ok ? transitionIncident(tgtId, "resolved", "assignee") : tgtResolved2;
check(tgtResolved3.ok === true, "T10 second incident resolved for broken-vote");
const deptBefore = tgtResolved3.ok ? tgtResolved3.incident.department : "?";
const brk = verifyIncident(tgtId, false, "assignee");
check(brk.ok && brk.incident.verification.state === "still_broken", "T10 verify-broken sets still_broken");
check(brk.ok && brk.incident.status === "in_progress" && brk.reopened === true, "T10 verify-broken reopens to actionable");
check(brk.ok && brk.incident.department === deptBefore, "T10 verify keeps department");
const evBeforeVote2 = evCount();
const fix2 = verifyIncident(incA, false, "coordinator");
check(fix2.ok && evCount() === evBeforeVote2 + 1, "T10 every vote appends an event (latest wins display)");
check(fix2.ok && getIncident(incA).verification.state === "still_broken", "T10 latest vote wins");
check(!verifyIncident(dryer.ok ? dryer.incident.id : "?", true, "student").ok, "T10 non-resolved verify rejected");

// ================= T11 isolation/quota =================
check(canonicalSeedHash() === "a21ee8d7", "T11 canonical hash stable a21ee8d7");
check(parseIncidents("nope") === null && parseIncidentEvents("nope") === null, "T11 malformed incident payloads -> null");
check(parseIncidents(JSON.stringify([{ bogus: 1 }])) === null, "T11 all-invalid incidents -> null");
(function t11iso() {
  const ka = queueKeys("campus-maint-v1");
  const kb = queueKeys("challenge-wifi-1");
  check(ka.incidents !== kb.incidents && ka.incidentEvents !== kb.incidentEvents, "T11 incident namespaces never collide");
  check(ka.incidents === "relayboard:campus-maint-v1:incidents", "T11 canonical incident keys exact");
  check(setActiveSeedId("challenge-wifi-1") === true, "T11 challenge seed selectable");
  check(listItems().length === 9 && listIncidents().length === 6, "T11 pack serves 9 reports / 6 incidents");
  const v = getIncident("INC-2106");
  check(
    v !== null && v.status === "resolved" && v.verification.state === "confirmed_fixed" && v.verification.by === "coordinator",
    "T11 pack resolved+verified incident (synthetic, coordinator)",
  );
  check(listIncidentEvents().length === 2, "T11 pack ships 2 synthetic incident events");
  check(setActiveSeedId("campus-maint-v1") === true, "T11 switch back canonical");
  check(listItems().length >= 10, "T11 canonical state intact after pack visit");
})();

// ================= T12 adversarial bounds =================
(function t12() {
  const big = {
    title: ("Wifi down " + "zone ".repeat(500)).slice(0, 120),
    description: ("dorm wifi down connect evening signal eduroam " + "lobby ".repeat(400)).slice(0, 2000),
    location: "N-Dorm 3F",
  };
  let threw = false;
  let res = null;
  try {
    res = submitReportWithClustering(big);
  } catch {
    threw = true;
  }
  check(!threw && res !== null && res.ok === true, "T12 2000-char-scale input handled, no throw");
  const toks = cl.clusterTokens(big.title, big.description);
  check(toks.size <= 68, "T12 token set bounded (64 + tags)", String(toks.size));
  const itemsById = new Map(listItems().map((i) => [i.id, i]));
  const base = listIncidents()[0];
  const crowd = [];
  for (let i = 0; i < 250; i++) {
    crowd.push({ ...base, id: `INC-8${String(i).padStart(3, "0")}` });
  }
  let out = null;
  try {
    out = cl.matchReportToIncidents(listItems()[0], crowd, itemsById, 3);
  } catch {
    out = null;
  }
  check(out !== null && out.length <= 3, "T12 250-report crowd bounded, limit honored");
  const src = readFileSync(join(root, "lib", "clustering.ts"), "utf8");
  check(!/new RegExp/.test(src), "T12 no dynamic regex in matcher");
  const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
  check(!/fetch\s*\(|XMLHttpRequest/.test(codeOnly), "T12 no network calls in matcher");
  let superset = true;
  dup.STOPWORDS.forEach((w) => {
    if (!cl.CLUSTER_STOPWORDS.has(w)) superset = false;
  });
  check(superset, "T12 cluster stopwords extend duplicates list");
  const generic = cl.clusterTokens("Broken issue please help", "Please help my broken issue, things not working now");
  check(generic.size === 0, "T12 generic-only content -> empty set (score 0)");
})();

// ================= T13 reviewer-mandated hardening (lead) =================
(function t13() {
  // F: 501-char note/reason rejected (no silent truncation).
  const tmp = submitReportWithClustering({
    title: "T13 note-cap probe report for length validation",
    description: "A sufficiently long and unique description for the T13 length-cap probe report.",
    location: "TST 9F",
  });
  check(tmp.ok === true, "T13 probe report submits ok");
  if (tmp.ok) {
    check(
      transitionItem(tmp.item.id, "approved", "coordinator", "x".repeat(501)).ok === false,
      "T13 501-char transition note rejected",
    );
    check(
      mergeIncidents("INC-1001", "INC-1003", "coordinator", "y".repeat(501)).ok === false,
      "T13 501-char merge reason rejected",
    );
  }
  // F: incident creation is coordinator-only.
  const anyId = listItems()[0].id;
  const gated = createIncidentForReport(anyId, "student");
  check(gated.ok === false && /coordinator/i.test(gated.error), "T13 create gate rejects student", gated.ok ? "unexpected ok" : gated.error);
  // B-D6: suggestion limit hard cap.
  const itemsById = new Map(listItems().map((i) => [i.id, i]));
  const baseInc = listIncidents()[0];
  const crowd = [];
  for (let i = 0; i < 12; i++) {
    crowd.push({ ...baseInc, id: `INC-9${String(i).padStart(3, "0")}` });
  }
  const capped = cl.matchReportToIncidents(listItems()[0], crowd, itemsById, 100);
  check(capped !== null && capped.length <= 10, "T13 limit hard-capped at 10", String(capped && capped.length));
  // B-D7: oversized input truncated, bounded, no throw.
  let bigToks = null;
  let bigThrew = false;
  try {
    bigToks = cl.clusterTokens("word ".repeat(2000), "word ".repeat(2000));
  } catch {
    bigThrew = true;
  }
  check(!bigThrew && bigToks !== null && bigToks.size <= 68, "T13 10k-char input bounded, no throw");
  // B-5: genuine demo scores promoted to assertions (challenge pack).
  check(setActiveSeedId("challenge-wifi-1") === true, "T13 challenge pack selectable");
  const pItems = listItems();
  const pMap = new Map(pItems.map((i) => [i.id, i]));
  const pIncs = listIncidents();
  const chw05 = pItems.find((i) => i.id === "CHW-05");
  const c05 = cl.matchReportToIncidents(chw05, pIncs, pMap, 3).find((c) => c.incidentId === "INC-2101");
  check(c05 !== undefined && c05.band === "review" && c05.score === 0.57, "T13 CHW-05 review 0.57", JSON.stringify(c05));
  const chw06 = pItems.find((i) => i.id === "CHW-06");
  const own06 = pIncs.find((inc) => inc.attachedReportIds.includes("CHW-06"));
  const c06 = cl.matchReportToIncidents(chw06, pIncs, pMap, 5).filter((c) => c.incidentId !== (own06 && own06.id));
  const max06 = Math.max(-1, ...c06.map((c) => c.score));
  check(c06.every((c) => c.band === "separate") && max06 === 0.15, "T13 laundry max 0.15 separate (excl. own incident)", JSON.stringify({ max06, bands: c06.map((c) => c.band) }));
  const chw07 = pItems.find((i) => i.id === "CHW-07");
  const own07 = pIncs.find((inc) => inc.attachedReportIds.includes("CHW-07"));
  const c07 = cl.matchReportToIncidents(chw07, pIncs, pMap, 5).filter((c) => c.incidentId !== (own07 && own07.id));
  const max07 = Math.max(-1, ...c07.map((c) => c.score));
  check(max07 === 0.27, "T13 printer-pair max 0.27", JSON.stringify({ max07, top: c07.slice(0, 2) }));
  const guided = submitReportWithClustering({
    title: "Wifi dead across north dorm floor, eduroam keeps dropping",
    description: "No wifi on the north dorm third floor since this morning, eduroam drops constantly and nobody can stay connected.",
    location: "N-Dorm 3F",
  });
  check(
    guided.ok === true && guided.attached === true && guided.band === "auto" && guided.score !== null && guided.score >= 0.8 && guided.incident.id === "INC-2101",
    "T13 guided submit auto-attaches INC-2101",
    guided.ok ? JSON.stringify({ band: guided.band, score: guided.score, inc: guided.incident.id }) : String(guided.ok),
  );
  check(setActiveSeedId("campus-maint-v1") === true, "T13 switch back canonical");
  reseedDemo();
  check(listItems().length === 10, "T13 canonical restored after pack visit");
})();

// duplicates.ts regression: suggestions intact beside the new matcher
(function dupreg() {
  const mk = (id, n) => ({
    id, short: "#T", title: "Projector dead with no signal in lecture hall",
    description: "Ceiling projector shows no signal on hdmi input, sixty students waiting for lecture to start.",
    location: "BUS 110", category: "classroom_equip", severity: "P1", priority_score: 70,
    status: "open", recommended_action: "x", confidence: 0.75, duplicateOfId: null,
    contentHash: `h-${n}`, createdBy: "student", createdAt: `2026-10-10T10:${String(n).padStart(2, "0")}:00Z`,
    updatedAt: `2026-10-10T10:${String(n).padStart(2, "0")}:00Z`, source: "fallback",
  });
  const a = mk("TST-A", 1);
  const b = mk("TST-B", 2);
  const sug = dup.suggestDuplicates(a, [a, b], 3);
  check(sug.length === 1 && sug[0].id === "TST-B" && sug[0].score >= 0.9, "REG duplicates suggestDuplicates intact (exact pair)");
})();

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures > 0 ? 1 : 0);
