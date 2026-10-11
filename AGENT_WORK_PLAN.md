# RelayBoard — Campus Fix: AGENT WORK PLAN (Stage 2, LOCKED)

> Six implementation responsibilities for solo+AI-agents execution. File ownership exclusive — no two agents edit same file in same step. Integration order strictly §4. Gates §5.

## 1. Responsibilities + file ownership

| Agent | Owns (exclusive) | Delivers | May read |
|---|---|---|---|
| **A. Schema/Store** (data) | `lib/schema.ts`, `lib/store.ts`, `lib/seed.json` | Zod types+enums+transition guard; localStorage CRUD + hash + events; 10 seeds (all categories, 3 dup pairs, 1 P0) | config flags (read-only) |
| **B. Rules/AI-server** (brain) | `app/api/classify/route.ts`, `lib/fallbacks.ts`, `app/api/health/route.ts` | 8s-timeout classify endpoint + Zod re-validate + cache-by-hash + fallback downgrade; rule scorer + weights; health `{ok,ai,seed}` | schema.ts (import), seed.json (read) |
| **C. Submit + Board** (queue UI) | `app/submit/page.tsx`, `app/board/page.tsx`, `app/page.tsx`, `app/layout.tsx`, `app/globals.css` | S1 form + S2 queue + redirect + shell/nav/role toggle/offline banner; `?demo=1`, Load Sample, skeletons, filters | store.ts, config.ts (read) |
| **D. Detail + Audit** (review UI) | `app/request/[id]/page.tsx`, components `QueueCard/FilterBar/DuplicatePanel/ActionCard/Timeline/IssueForm/AppShell` (under `components/`) | S3 evidence + duplicate panel + action card + stepper + timeline + CSV export | store.ts, schema.ts (read) |
| **E. Resilience/Config** (switches) | `lib/config.ts`, `lib/i18n.json` | Flags `AI_MODE|SIMPLE_MODE|REQUIRE_CONFIRM|LANG|STORAGE|SEED_ID` + `t()` + en keys (+hi stub); `?role`/`?seed`/`?lang` overrides; seed-swap + removal-guard helpers | all (read-only audit that no domain strings leak into code) |
| **F. QA/Deploy** (gates) | README demo script, `.env.example`, Vercel env checklist (no app code) | Runs ACCEPTANCE_TESTS A–F on preview/prod, owns freeze/rollback call, records backup video + URLs | all (read-only until gate) |

Shared read-only: `ACCEPTANCE_TESTS.md`, `DEMO_PLAN.md`. No agent touches another's owned files without handoff note.

## 2. Minimal working path (build in this order)

```
P0 skeleton (C): layout + / → /board redirect + empty board + submit stub → deploy stub URL (hour 1.5).
P1 data (A): schema + store + seed.json (10) + ?demo=1 reseed → board lists seeds, detail placeholder.
P2 brain (B): fallbacks.ts scorer → /api/classify (fallback-only, no key needed) → health endpoint.
P3 review UI (D): request/[id] + action card + stepper + timeline + export → F1–F10 pass with AI_MODE=rule.
P4 switches (E): config.ts + i18n.json + role/seed/lang overrides + SIMPLE_MODE guards.
P5 gates (F): full ACCEPTANCE_TESTS on preview → prod freeze → backup video.
```

> P4 scope note (added P4, lead): as built, P4 ships query+persisted switches
> for role/lang/simple/demo only (`REQUIRE_CONFIRM`, `STORAGE`, `?seed` are
> NOT implemented — AD-3/AD-5 cannot be exercised through switches yet).
> P4 additionally closes the P3 F4/F8 gaps: deterministic duplicate
> suggestions (`lib/duplicates.ts`, same-location gate + ≥0.5 overlap, top-3),
> board search + dup badges, and an auditable unmark path via the minimal
> schema edge `duplicate→open` (history preserved with `status_changed`;
> endorsed by Agent C). G4 AD coverage is therefore AD-1 (rule default),
> AD-2 (SIMPLE_MODE), AD-4 (lang fallback), AD-6-partial (export/roles);
> AD-3/AD-5 remain scheduled, not claimed.
>
> P5 update (lead): AD-3 and AD-5 are now implemented — REQUIRE_CONFIRM via
> a `confirm` flag (default true, `?confirm=0` disables, persisted pref;
> terminal Resolve/Reject require an arming click, audit carries
> "confirmed inline") and `?seed=` via a validated pack registry
> (REGISTERED_SEED_IDS, per-pack isolated namespaces). STORAGE stays out:
> no AD/F item tests a storage switch and the blueprint mandates
> localStorage-only MVP — recorded as explicitly deferred, not missing.
Optional only after P5 green: photo preview polish, hi key fill, transcript-paste stub, extra seeds.

## 3. Dependencies

- A blocks B (B imports schema), B blocks C/D classify wiring (C/D build against fallback mock until B lands: `fetchClassify()` stub returning `fallbacks.classify()` shape).
- E can parallel P0–P2 (flags default safe: `AI_MODE=rule, REQUIRE_CONFIRM=true, STORAGE=local`), must land before F's AD tests.
- F runs after each P milestone (P0: deploy live; P1: F12; P3: F1–F11+E; P4: AD; P5: full + perf/a11y).
- Key rule: client never imports `lib/config.ts` server accessor or reads `AI_API_KEY`; only B's route does.

## 4. Integration sequence (solo checklist)

1. C ships stub → F deploys preview URL (hour 1.5), posts URL in README.
2. A lands schema+store+seeds → C wires list/submit to store → F runs F2+F12.
3. B lands fallbacks+classify(fallback) → C/D wire `fetchClassify()` → F runs F1–F4 + AI-7.
4. D lands detail/audit/export → F runs F5–F11 + E1–E12.
5. E lands flags/i18n → C/D add guards (`SIMPLE_MODE`, `REQUIRE_CONFIRM`, `?role/?seed/?lang`) → F runs AD-1–AD-7.
6. F runs full A–F on preview → merge → prod → 5-min verification → freeze + star rollback target + record backup.

## 5. Completion gates (no skip)

- **G0 Deploy live:** `*.vercel.app` + `/api/health` 200. Owner: F. Unblocks everything.
- **G1 Data:** 10 seeds render, `?demo=1` idempotent, hash stable. Owner: A+F (F12).
- **G2 Brain:** no-key submit→classify <1s, 3 fallback examples exact, timeout→fallback ≤8s. Owner: B+F (AI-7, AD-1).
- **G3 Review loop:** F1–F11 + E1–E12 green on preview. Owner: D+F.
- **G4 Switches:** AD-1–AD-7 green, `grep` no domain literals in code, no `NEXT_PUBLIC_*` key. Owner: E+F.
- **G5 Ship:** full A–F green on prod + Lighthouse a11y ≥90 + backup video + 2 starred deployments. Owner: F. After G5: code freeze except rollback.

## 6. Aggressive cuts + risks

Cut: drag-drop, rich-text, charts, modals lib, toasts lib, pagination lib, photo pipeline, vector, realtime, auth, payments. If behind at any gate: cut photo input first, then hi keys, then search box (keep status filter). Top risks: LLM latency (8s abort), dup false-positives (threshold+human override), P0 mis-triage (keyword force-upgrade + mandatory gate), quota storage (in-memory fallback), scope creep (freeze rule: new table/status/role/service needs replaced-thing + fail-proof + <45 min).

## 7. Challenge-1 incident-relationship note (decisions + what replaces what)

> Lead-authorized append (Challenge Card 1). Stored incident model — the
> freeze rule is met as: (a) it replaces nothing working — report queue,
> transitions, CSV, and `suggestDuplicates` are byte-behavior-identical
> (all six suites green, assertions not lowered); (b) demo fails without it
> — noisy duplicates, merge, reclassify, and verification have no place to
> persist (derived views cannot hold them); (c) additive-only schema/store
> plus new files, no dependency installs.

- **Model (additive, `lib/schema.ts`):** `Department` (+`isDepartment`,
  `departmentForCategory`: wifi→network_ops, classroom_equip→
  classroom_support, electrical→safety on P0 else facilities,
  water/facility→facilities, other→triage); `MasterIncident` (INC-\<n\>,
  canonical fields, `attachedReportIds` non-empty, `mergedIntoId` alias,
  `verification {unverified|confirmed_fixed|still_broken}`) reusing the
  Status union (no new member; Assigned is display-only for approved);
  `IncidentEvent` (old-6 + incident_created|report_attached|
  incident_merged|reclassified|reassigned|verified); `Item.incidentId?`
  optional (old records still validate); `INCIDENT_TRANSITIONS` = item
  matrix + exactly one edge (resolved→in_progress reopen, incident-level
  ONLY — Item matrix frozen, reports terminal at resolved).
- **Matching (`lib/clustering.ts`, new):** pure/deterministic/bounded
  (MAX_TOKENS 64, SCAN_CAP 200, limit 3), similarity-only. Synonym
  append-tags (zznet/zzproj/zzdown/zzdegraded), building alias table,
  LocationTier EXACT/SAME_BUILDING/MISSING/CONFLICT, category
  SAME/WILDCARD/CONFLICT; auto ≥0.80, review 0.50–0.79 (+ MISSING ≥0.65 &
  strong≥2, CONFLICT ≥0.85 & strong≥2, cat-conflict capped review +
  reclassify flag), else separate. Evidence per candidate
  (band/reasons≤4/sharedTokens≤8/tier/categoryNote); tie-break
  score↓createdAt↑id↓. STOPWORDS extends the duplicates list;
  generic-only→0. Matches reports against canonical incidents via member
  token union. `lib/duplicates.ts` untouched (regression-tested).
- **Store (`lib/store.ts`, additive):** NEW keys
  `relayboard:{seed}:incidents` / `:incident_events` (+ additive
  `queueKeys` fields; canonical three values unchanged) and separate
  `meta.incidentSeq` (RPT sequencing untouched). Lazy: derive in memory
  via pure `deriveIncidents()` (duplicateOfId roots, 50-hop walk, survivor
  oldest/ smallest-id, status max-progress, INC-\<survivor suffix\>) when
  the key is absent; persist on first incident mutation; unpersisted
  singletons collapse as "ungrouped" placeholders (never silently replace
  persisted groupings). Derived canonical incidents start with EMPTY
  events. Ops (all validate-first, zero side effects on failure):
  `submitReportWithClustering` (createItem unchanged → match →
  auto-attach-only-on-auto with similarity message → else new incident;
  "awaiting review" when confidence<0.6 or location missing; never claims
  unconfirmed attachments), `attachReportToIncident` (coordinator,
  no-dup-attach), `mergeIncidents` (coordinator+reason, canonical/distinct,
  50-hop both-direction cycle walk, deduped union, source→duplicate+alias,
  `resolveIncident` 50-hop), `reclassifyIncident`/`reassignIncident`
  (coordinator+reason, events old→new, items never mutated),
  `transitionIncident` (role parity: coordinator all; assignee
  approved↔in_progress↔resolved+verify; student verify/reopen ONLY via one
  documented if-statement), `verifyIncident` (fixed→confirmed_fixed;
  broken→still_broken+reopen, department kept; one
  `relayboard:{seed}:verify:{incidentId}` vote key, latest wins display,
  every vote an event; resolved-only).
- **Surfaces:** board = one card per canonical incident (dept+status,
  ×N, uncertainty + candidate flags, 1-line explanation, search across
  member texts, Active-default filter, max-score/newest sort, "N incidents
  (M reports)"); detail = incident header + attached reports
  (original-vs-corrected, /request/RPT-xx links intact) + candidate
  Attach/Dismiss + merge picker + reclassify/department + stepper +
  Fixed/Still-broken + deterministic timeline; submit = three-way
  messaging with real links. CSV FROZEN (report rows, 10 columns).
- **Demo pack (new files only):** `lib/seed-challenge-wifi-1.json` +
  registry entries (`lib/store.ts` + `lib/config.ts`), id
  `challenge-wifi-1`; canonical seed/hash untouched. 9 reports / 6
  incidents incl. resolved+verified INC-2106 whose 2 events are
  synthetic-labeled (actor coordinator; no real-person claims).
- **Verification:** `scripts/verify-incidents.mjs` (124 checks after lead
  T13 hardening: 501-char note/reason caps, create gate, limit cap,
  truncation bound, genuine demo scores CHW-05 0.57 / laundry 0.15 /
  printer 0.27 / guided auto-attach; existing tsc-to-tmpdir pattern);
  `npx tsc --noEmit` clean; six suites green (seeds a21ee8d7, scorer 90,
  workflow 68 = HEAD baseline, csv 21, config 73, duplicates 49).
  NOT done here: `npm run build` (lead gate), servers, browser proof
  (see DEMO_PLAN §7.4).
- **Lead review resolutions (Challenge 1 gate):** matcher tier-gates
  enforced before category cap (MISSING/CONFLICT pairs need ≥0.65/≥0.85 +
  strong≥2 even when categories differ); WEAK tokens excluded from the
  strong gate (tag mapping kept for recall — documented deviation);
  down/no-signal restored as zzdown tags only (hallway-guarded);
  tie-break id ASC; limit hard cap 10; tokenizer truncation bound.
  Intentional narrowings (documented, not defects): uncertainty indicator
  is confidence-driven only; pending-candidate scan covers single-member
  incidents; merged sources keep a banner+link page (no auto-redirect);
  auto-attach audit actor is coordinator-by-authority (see DEMO §7.4 note).
  Deferred: subunit parsing (no band impact), expectedCategory evidence
  field, locationLabel non-empty guard, quota banner, full hi coverage.
