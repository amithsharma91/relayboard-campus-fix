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
