# RelayBoard — Campus Fix: DEMO PLAN (3 minutes, LOCKED)

> Goal: one magic moment <60s in (messy report → ranked queue → approved action). Everything clickable live; nothing claimed without click. Primary path runs with NO AI key (fallback). Backup covers every failure.

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

Pre-seed via `?demo=1`. Open on #1. Submit #3 live. Keep #10 for Q&A honesty (low conf).

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
