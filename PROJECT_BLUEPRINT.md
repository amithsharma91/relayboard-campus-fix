# RelayBoard — Campus Fix: PROJECT BLUEPRINT (Stage 2, LOCKED)

> Planning only. No app code scaffolded. Implementation may begin only after approval.
> Subagents ran: Product (ses_ed87fe2f1ffe2yxM1brFK3Enj9), UI/UX (ses_ed87fe2d9ffeEYRC1VnQxvU4A9), Architecture (ses_ed87fe2cdffeC5YCwQ6Fbu0HOr), AI (ses_ed87fe2bfffeuuXxm2OCWWez30), Resilience (ses_ed87fe2a7ffei5nu31ZTH8sPhJ), QA/Deploy (ses_ed87fe29affeKWI7l4vVyQyJw3). All completed, planning-only, no files modified by them.

## 1. Product scope (frozen)

**What:** Single-tenant web queue for campus reports (Wi-Fi, classroom equipment, facility/electrical/water). Turns noisy student submissions into deduplicated, prioritized queue where every AI suggestion needs explicit staff approval, with status tracking + append-only audit.

**Primary user:** Facilities front-desk coordinator (mock role) clearing dozens of reports/day. Secondary: student reporter, assignee.

**Jobs-to-be-done:** submit in <60s → see duplicates grouped → approve/edit/reject AI priority+action in one click → track Open→Approved→In Progress→Resolved → prove decisions via audit+export.

**User flow (6 steps, offline-capable):**
1. Student opens `/submit`, picks building+room (seeded dropdown), category, severity self-report, description → saved as `Open`, appears on `/board` instantly.
2. System flags likely duplicates (same building + keyword overlap ≥0.5, 7-day window) with `×N dupes` badge + collapsible group.
3. System proposes `Ticket{category, severity P0-P3, priority_score 0-100, recommended_action, confidence}` via rule fallback always; LLM re-rank only if key present.
4. Coordinator clicks Approve / Edit / Reject per item (bulk-approve exact duplicates only). Nothing reaches `Approved` without a click.
5. Assignee moves `Approved → In Progress → Resolved` via button group. Student view updates on refresh (no realtime).
6. Detail page shows audit timeline (actor, old→new, timestamp) + CSV export.

**MUST (24h):** 3 screens, role switcher (no login), 1 submit form, queue list with filter/sort, duplicate badge+panel, action card with confidence, status stepper, audit timeline, CSV export, `?demo=1` seed+reset, offline rule path, server-validated `/api/classify`.

**CUT (with replacement):** auth provider → `?role=` + header toggle + "Mock Auth" banner; photo upload → optional single file preview via object URL only (or cut entirely if behind); voice/rich-text → plain textarea 500-char + counter; realtime/websockets → refresh; vector DB/embeddings → trigram+keyword matcher; multi-agent/LangGraph → single POST; payments/maps/charts → none; mobile app → responsive web; full i18n → English UI + `i18n.json` keyed for `en` (+ `hi` stub keys only).

**POST-MVP (do not build):** voice/SMS intake beyond paste-transcript stub, image dedup, full Hindi UI, RBAC/SSO, SLA timers, push/email, map view, analytics charts, semantic vector search, auto-dispatch.

**Definition of done:** cold run with NO AI key: seed → submit → dedup badge on ≥2 known pairs → approve → resolve → audit+export in <3 min; queue renders <1s; no `Approved` without click (403 on direct POST without approver); audit covers every transition; `grep -r API_KEY` client empty; README quickstart + demo script + limits.

**Freeze rule:** schema/statuses/roles frozen (below). New table/status/role/service/build-step needs (a) what it replaces, (b) proof demo fails without it, (c) <45 min. Else POST-MVP.

## 2. Conflict resolutions (lead decisions)

- **Routes:** canonical `/`, `/submit`, `/board`, `/request/[id]`. Architecture's `/audit` folded into detail timeline + board CSV export (keeps 3-screen promise).
- **Statuses:** canonical `Open → Approved → In Progress → Resolved` + terminal `Rejected` + `Duplicate` link. Map: Architecture `new/triaged` = `Open` (pre/post classify); QA `pending` = `Open`. No separate P1-P4 priority enum — use Severity P0-P3 + numeric `priority_score`.
- **Categories:** canonical 6: `wifi | classroom_equip | electrical | water | facility | other`. AI's `network_other` inputs map to `wifi` (wired/DNS noted in rationale). UI select shows 6 labels.
- **Severity display:** P0=Urgent(red) / P1=High(orange) / P2=Med(amber) / P3=Low(zinc). Score 0-100 drives sort; bands P0 [85,100], P1 [65,84], P2 [35,64], P3 [0,34].
- **Roles:** canonical 3 mock: Student / Coordinator / Assignee (maps to reporter/reviewer/assignee). Header toggle + `?role=`. Audit actor = role string. Default demo: Coordinator.
- **Seeds:** canonical 10 rich seeds (covers five of six categories — `other` is reachable via live ambiguous input — plus 2 duplicate pairs + 1 P0 safety), not 25 (cut for 24h). Matches `lib/seed.json` and `DEMO_PLAN.md`; corrected P2 (was: "all categories + 3 pairs"). `?demo=1` idempotently reseeds. Labeled "Demo data".
- **Storage:** localStorage-first namespaced `relayboard:{SEED_ID}:items/events`. No SQLite/Postgres in MVP (POST-MVP option only).
- **File map:** §4 merges all agents (14 files max).

## 3. Screen design (3 screens)

Routes: `/` redirects to `/board` (or `/submit` if empty and no `?demo=1`). Header on all: logo, nav Submit/Board, role toggle, Load Sample, offline dot, `Demo data` chip when `?demo=1`.

**S1 `/submit` (max-w-2xl):** Form card: Title (input), Location (select 12 seeded bldg/rooms), Category (select 6), Self-severity (segmented Low/Med/High/Urgent), Description (textarea 3 rows, 500 max + counter), Photo optional (single input, object-URL preview; first to cut). Row: `Submit Issue` + `Load Sample & Submit`. Success: inline banner + `View on Board →` (no auto-redirect). Errors inline, focus to field. Mobile: sticky bottom submit.

**S2 `/board` (max-w-5xl):** Sticky filter row: Search, Status select (All/Open/Approved/In Progress/Resolved), Sort (Priority↓/Newest/Severity). List: vertical `QueueCard`s sorted by score: severity chip + `P87` mono score + title + location•time-ago + `×N dupes` badge + status pill + confidence dot. Duplicate clusters collapsed with chevron. Empty: `No issues match — Submit one` CTA. Load: 3 skeletons 600ms in demo mode. Mobile: filters in `<details>`, cards full-width.

**S3 `/request/[id]` (max-w-3xl, 2-col→1-col):** Left: title+meta, description, photo thumb, DuplicatePanel (top 1-2: `Possible duplicate of #XXXX (82%)` + View + Mark/Nots). Right (stacks below mobile, sticky approve bar): ActionCard (recommended text, confidence badge High≥80/Med 50-79/Low<50 + %, Approve/Reject + note input, status stepper buttons). Bottom: Timeline (append-only created/classified/approved/status/dedup w/ timestamps). Invalid ID: `Request not found` + back. Decided: buttons disabled + banner.

**Components (7, shadcn only):** `AppShell`, `IssueForm`, `QueueCard`, `FilterBar`, `DuplicatePanel`, `ActionCard`, `Timeline`. Primitives: Card/Button/Input/Select/Textarea/Badge/Skeleton/Alert/Separator. No modal lib (inline confirm), no toast lib (inline Alert + aria-live), no dnd/chart/editor libs.

**Design tokens:** bg zinc-50, card white, border zinc-200, text zinc-900/muted zinc-500, primary zinc-900 button. Chips as §2 mapping. Type: H1 2xl-semibold, H2 lg-semibold, body sm, meta xs-muted, IDs/scores mono. Spacing: page max-w + p-4/md:p-6, cards p-4 gap-3, list space-y-3. Focus: `focus-visible:ring-2 ring-offset-2 ring-zinc-900`. Contrast ≥4.5:1 body. All chips pair color+text. Labels bound, buttons real `<button>`, `aria-live="polite"` on submit+status.

## 4. Architecture + stack

**Stack (chosen for env):** Next.js 14 App Router + TypeScript + Tailwind + shadcn minimal subset + localStorage-first. Justification: (a) `npx create-next-app` works with Node 22/npm 10, no global Vercel CLI needed — Vercel dashboard builds from git; (b) one deploy gives client offline demo + server-only key via `app/api/*/route.ts`; (c) 3-4 shadcn primitives fastest to credible board. NOT Supabase/Firebase (auth+realtime+network violate no-auth + offline locks), NOT vector DB (overkill <5k items), NOT realtime/multi-agent (latency/cost/debug).

**File structure (14 max):**
```
relayboard-campus-fix/
├── app/layout.tsx             # root layout, Tailwind, header nav, offline banner
├── app/globals.css            # tailwind + ≤10 lines tokens
├── app/page.tsx               # redirect / → /board (or /submit if empty)
├── app/submit/page.tsx        # S1 form
├── app/board/page.tsx         # S2 queue
├── app/request/[id]/page.tsx  # S3 detail + timeline
├── app/api/classify/route.ts  # server-only AI + fallback downgrade
├── app/api/health/route.ts    # {ok, ai: live|fallback, seed, sha}
├── lib/schema.ts              # Zod + TS types + enums + transition guard
├── lib/store.ts               # localStorage CRUD + seeds + events + hash
├── lib/fallbacks.ts           # rule scorer (keyword→category/priority)
├── lib/config.ts              # flags: AI_MODE|SIMPLE_MODE|REQUIRE_CONFIRM|LANG|STORAGE|SEED_ID
├── lib/seed.json              # 10 demo issues + buildings + domain label
└── lib/i18n.json              # en keys (+ hi stub)
```
No `middleware.ts`, no `auth/*`, no `db/*` in MVP. `components/ui/` ≤3 inlined shadcn files.

**Data model (generic names):**
```ts
type Role = "student" | "coordinator" | "assignee";
type Category = "wifi"|"classroom_equip"|"electrical"|"water"|"facility"|"other";
type Severity = "P0"|"P1"|"P2"|"P3";
type Status = "open"|"approved"|"in_progress"|"resolved"|"rejected"|"duplicate";
interface Item { id:string; short:string; title:string; description:string; location:string; category:Category; severity:Severity; priority_score:number; status:Status; recommended_action:string; confidence:number; duplicateOfId:string|null; contentHash:string; createdBy:Role; createdAt:string; updatedAt:string; source:"llm"|"fallback"; }
interface Event { id:string; itemId:string; actor:Role; type:"created"|"classified"|"approved"|"status_changed"|"marked_duplicate"|"rejected"; from:string|null; to:string; at:string; note?:string; }
```
Transitions allowlisted: `open→approved|rejected|duplicate; approved→in_progress|rejected; in_progress→resolved|rejected`. Any→`duplicate` requires `duplicateOfId`. Zod both sides; server recomputes hash.

**API `POST /api/classify`:** req `{title 4..120, description 10..2000, location 2..80}` (strip HTML, 413 if >8KB, 20 req/min best-effort). Success 200 `{category, severity, priority_score, recommended_action, confidence, duplicateOfId, contentHash, fallback:false, reason}`. Errors `{error:{code:VALIDATION|TIMEOUT|AI_UNAVAILABLE, message, fallback:true}}` (400/429/503, never leak key). Server timeout 8s → fallback; client fetch 15s, 1 retry network-only. Cache-by-hash in-memory + localStorage mirror TTL 24h; same hash → cached + `duplicateOfId=<existing>`.

**Client vs server:** client = instant Zod feedback, rule fallback render, board/audit render. Server = authoritative validate, AI call, hash, dedup suggestion. Key ONLY server: `process.env.AI_API_KEY` via `getServerConfig()` throwing on `typeof window!=='undefined'`. Never `NEXT_PUBLIC_*`.

**Deploy (no CLI):** local `npm run build` green → `git init/commit/push` → Vercel Dashboard Import Git → preset Next.js → add env (Production+Preview) → Deploy → smoke `/api/health` + `/board`. Offline backup: `npm run start` on laptop + hotspot. Rollback: promote previous green deployment.

## 5. AI contract

**Ticket JSON (single object, no prose):** `{category enum(6), severity P0-P3, priority_score 0-100, duplicate_of: RPT-id|null, recommended_action enum[escalate_safety|assign_facilities|assign_network_ops|assign_classroom_support|notify_building_manager|request_more_info|mark_duplicate|no_action], confidence 0-1, rationale_short ≤200ch}`. Rules: `other` ⇒ confidence≤0.6; `mark_duplicate` ⟺ `duplicate_of!=null`; `escalate_safety` ⟺ P0. `duplicate_of` must match `^RPT-\d+$` from provided candidates only. Server adds `{needs_human, source, model, latency_ms, validated:true}`.

**System prompt (8 lines):** role=triage, shape-only JSON; no fabrication (use report+candidates only); vocab map (AP/SSID/eduroam→wifi; projector/HDMI/mic→classroom_equip; breaker/spark/outlet→electrical; leak/flood/toilet/HVAC→water; door/lock/chair/elevator→facility); severity P0 safety/bldg-wide → P3 cosmetic; duplicate only same-building + overlap≥0.5 else null; confidence 0.9+ exact bldg+room+keyword / 0.6-0.89 partial / <0.6 other/conflict/<5 tokens; action P0→escalate, dup→mark_duplicate, missing loc→request_more_info. Params: temp 0-0.1, max 300 tokens, json_object/strict.

**Pre (always):** redactPII (emails/phones/IDs→[REDACTED]) → cap 2000ch word-boundary → normalize (lower, abbrev expand rm/bldg/proj/ac) → keyword candidates: stemmed overlap `|A∩B|/|A|`, keep same-building + ≥0.5 top-3 (≤60 tokens each). <5 tokens → skip LLM → fallback `request_more_info` conf 0.3.

**Post (always):** Zod strict → duplicate enforce (unlisted ID / overlap<0.5 / bldg mismatch → null + downgrade action + cap conf 0.55) → priority clamp to severity band + safety keywords force ≥P1 (P0 if electrical+safety) → action consistency → `needs_human = conf<0.6 OR P0 OR action∈{escalate,mark_duplicate,request_more_info}`. UI gates on this flag.

**Repair:** 1 retry max (≤2 calls/action): resend `{zod errors + rule, "Re-emit ONLY corrected JSON"}`. Else fallback, `source:fallback`, `needs_human:true`. Log model/latency/error server-only.

**Fallback scorer:** base 20 + group weight (wifi/classroom 30, electrical/water 35, facility 25, single-user/cosmetic −10) + severity bonus (P0+45/P1+30/P2+10/P3+0) + multi-report +10 (≥2 candidates) → clamp to band. Confidence 0.75 (one group+bldg) / 0.55 (no bldg) / 0.35 + other (zero/tied). Examples: Sci 204 projector→classroom_equip/P1/70/assign_classroom_support/0.75; Library drip→water/P2/64/assign_facilities/0.75; sparking outlet+smoke→electrical/P0/100/escalate_safety/0.75+needs_human.

**Eval+ caps:** 6 goldens (dorm wifi P1, BUS projector P1, CHEM spark P0, Eng overflow P1, CS DHCP→wifi P1, LIB chair P3) + dup probe + `help my thing broken`→other/P3/request_more_info/<0.6. Gates: category ≥5/6, severity ≥5/6, invalid-JSON 0 post-pipeline, p95 ≤8s, fallback covered key-removed. Prompt ≤1200 tokens, log tokens/latency/source.

## 6. Fallback behavior

No key / timeout / invalid after repair / offline → `source:fallback`, banner "Running offline rules — AI paused" (and "AI features OFF — manual triage mode"), full submit→approve→resolve→export path intact. `?demo=1` forces seeded fallback path. Backup: 60s clip + screenshots.

## 7. Risks + cuts

Auth/vector/realtime/payments/maps cut per §1. Biggest remaining risks: (1) LLM slowness → 8s abort + manual continue; (2) duplicate false positives → threshold + human Not-duplicate; (3) P0 over/under-triage → safety-keyword force-upgrade + mandatory human gate; (4) storage quota → in-memory + banner; (5) scope creep → freeze rule §1.
