# RelayBoard — Campus Fix

Student-reported campus maintenance issues, triaged into master incidents
with deterministic, explainable matching and human approval gates.

- Paste a noisy report → rule-based classification (no AI calls) → incident
  queue (one card per failure, not per complaint) → coordinator review →
  audit timeline → CSV export.
- Stack: Next.js 14.2.35, React 18.3.1, TypeScript, Tailwind. No database,
  no auth provider, no vector store: localStorage-first demo, mock roles.

## Run locally

```sh
npm ci
npm run typecheck   # tsc --noEmit, expect exit 0
npm run build       # expect 18/18 static pages
npm run start -- -H 127.0.0.1 -p 3114
```

Open `http://127.0.0.1:3114/board?demo=1&seed=challenge-wifi-1` for the
challenge demo pack (9 reports, 6 incidents), or `/board?demo=1` for the
canonical 10-seed dataset.

## Verification status (Phase 4 Final Forge, 2026-10-11, master `bc2ef03`)

- `npm run typecheck`: exit 0. `npm run build`: exit 0, 18/18 pages.
- Suites (all exit 0): seeds `seeds=10 hash=a21ee8d7`; scorer 90/90;
  workflow 68/68; csv 21/21; config 76/76; duplicates 49/49;
  incidents 124/124 — 428 asserts total, none lowered.
- Browser E2E (Firefox 157 + Playwright, real clicks, desktop 1280px +
  mobile 360px): submission, clustering (auto 1.00 / review 0.57 measured),
  incident detail with originals, reclassify, approve→progress→resolve
  (confirm arming observed), student verify-fixed, still-broken reopen,
  seeded demo, CSV download (exact header, quoting, formula guard),
  required-field validation, optional category. 19/19 checks green,
  zero console errors. Screen-reader run not performed.
- Security: Next.js 14.2.35 (latest 14.x); Oct-14-2026 upstream security
  update still unpublished at last check — re-check before any production
  claim. Local demo only; mock roles are not authentication.

## Real-world feedback

Genuine owner-supplied WhatsApp feedback ("make it more easy to use and
enhance the ui", 11 Oct 2026) drove usability work on the report form,
merged into master via PR #1 (commit ea287aa55a2df5ac535f135c9bd6ddf5701cb4e9):
required-field markers, hints, optional category, friendly errors,
44–48px targets. Verified on the usability branch before merge
(typecheck/build/suites green, desktop+mobile browser-verified 12/12) —
distinct from the Phase 4 verification below, which ran on the earlier
master baseline. See `feedback/README.md`, available on master.

## Submission instructions (Grevix AfterCode)

1. Record a ≤3-minute demo video (local run above; backup recording
   pattern in project QA notes) + take screenshots of board, incident
   detail, and submit flow.
2. Push the frozen `master` HEAD to GitHub and note the exact commit SHA.
3. Submit via the official Unstop event page
   (`https://unstop.com/hackathons/grevix-aftercode-grevix-1755080`)
   with: repo link + commit SHA, demo video, 2–3 screenshots, and a
   one-paragraph description (problem → incident-centered triage with
   graded-evidence matching → human gates; pilot hypothesis, demo data).
4. Do NOT submit real student complaints or personal data; use only the
   seeded `?demo=1` datasets. Do NOT claim production readiness,
   screen-reader testing, or Chrome parity.
