# RelayBoard — Campus Fix: ACCEPTANCE TESTS (Stage 2, LOCKED)

> Run on preview/prod URL in fresh incognito. Core path must pass with NO AI key.
> Conventions: `Status: open|approved|in_progress|resolved|rejected|duplicate`. `?demo=1` = reseed + demo chip. Actor = header role toggle (Student/Coordinator/Assignee).

## A. Functional (happy path, no-key default)

- [ ] **F1 Submit valid:** as Student, `/submit` Title+Location+Category+Description → success banner + `View on Board` → new card top of `/board` <2s, status `open`, audit `created`.
- [ ] **F2 Queue renders + persists:** reload `/board` → report persists (localStorage `relayboard:{SEED_ID}:*`) with correct timestamp; count badge +1.
- [ ] **F3 Classify present:** new card shows category + severity chip + P-score + recommended action + confidence (source fallback when no key).
- [ ] **F4 Duplicate badge:** submit near-copy same building (seed pair e.g. BUS 110 projector ×2) → second card shows `×2 dupes` + detail DuplicatePanel `Possible duplicate of #XXXX (≥50%)`.
- [ ] **F5 Approve gate:** as Coordinator, Approve on `open` → `approved`, button disables, audit `approved` +1 with actor+timestamp.
- [ ] **F6 Execute:** as Assignee, `approved→in_progress→resolved` via stepper → moves to Resolved filter, audit each step.
- [ ] **F7 Reject:** Reject on `open` with reason → `rejected`, audit `rejected`, no further transitions.
- [ ] **F8 Mark/Not-duplicate:** Mark duplicate → status `duplicate` + `duplicateOfId` set + audit; Not-duplicate clears candidate, stays `open`.
- [ ] **F9 Audit complete:** detail Timeline lists every create/classify/approve/status/dedup with actor + old→new + ISO timestamp; append-only (no edit/delete control exists).
- [ ] **F10 Export:** Export CSV → downloads `id,short,title,location,category,severity,priority_score,status,confidence,created_at`; row count = visible count.
- [ ] **F11 Role gates:** Student cannot Approve (button hidden/disabled + direct POST without approver → 403); Assignee cannot Reject; verify 3 click-tests.
- [ ] **F12 Reset/demo:** open `<prod>?demo=1` → 10 seeds load, prior local state cleared, `Demo data` chip visible; re-run F1–F10 passes.
- [ ] **F13 Cold perf:** incognito cold load <3s broadband, <6s Fast-3G; queue interactive <1s after paint.
- [ ] **F14 Build clean:** `npm run build` green; runtime console zero uncaught errors on F1–F10 path.

## B. Edge cases

| # | Case | Input / setup | Expected |
|---|---|---|---|
| E1 | Empty/whitespace | Title `""`, Location unpicked, Description `"   "` | Inline field errors, no insert, focus to first offender, submit stays enabled |
| E2 | Oversize 5000ch | Description `"x"*5000` | Counter blocks or truncates at 2000 word-boundary + `[TRUNCATED]`; no 413 crash; card clamps with expand |
| E3 | XSS | `<script>alert(1)</script><img src=x onerror=alert(2)>` | Rendered as plain text, no alert; stored escaped; verify via DOM inspect |
| E4 | Double submit | Same location+title twice <30s | Second shows duplicate warning but allows submit (no silent drop/crash) |
| E5 | Bogus ID | `/request/NOPE` | `Request not found` + back button, no console throw |
| E6 | Double-click Approve | Rapid double-click | Exactly 1 transition + 1 audit entry (idempotent, button disables after first) |
| E7 | Low confidence | Stub returns conf 0.21 / disconnect key | `Low confidence — needs human review`, stays `open`, no auto-action |
| E8 | Slow AI >10s | Delay `/api/classify` 10s (or throttle) | `Took too long — continue manually` + fallback card; queue actions unaffected |
| E9 | API 429/timeout | 429 twice then 8s delay | Retry state → `AI unavailable — manual mode` ≤10s; never blocks approve/resolve |
| E10 | Offline submit | DevTools Offline → submit → Online | `You're offline — saved locally` → appears, no duplicate on reconnect |
| E11 | Storage full | Fill localStorage quota → submit | Error toast + in-memory fallback + banner; export still works from memory |
| E12 | Invalid transition | POST `open→resolved` skipping approve | 400/403 + no state change + no audit entry |

## C. Accessibility (each ~2 min)

- [ ] **A11y-1 Keyboard-only:** Tab-only submit→approve→resolve→export, no mouse. All reachable, `:focus-visible` ring on every control, no traps, Esc closes dialog returning focus.
- [ ] **A11y-2 Order:** Tab order = visual order (nav → form → submit → filter → cards → export). Assert via manual tab + `document.querySelector('[aria-live]')` exists.
- [ ] **A11y-3 Announcements:** Approve/Resolve updates `aria-live="polite"` (`Report #X approved`); verify with NVDA/VoiceOver or DOM text change.
- [ ] **A11y-4 Labels+contrast:** every input `<label>`d, buttons named; Lighthouse a11y ≥90; body contrast ≥4.5:1, large ≥3:1.
- [ ] **A11y-5 Reduced motion:** `prefers-reduced-motion: reduce` (or DevTools emulate) → no spinner/carousel animation; status still announces.
- [ ] **A11y-6 Touch:** 390px viewport, targets ≥44×44px spaced ≥8px, no horizontal scroll.

## D. AI-offline contract

- [ ] **AI-1 No-key banner:** no `AI_API_KEY` → banner `AI features OFF — manual triage mode` (or `Running offline rules`); F1–F10 still pass; no blocking 401/500.
- [ ] **AI-2 Never unvalidated:** UI receives only `validated:true` envelope; raw LLM JSON never rendered (verify via Network tab payloads).
- [ ] **AI-3 Human gate:** AI suggestion renders as `Suggested:` text only; status never changes without click (even P0).
- [ ] **AI-4 Repair cap:** force schema violation (test hook) → ≤2 LLM calls total, then fallback + `needs_human:true`.
- [ ] **AI-5 Key hygiene:** `grep -ri API_KEY` client bundle empty; key only in `app/api/classify/route.ts` via server config; `.env*` gitignored.
- [ ] **AI-6 Goldens (with key, or stub):** 6 cases — dorm wifi P1 / BUS projector P1 / CHEM spark P0 / Eng overflow P1 / CS DHCP→wifi P1 / LIB chair P3 — category ≥5/6, severity ≥5/6; dup probe marks `mark_duplicate`; `help my thing broken` → other/P3/request_more_info/<0.6.
- [ ] **AI-7 Fallback examples:** Sci 204 projector → classroom_equip/P1/70/0.75; Library drip → water/P2/64/0.75; sparking outlet+smoke → electrical/P0/100/escalate/0.75+needs_human.

## E. Adaptation (unknown cards — capability proofs, not guesses)

- [ ] **AD-1 AI→rule flip:** set `AI_MODE=rule` → full F1–F10 passes; banner correct; latency <1s.
- [ ] **AD-2 Simple mode:** `SIMPLE_MODE=true` → photo/priority-override hidden, single column, large targets; flow intact.
- [ ] **AD-3 Confirm gate:** `REQUIRE_CONFIRM=true` → Resolve/Delete needs inline confirm; audit notes confirmation.
- [ ] **AD-4 Lang toggle:** `?lang=hi` (stub keys) renders without layout break (flex, no fixed widths); missing keys fall back to `en` visibly.
- [ ] **AD-5 Seed swap:** copy `seed.json` → new `SEED_ID` + labels + 3 demo issues → `?seed=<new>` isolates storage, filters still work, <60 min.
- [ ] **AD-6 Export/roles/privacy:** one-click CSV; `?role=` filters actions; list masks reporter contact, detail behind confirm; state "no PII leaves device".
- [ ] **AD-7 Removal survival:** hide photo + one category via flag → submit→resolve still passes; hidden feature shows as "intentionally hidden by flag", no code deletion.

## F. Pre-demo verification (5 min, prod, incognito, Fast-3G)

```text
0:00 open <prod>?demo=1 → 10 seeds <6s, zero console errors, Demo chip + AI-off banner correct.
1:00 Network tab: no blocking /api/ai failures.
1:30 submit "Library / Leak near desk / water" → open → Approve (+1 audit) → Resolve (+1) → Export CSV count matches.
3:00 XSS string renders as text; double-click Approve → single audit; Tab/Esc check one card.
4:00 Offline → submit → friendly message → Online → no duplicate. Unthrottle, screenshot queue+audit.
4:30 GO (all green, rollback target starred) or NO-GO → promote previous green Vercel deployment, re-run 1:30 only.
```
