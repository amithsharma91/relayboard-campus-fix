# RelayBoard — Campus Fix: DEMO PLAN (3 minutes, LOCKED)

> Goal: one magic moment <60s in (messy report → ranked queue → approved action). Everything clickable live; nothing claimed without click. Primary path runs with NO AI key (fallback). Backup covers every failure.
>
> P-Challenge-1 note: §1–§6 below describe the ORIGINAL pre-challenge demo
> (report queue, `×2 dupes` badge, DuplicatePanel). They are SUPERSEDED for
> challenge demos by §7 (incident cards, `×N reports`, candidate review,
> merge/reclassify/verify). §1–§6 are preserved as history; do not follow
> them for Challenge-1 demos (no `Load Sample` button exists; board cards
> are incidents, detail is incident-based).

## 1. Script (180 seconds)

```text
0:00-0:15 Person+pain (Board, ?demo=1): "Facilities gets 50+ messy texts — Wi-Fi dead, projector out, leaks — no priority, same issue 3×. This is Campus Fix."
0:15-0:35 Ugly input: click top urgent card (CHEM lab sparking outlet, P0/100, confidence High). Point to severity chip + score + ×2 dupes badge. No typing.
0:35-1:20 MAGIC: open detail → DuplicatePanel "Possible duplicate (82%)" → recommended "Escalate safety" + confidence + rationale → click Approve → stepper Approved → move In Progress → Timeline +1/+1. (60s transformation.)
1:20-2:10 Human verify + new report: /submit → Load Sample & Submit ("BUS 110 projector dead, 60 waiting") → appears on board with classroom_equip/P1 + action → filter Status=Open → search "projector" shows dup pair.
2:10-2:40 Export + audit: click Export CSV (opens, count matches) → scroll Timeline (created→classified→approved, actor+timestamps).
2:40-3:00 Twist slide: "Built for Challenge Cards: AI_MODE=rule fallback live now; domain is seed config — reskin to clinic/hostel <60 min; ?role/?lang switches ready." Stop. Q&A.
```
Narrator hint footer on board in demo mode (one line). Sound-muted test: queue → detail → approve → export legible in 30s.

## 2. Seed scenarios (10, Demo data labeled)

| # | Title | Loc | Cat/Sev (fallback) | Purpose |
|---|---|---|---|---|
| 1 | Outlet sparking + smoke smell | CHEM 102 | electrical/P0/100 escalate | Urgent opener, needs_human |
| 2 | Same outlet spark, second report | CHEM 102 | electrical/P0 dup of #1 | Dup badge ×2 |
| 3 | Projector dead, HDMI no signal, 60 waiting | BUS 110 | classroom_equip/P1/70 | Live submit sample |
| 4 | Projector flickers same room | BUS 110 | classroom_equip/P1 dup of #3 | Dup pair #2 |
| 5 | No wifi North Dorm fl3, eduroam drops | N-Dorm 3F | wifi/P1 | Category coverage |
| 6 | Wired lab PCs no IP, DHCP fails | ENGR 305 | wifi/P1 (network note) | network_other→wifi mapping |
| 7 | Toilet overflowing, flooding floor | Engr A RR | water/P1 | Facility urgency |
| 8 | Ceiling drip near sink | LIB 2F | water/P2/64 | Mid priority |
| 9 | Elevator stuck btw floors | SCI B | facility/P1 | Safety-adjacent |
| 10 | Wobbly chair squeaks | LIB 410 | facility/P3 | Low anchor + `help my thing broken`→other/P3/request_more_info backup |

Pre-seed via `?demo=1`. Open on #1. Submit #3 live. Keep #10 for Q&A honesty (lowest-priority P3 anchor, conf 0.75 Medium band — use a live `help my thing broken` input for a true low-confidence demo). Corrected P2 (was: "low conf").

## 3. Expected outputs (judge sees vs not claimed)

| Sees (scored) | NOT claimed (don't oversell) |
|---|---|
| Photo-less text → category+severity+score+confidence+action | "Deployed campus-wide / hours saved" |
| Dup badge + panel + Mark/Not-duplicate | "Semantic AI dedup at scale" |
| Approve click → status + audit + export CSV | "Auto-dispatch / integrated with facilities system" |
| Offline banner + `?demo=1` reseed | "Works with real hospital/EHR data" |
| Role toggle gating (Student can't approve) | "Production auth/RBAC" |

## 4. Q&A defense (30s each)

- "Why not ChatGPT/Sheets?" → "ChatGPT doesn't dedup+prioritize+gate+audit in one queue with offline rules. Watch: same input in ChatGPT gives fluent text, no score/confidence/dup/audit. [Pre-recorded split.]"
- "AI hallucination / dangerous P0?" → "Every output Zod-validated, confidence-gated (<0.6→needs_human), P0 forced human. Here's low-conf example [#10] held at open. Remove key — rules still triage."
- "Dup accuracy?" → "Deterministic same-building+overlap≥0.5, disclosed, human overrides. Show Mark then Not-duplicate round-trip."
- "Scale/privacy?" → "Local-only, no PII leaves device, masked list; 10 seeds honestly labeled Demo data; pilot = one building front-desk, not campus-wide."
- "Challenge adaptation?" → Flip `?role=assignee`, toggle SIMPLE_MODE note, state seed-swap <60 min (show seed.json label, don't live-refactor).

## 5. Backup path (in order)

1. Stall >15s → narrate over skeleton, click pre-loaded #1 (cached), continue manual.
2. AI route fails → banner `AI unavailable — manual mode`, continue fallback (this IS the primary path).
3. Vercel/prod down → Preview URL → phone hotspot → `localhost:3000` (`npm run start` pre-built).
4. WiFi dead → offline backup video (full 3-min run on laptop + phone copy) + pre-exported CSV + screenshots of queue/detail/audit.
5. Always: prod URL + preview URL + `?demo=1` link + video path copied before freeze; 2 starred green deployments for instant rollback.

## 6. GO/NO-GO (T-60 min)

GO: 5-min verification green (seeds<6s, submit→approve→resolve→export, XSS-as-text, single audit on double-click, offline→online no dup, zero console errors). NO-GO: promote previous green deployment, re-run 90-sec path only, demo from backup video if needed. Freeze code at GO.

## 7. Challenge-1 demo guide (Intelligent Incident Clustering + Audit Integrity)

> Pack: `?seed=challenge-wifi-1` (namespace-isolated; canonical `seed.json`
> + hash `a21ee8d7` untouched). 9 reports in 6 stored incidents. Everything
> below is clickable live; nothing claimed without a click. No AI, network,
> or embedding calls exist anywhere in the path (rule-only matcher).

### 7.1 Pack contents (what the judge opens on)

| Incident | Reports | Purpose |
|---|---|---|
| INC-2101 wifi/P1 N-Dorm (×4) | CHW-01, CHW-02 (alias spelling "North Dorm 3F"), CHW-03 (location `?` = missing), CHW-04 (misclassified `classroom_equip`) | Noisy-wifi cluster: alias table, MISSING tier, original-vs-corrected display |
| INC-2102 wifi/P2 (×1) | CHW-05 slow-lounge | Review-only candidate → board shows `candidate to review` flag |
| INC-2103 water/P3 (×1) | CHW-06 laundry flood, same building | Unrelated same-building report stays separate (location alone never merges) |
| INC-2104 other/P3 LIB 2F (×1) | CHW-07 printer jam | Live-merge party A |
| INC-2105 other/P3 LIB 1F (×1) | CHW-08 toner error | Live-merge party B |
| INC-2106 classroom_equip/P3 BUS 110, **resolved + verified** (×1) | CHW-09 | Pre-seeded fix + verification. SYNTHETIC (demo fixture): its 2 incident events carry `synthetic demo fixture` notes, actor coordinator. No real person is claimed. |

### 7.2 Script (120 seconds, appends to §1)

```text
0:00-0:15 Board (?seed=challenge-wifi-1): "6 incidents (9 reports). One card
per incident: master id, severity, department+status, ×N reports, 1-line
cluster explanation, needs-review and candidate flags."
0:15-0:45 MAGIC submit: /submit → Title "Wifi dead in north dorm rooms,
cannot connect", Location "N-Dorm 3F", Description "No wifi in the north
dorm this evening. Eduroam keeps failing and nobody can connect." → banner
"Attached to INC-2101 (similarity 100%)" + View incident link. (Measured:
auto band, score 1.00, EXACT + SAME.)
0:45-1:15 Audit: open INC-2101 → attached-reports list shows CHW-04
"reported as classroom_equip → grouped under wifi" → timeline shows the new
report_attached event with actor + similarity note. Approve → Assigned →
In Progress → Resolve via the stepper (Assigned label for approved).
1:15-1:45 Verify + merge: open INC-2106 (resolved+verified, synthetic vote
disclosed) → Still broken path on a live incident reopens to In Progress
(department kept). Merge INC-2104 into INC-2105 with reason → union card,
source flips duplicate + alias, resolveIncident follows it.
1:45-2:00 Reclassify: INC-2101 reclassify CHW-04's category with reason →
reclassified event old→new, report originals byte-identical. Export CSV:
rows stay reports, 10 columns byte-identical.
```

### 7.3 Measured match scores (rule matcher, no threshold-fudging)

Guided submit → INC-2101 auto 1.00 · CHW-05 → INC-2101 review 0.57
(location EXACT, category SAME) · misclassified wifi-as-classroom_equip →
review 1.00 + reclassify flag (category conflict caps at review, never auto)
· missing-location probe → review 1.00 MISSING (never auto) · cross-building
identical text → review 1.00 CONFLICT (≥0.85 + strong≥2) · CHW-06 laundry →
0.15 separate · printer pair 0.27 separate (pre-separate, manual merge) ·
generic-only text → empty token set, 0 candidates. Thresholds: auto ≥0.80
(EXACT/SAME_BUILDING + SAME/WILDCARD), review 0.50–0.79 (+ MISSING ≥0.65 &
strong≥2, CONFLICT ≥0.85 & strong≥2, cat-conflict ≥0.50 capped), else separate.

### 7.4 Judge evidence (where to point)

- `scripts/verify-incidents.mjs` (124 checks: T1–T12 schema/migration/
  attach/review/separate/membership/no-dup-attach/merge+resolution+cycle/
  reclassify/reassign history/ordering/transitions/verify-fixed+broken/
  failed-write silence/8-from-10 migration/pack isolation+hash/adversarial
  bounds + `suggestDuplicates` regression intact + T13 reviewer hardening:
  501-char note/reason caps, create gate, limit cap, truncation bound,
  genuine demo scores CHW-05 0.57 / laundry 0.15 / printer 0.27 / guided
  auto-attach INC-2101).
- Six prior suites green with assertions unchanged (seeds `a21ee8d7`,
  scorer 90, workflow 68 — recorded 59 in the card brief, actual HEAD
  baseline is 68 — csv 21, config 73, duplicates 49).
- `npx tsc --noEmit` clean. No `npm run build` claimed here (lead gate).
- Audit-attribution note: submit-flow auto-attaches record actor
  `coordinator` (internal authority, same as candidate review) even when the
  reporter is a student — the event means "system attached on the
  coordinator path", not "a named staffer clicked". Say exactly that live.
- Browser proof still needed: board/incident/submit click-path above,
  44px targets at 390px, aria-live announcements, Fast-3G cold load.
