"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  confirmNote,
  loadPersistedPrefs,
  resolveAppConfig,
  seedHref,
  t,
  type Lang,
  type PersistedPrefs,
} from "../../../lib/config";
import { suggestDuplicates } from "../../../lib/duplicates";
import { matchReportToIncidents } from "../../../lib/clustering";
import {
  canTransition,
  incidentStatusLabel,
  validateEvent,
  validateIncidentEvent,
  CATEGORIES,
  DEPARTMENTS,
  type Category,
  type Department,
  type Event,
  type IncidentEvent,
  type Item,
  type MasterIncident,
  type Role,
  type Status,
} from "../../../lib/schema";
import {
  attachReportToIncident,
  ensureSeeded,
  getIncident,
  getItem,
  listEvents,
  listIncidentEvents,
  listIncidents,
  listItems,
  mergeIncidents,
  readVerifyVote,
  reassignIncident,
  reclassifyIncident,
  resolveIncident,
  setActiveSeedId,
  transitionIncident,
  transitionItem,
  verifyIncident,
} from "../../../lib/store";

const SEVERITY_CHIP: Record<Item["severity"], string> = {
  P0: "bg-red-600 text-white",
  P1: "bg-orange-500 text-white",
  P2: "bg-amber-200 text-amber-900",
  P3: "bg-zinc-200 text-zinc-700",
};

function confidenceBand(confidence: number): string {
  if (confidence >= 0.8) return "High";
  if (confidence >= 0.5) return "Medium";
  return "Low";
}

function needsHuman(item: Item): boolean {
  return (
    item.confidence < 0.6 ||
    item.severity === "P0" ||
    item.recommended_action === "escalate_safety" ||
    item.recommended_action === "request_more_info" ||
    item.recommended_action === "mark_duplicate"
  );
}

function eventLabel(e: Event): string {
  if (e.type === "created") return "Created";
  if (e.type === "classified") return "Classified";
  if (e.type === "approved") return "Approved";
  if (e.type === "rejected") return "Rejected";
  if (e.type === "marked_duplicate") return "Marked duplicate";
  return "Status changed";
}

function incidentEventLabel(e: IncidentEvent): string {
  if (e.type === "incident_created") return "Incident opened";
  if (e.type === "report_attached") return "Report attached";
  if (e.type === "incident_merged") return "Incident merged";
  if (e.type === "reclassified") return "Reclassified";
  if (e.type === "reassigned") return "Reassigned";
  if (e.type === "verified") return "Verified";
  if (e.type === "approved") return "Approved";
  if (e.type === "rejected") return "Rejected";
  if (e.type === "marked_duplicate") return "Marked duplicate";
  if (e.type === "created") return "Created";
  if (e.type === "classified") return "Classified";
  return "Status changed";
}

function verificationLabel(
  v: MasterIncident["verification"],
): string {
  if (v.state === "confirmed_fixed") {
    return `Fixed — confirmed by ${v.by ?? "unknown"}${v.at ? ` at ${v.at}` : ""}`;
  }
  if (v.state === "still_broken") {
    return `Still broken — reported by ${v.by ?? "unknown"}${v.at ? ` at ${v.at}` : ""}`;
  }
  return "Unverified";
}

// Dismissed candidate pairs (reportId>incidentId) live in localStorage so a
// coordinator's Dismiss survives refresh without touching audit history.
function dismissedKey(seedId: string): string {
  return `relayboard:${seedId}:dismissed`;
}

function loadDismissed(seedId: string): string[] {
  try {
    if (typeof window === "undefined") return [];
    const raw = window.localStorage.getItem(dismissedKey(seedId));
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === "string")
      : [];
  } catch {
    return [];
  }
}

function saveDismissed(seedId: string, pair: string): void {
  try {
    if (typeof window === "undefined") return;
    const cur = loadDismissed(seedId);
    if (!cur.includes(pair)) {
      window.localStorage.setItem(
        dismissedKey(seedId),
        JSON.stringify([...cur, pair]),
      );
    }
  } catch {
    // Dismiss is display-only; storage failure must never block review.
  }
}

// Membership banner on report pages: resolves the containing incident via
// the backfilled pointer, falling back to a membership scan (lazy-derived
// incidents have no backfill yet).
function IncidentBanner({
  itemId,
  incidentId,
  seedId,
}: {
  itemId: string;
  incidentId: string | null;
  seedId: string;
}) {
  const [target, setTarget] = useState<string | null>(null);
  useEffect(() => {
    try {
      if (incidentId !== null && getIncident(incidentId) !== null) {
        setTarget(incidentId);
        return;
      }
      const found = listIncidents().find((i) =>
        i.attachedReportIds.includes(itemId),
      );
      setTarget(found !== undefined ? resolveIncident(found.id)?.id ?? null : null);
    } catch {
      setTarget(null);
    }
  }, [itemId, incidentId]);
  if (target === null) return null;
  return (
    <p className="rounded-lg border border-sky-300 bg-sky-50 p-3 text-sm text-sky-900">
      Part of incident{" "}
      <Link
        href={seedHref(`/request/${target}`, seedId)}
        className="font-mono underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
      >
        {target}
      </Link>
      .
    </p>
  );
}

// Challenge-1 incident detail (stored MasterIncident, not a derived view).
// Self-contained: own role/query/prefs loading (same P4-A pattern), own
// refresh. Report pages (/request/RPT-xx) keep the legacy view below.
function IncidentView({ id }: { id: string }) {
  const [mounted, setMounted] = useState(false);
  const [role, setRole] = useState<Role>("coordinator");
  const [prefs, setPrefs] = useState<PersistedPrefs>({});
  const [query, setQuery] = useState<Record<string, string | undefined>>({});
  const [seedId, setSeedId] = useState("campus-maint-v1");
  const [incident, setIncident] = useState<MasterIncident | null | undefined>(
    undefined,
  );
  const [members, setMembers] = useState<Item[]>([]);
  const [events, setEvents] = useState<IncidentEvent[]>([]);
  const [others, setOthers] = useState<MasterIncident[]>([]);
  const [note, setNote] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [mergeTarget, setMergeTarget] = useState("");
  const [reclassCategory, setReclassCategory] = useState<Category | "">("");
  const [reclassDept, setReclassDept] = useState<Department | "">("");
  const [processing, setProcessing] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null,
  );
  const [armed, setArmed] = useState<string | null>(null);
  const [dismissedTick, setDismissedTick] = useState(0);

  const lang: Lang = resolveAppConfig(query, prefs).lang;
  const confirm = resolveAppConfig(query, prefs).confirm;
  // SIMPLE_MODE (G1 fix): the candidate SUGGESTIONS section stays hidden;
  // hard links, review actions, timeline and verification always render.
  const simple = resolveAppConfig(query, prefs).simpleMode;

  const refresh = useCallback(() => {
    const found = getIncident(id);
    setIncident(found);
    if (found !== null) {
      const ms: Item[] = [];
      for (const rid of found.attachedReportIds) {
        const it = getItem(rid);
        if (it !== null) ms.push(it);
      }
      setMembers(ms);
    } else {
      setMembers([]);
    }
    const all = listIncidentEvents().filter(
      (e) => validateIncidentEvent(e) && e.incidentId === id,
    );
    all.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || (a.id < b.id ? -1 : 1));
    setEvents(all);
    setOthers(
      listIncidents().filter((i) => i.id !== id && i.mergedIntoId === null),
    );
  }, [id]);

  useEffect(() => {
    setMounted(true);
    let sid = "campus-maint-v1";
    try {
      const sp = new URLSearchParams(window.location.search);
      const q: Record<string, string | undefined> = {
        role: sp.get("role") ?? undefined,
        lang: sp.get("lang") ?? undefined,
        simple: sp.get("simple") ?? undefined,
        demo: sp.get("demo") ?? undefined,
        seed: sp.get("seed") ?? undefined,
      };
      setQuery(q);
      const stored = loadPersistedPrefs();
      setPrefs(stored);
      setRole(resolveAppConfig(q, stored).role);
      sid = resolveAppConfig(q, stored).seedId;
      setSeedId(sid);
      setActiveSeedId(sid);
      // Challenge-1 acceptance: deep links must seed the pack namespace so
      // incident detail resolves without a prior board visit.
      ensureSeeded();
    } catch {
      // Defaults stand.
    }
    refresh();
  }, [id, refresh]);

  const candidates = useMemo(() => {
    if (incident === null || incident === undefined) return [];
    if (incident.mergedIntoId !== null) return [];
    const dismissed = loadDismissed(seedId);
    const out: Array<{
      reportId: string;
      title: string;
      score: number;
      reasons: string[];
    }> = [];
    try {
      const byId = new Map(listItems().map((i) => [i.id, i]));
      for (const o of others) {
        if (o.attachedReportIds.length !== 1) continue;
        const sole = byId.get(o.attachedReportIds[0]);
        if (sole === undefined) continue;
        const cands = matchReportToIncidents(sole, [incident], byId, 1);
        if (cands.length === 0 || cands[0].band !== "review") continue;
        if (dismissed.includes(`${sole.id}>${incident.id}`)) continue;
        out.push({
          reportId: sole.id,
          title: sole.title,
          score: cands[0].score,
          reasons: cands[0].reasons,
        });
      }
    } catch {
      return [];
    }
    out.sort((a, b) => b.score - a.score);
    return out.slice(0, 3);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incident?.id, incident?.updatedAt, others.length, dismissedTick, mounted]);

  const myVote = useMemo(() => {
    if (!mounted || incident === null || incident === undefined) return null;
    try {
      return readVerifyVote(incident.id);
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, incident?.id, incident?.verification, events.length]);

  if (!mounted || incident === undefined) {
    return (
      <section aria-labelledby="request-title" className="space-y-3">
        <p className="font-mono text-xs text-zinc-500">{id}</p>
        <h1 id="request-title" className="text-2xl font-semibold">
          Loading…
        </h1>
        <div className="animate-pulse rounded-lg border border-zinc-200 bg-white p-4">
          <div className="h-4 w-2/3 rounded bg-zinc-100" />
          <div className="mt-2 h-3 w-1/3 rounded bg-zinc-100" />
        </div>
      </section>
    );
  }

  if (incident === null) {
    return (
      <section aria-labelledby="request-title" className="space-y-3">
        <h1 id="request-title" className="text-2xl font-semibold">
          Request not found
        </h1>
        <p className="text-sm text-zinc-500">
          No incident exists with ID {id}.
        </p>
        <Link
          href={seedHref("/board", seedId)}
          className="inline-block min-h-[44px] rounded bg-zinc-900 px-3 py-2 text-sm leading-[28px] text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
        >
          Back to Board
        </Link>
      </section>
    );
  }

  const busy = processing !== null;
  const merged = incident.mergedIntoId !== null;
  const maxScore = members.reduce((n, m) => Math.max(n, m.priority_score), 0);

  function run(label: string, fn: () => { ok: boolean; error?: string; text: string }) {
    setProcessing(label);
    setBanner(null);
    setArmed(null);
    setReasonError(null);
    window.setTimeout(() => {
      const res = fn();
      if (res.ok) {
        setBanner({ kind: "ok", text: res.text });
        setNote("");
      } else {
        setBanner({ kind: "err", text: res.error ?? "Action failed." });
      }
      refresh();
      setProcessing(null);
    }, 0);
  }

  function needReason(): boolean {
    if (note.trim().length === 0) {
      setReasonError("A reason is required.");
      return false;
    }
    return true;
  }

  function doStatus(to: Status, confirmed = false) {
    if (incident === null || incident === undefined) return;
    const incId = incident.id;
    run(to, () => {
      const rawNote = note.trim();
      const finalNote = confirmed
        ? confirmNote(note)
        : rawNote.length > 0
          ? rawNote
          : undefined;
      const res = transitionIncident(incId, to, role, finalNote);
      return res.ok
        ? { ok: true, text: `Incident ${incId} → ${incidentStatusLabel(to)}.` }
        : { ok: false, error: res.error, text: "" };
    });
  }

  const canApprove = incident.status === "open" && role === "coordinator";
  const canProgress =
    incident.status === "approved" &&
    (role === "coordinator" || role === "assignee");
  const canResolve =
    incident.status === "in_progress" &&
    (role === "coordinator" || role === "assignee");
  const canReopen = incident.status === "resolved";
  const canReject =
    (incident.status === "open" ||
      incident.status === "approved" ||
      incident.status === "in_progress") &&
    role === "coordinator";
  const coordOnly = role === "coordinator" && !merged;

  return (
    <section aria-labelledby="request-title" className="space-y-4">
      <div>
        <label htmlFor="detail-role" className="mb-1 block text-sm font-medium">
          {t("roleLabel", lang)}
        </label>
        <select
          id="detail-role"
          value={role}
          onChange={(e) => {
            setRole(e.target.value as Role);
            setArmed(null);
          }}
          className="min-h-[44px] w-full max-w-xs rounded border border-zinc-200 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
        >
          <option value="student">Student</option>
          <option value="coordinator">Coordinator</option>
          <option value="assignee">Assignee</option>
        </select>
      </div>

      <div>
        <p className="font-mono text-xs text-zinc-500">
          {incident.id} &middot; incident
        </p>
        <h1 id="request-title" className="break-words text-2xl font-semibold">
          {incident.title}
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span
            className={`rounded px-2 py-0.5 text-xs font-semibold ${SEVERITY_CHIP[incident.severity]}`}
          >
            {incident.severity}
          </span>
          <span className="font-mono text-xs text-zinc-700">P{maxScore}</span>
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700">
            {incidentStatusLabel(incident.status)}
          </span>
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700">
            {incident.department}
          </span>
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700">
            {verificationLabel(incident.verification)}
          </span>
          <span
            className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-900"
          >
            &times;{members.length} report{members.length === 1 ? "" : "s"}
          </span>
        </div>
        <p className="mt-1 break-words text-xs text-zinc-500">
          {incident.locationLabel} &middot; {incident.category}
        </p>
      </div>

      {merged && (
        <p role="status" className="rounded-lg border border-zinc-300 bg-zinc-100 p-3 text-sm">
          Merged into{" "}
          <Link
            href={seedHref(`/request/${incident.mergedIntoId}`, seedId)}
            className="font-mono underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
          >
            {incident.mergedIntoId}
          </Link>
          . This incident is kept for history; actions now happen there.
        </p>
      )}

      <div className="rounded-lg border border-zinc-200 bg-white p-4">
        <h2 className="text-sm font-semibold">
          Attached reports ({members.length})
        </h2>
        {members.length === 0 ? (
          <p className="mt-1 text-sm text-zinc-500">No reports attached.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {members.map((m) => (
              <li
                key={m.id}
                className="flex flex-col gap-1 rounded border border-zinc-200 p-2 text-sm sm:flex-row sm:items-center"
              >
                <span className="min-w-0 flex-1 break-words">
                  <Link
                    href={seedHref(`/request/${m.id}`, seedId)}
                    className="font-mono underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
                  >
                    {m.id}
                  </Link>{" "}
                  — {m.title}
                  <span className="block text-xs text-zinc-500">
                    {m.location} &middot; reported as {m.category}
                    {m.category !== incident.category && (
                      <> &rarr; grouped under {incident.category}</>
                    )}{" "}
                    &middot; {m.status}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {!merged && !simple && (
        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <h2 className="text-sm font-semibold">Candidate review</h2>
          {candidates.length === 0 ? (
            <p className="mt-1 text-sm text-zinc-500">
              No uncertain matches pending for this incident.
            </p>
          ) : (
            <ul className="mt-2 space-y-2">
              {candidates.map((c) => (
                <li
                  key={c.reportId}
                  className="flex flex-col gap-2 rounded border border-zinc-200 p-2 text-sm sm:flex-row sm:items-center"
                >
                  <span className="min-w-0 flex-1 break-words">
                    <span className="font-mono">{c.reportId}</span> — {c.title}{" "}
                    <span className="text-zinc-500">
                      (similarity {Math.round(c.score * 100)}%)
                    </span>
                    <span className="block text-xs text-zinc-500">
                      {c.reasons.join(" · ")}
                    </span>
                  </span>
                  <span className="flex shrink-0 gap-2">
                    <Link
                      href={seedHref(`/request/${c.reportId}`, seedId)}
                      className="inline-block min-h-[44px] rounded border border-zinc-200 px-3 py-2 leading-[28px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
                    >
                      View
                    </Link>
                    {role === "coordinator" && (
                      <>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            run(`attach-${c.reportId}`, () => {
                              const res = attachReportToIncident(
                                c.reportId,
                                incident.id,
                                role,
                                note.trim().length > 0 ? note.trim() : "accepted candidate",
                              );
                              return res.ok
                                ? {
                                    ok: true,
                                    text: `Report ${c.reportId} attached to ${incident.id}.`,
                                  }
                                : { ok: false, error: res.error, text: "" };
                            })
                          }
                          className="min-h-[44px] rounded border border-zinc-300 px-3 py-2 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
                        >
                          Attach
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            saveDismissed(seedId, `${c.reportId}>${incident.id}`);
                            setDismissedTick((n) => n + 1);
                          }}
                          className="min-h-[44px] rounded border border-zinc-200 px-3 py-2 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
                        >
                          Dismiss
                        </button>
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {!merged && (
        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <h2 className="text-sm font-semibold">Review actions</h2>
          <div className="mt-2">
            <label htmlFor="action-note" className="mb-1 block text-sm font-medium">
              Reason (required for merge, reclassify, reassign)
            </label>
            <input
              id="action-note"
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Decision reason…"
              className="min-h-[44px] w-full rounded border border-zinc-200 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
            />
            {reasonError !== null && (
              <p role="alert" className="mt-1 text-sm text-red-700">
                {reasonError}
              </p>
            )}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || !canApprove}
              onClick={() => doStatus("approved")}
              className="min-h-[44px] rounded bg-zinc-900 px-3 py-2 text-sm text-white disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
            >
              Approve
            </button>
            <button
              type="button"
              disabled={busy || !canProgress}
              onClick={() => doStatus("in_progress")}
              className="min-h-[44px] rounded border border-zinc-300 px-3 py-2 text-sm disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
            >
              Start progress
            </button>
            <button
              type="button"
              disabled={busy || !canResolve}
              onClick={() => {
                if (confirm && armed !== "resolved") {
                  setArmed("resolved");
                  return;
                }
                doStatus("resolved", confirm);
              }}
              className="min-h-[44px] rounded border border-zinc-300 px-3 py-2 text-sm disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
            >
              {armed === "resolved" && confirm ? "Click again to confirm" : "Resolve"}
            </button>
            <button
              type="button"
              disabled={busy || !canReopen}
              onClick={() => doStatus("in_progress")}
              className="min-h-[44px] rounded border border-zinc-300 px-3 py-2 text-sm disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
            >
              Reopen
            </button>
            <button
              type="button"
              disabled={busy || !canReject}
              onClick={() => {
                if (confirm && armed !== "rejected") {
                  setArmed("rejected");
                  return;
                }
                doStatus("rejected", confirm);
              }}
              className="min-h-[44px] rounded border border-zinc-300 px-3 py-2 text-sm disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
            >
              {armed === "rejected" && confirm ? "Click again to confirm" : "Reject"}
            </button>
          </div>
          {role === "student" && (
            <p className="mt-2 text-xs text-zinc-500">
              Students can verify a fix or reopen a resolved incident, but
              cannot approve or resolve.
            </p>
          )}
          <div className="mt-3 grid gap-2 border-t border-zinc-100 pt-3">
            <div className="flex flex-col gap-2 sm:flex-row">
              <select
                aria-label="Merge source incident"
                value={mergeTarget}
                onChange={(e) => setMergeTarget(e.target.value)}
                disabled={busy || !coordOnly}
                className="min-h-[44px] w-full rounded border border-zinc-200 bg-white px-3 py-2 font-mono text-sm disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
              >
                <option value="">Merge into this…</option>
                {others.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.id} — {o.title.slice(0, 40)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={busy || !coordOnly || mergeTarget === ""}
                onClick={() => {
                  if (!needReason()) return;
                  const src = mergeTarget;
                  run("merge", () => {
                    const res = mergeIncidents(src, incident.id, role, note.trim());
                    return res.ok
                      ? { ok: true, text: `Merged ${src} into ${incident.id}.` }
                      : { ok: false, error: res.error, text: "" };
                  });
                }}
                className="min-h-[44px] shrink-0 rounded border border-zinc-300 px-3 py-2 text-sm disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
              >
                Merge
              </button>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <select
                aria-label="New category"
                value={reclassCategory}
                onChange={(e) => setReclassCategory(e.target.value as Category | "")}
                disabled={busy || !coordOnly}
                className="min-h-[44px] w-full rounded border border-zinc-200 bg-white px-3 py-2 text-sm disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
              >
                <option value="">Reclassify…</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={busy || !coordOnly || reclassCategory === ""}
                onClick={() => {
                  if (!needReason()) return;
                  const next = reclassCategory;
                  if (next === "") return;
                  run("reclassify", () => {
                    const res = reclassifyIncident(incident.id, next, role, note.trim());
                    return res.ok
                      ? { ok: true, text: `Category → ${next}.` }
                      : { ok: false, error: res.error, text: "" };
                  });
                }}
                className="min-h-[44px] shrink-0 rounded border border-zinc-300 px-3 py-2 text-sm disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
              >
                Save category
              </button>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <select
                aria-label="New department"
                value={reclassDept}
                onChange={(e) => setReclassDept(e.target.value as Department | "")}
                disabled={busy || !coordOnly}
                className="min-h-[44px] w-full rounded border border-zinc-200 bg-white px-3 py-2 text-sm disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
              >
                <option value="">Reassign department…</option>
                {DEPARTMENTS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={busy || !coordOnly || reclassDept === ""}
                onClick={() => {
                  if (!needReason()) return;
                  const next = reclassDept;
                  if (next === "") return;
                  run("reassign", () => {
                    const res = reassignIncident(incident.id, next, role, note.trim());
                    return res.ok
                      ? { ok: true, text: `Department → ${next}.` }
                      : { ok: false, error: res.error, text: "" };
                  });
                }}
                className="min-h-[44px] shrink-0 rounded border border-zinc-300 px-3 py-2 text-sm disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
              >
                Save department
              </button>
            </div>
          </div>
          <div aria-live="polite" className="mt-2">
            {banner !== null && (
              <p
                role={banner.kind === "err" ? "alert" : "status"}
                className={
                  banner.kind === "ok"
                    ? "rounded bg-green-50 p-2 text-sm text-green-900"
                    : "rounded bg-red-50 p-2 text-sm text-red-900"
                }
              >
                {banner.text}
              </p>
            )}
          </div>
        </div>
      )}

      {!merged && (
        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <h2 className="text-sm font-semibold">Verification</h2>
          <p className="mt-1 text-sm" aria-live="polite">
            {verificationLabel(incident.verification)}
          </p>
          {myVote !== null && (
            <p className="mt-1 text-xs text-zinc-500">
              Your last vote here: {myVote.fixed ? "Fixed" : "Still broken"} by{" "}
              {myVote.by}.
            </p>
          )}
          {incident.status !== "resolved" && (
            <p className="mt-1 text-xs text-zinc-500">
              Verification opens once the incident is resolved
              {incident.verification.state === "still_broken" &&
                " — a broken vote reopened it; fix, resolve, then verify again"}
              .
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || incident.status !== "resolved"}
              onClick={() =>
                run("verify-fixed", () => {
                  const res = verifyIncident(incident.id, true, role);
                  return res.ok
                    ? { ok: true, text: "Marked fixed — thank you." }
                    : { ok: false, error: res.error, text: "" };
                })
              }
              className="min-h-[44px] rounded bg-zinc-900 px-3 py-2 text-sm text-white disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
            >
              &#10003; Fixed
            </button>
            <button
              type="button"
              disabled={busy || incident.status !== "resolved"}
              onClick={() =>
                run("verify-broken", () => {
                  const res = verifyIncident(incident.id, false, role);
                  return res.ok
                    ? {
                        ok: true,
                        text: "Marked still broken — reopened as In Progress.",
                      }
                    : { ok: false, error: res.error, text: "" };
                })
              }
              className="min-h-[44px] rounded border border-zinc-300 px-3 py-2 text-sm disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
            >
              &#10007; Still broken
            </button>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-zinc-200 bg-white p-4">
        <h2 className="text-sm font-semibold">Incident timeline</h2>
        {events.length === 0 ? (
          <p className="mt-1 text-sm text-zinc-500">
            History starts with your first action — attached reports carry
            their own timelines (open them above).
          </p>
        ) : (
          <ol className="mt-2 space-y-2">
            {events.map((e) => (
              <li key={e.id} className="break-words text-sm">
                <span className="font-medium">{incidentEventLabel(e)}</span>{" "}
                <span className="text-zinc-500">
                  {e.from ?? "—"} → {e.to}
                </span>{" "}
                <span className="text-xs text-zinc-500">
                  by {e.actor} at {e.at}
                </span>
                {e.reportId !== null && (
                  <span className="block break-words font-mono text-xs text-zinc-600">
                    {e.reportId}
                  </span>
                )}
                {typeof e.note === "string" && e.note.length > 0 && (
                  <span className="block break-words text-xs text-zinc-600">
                    Note: {e.note}
                  </span>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>

      <Link
        href={seedHref("/board", seedId)}
        className="inline-block min-h-[44px] rounded border border-zinc-200 px-3 py-2 text-sm leading-[28px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
      >
        Back to Board
      </Link>
    </section>
  );
}

export default function DetailClient({ id }: { id: string }) {
  const [mounted, setMounted] = useState(false);
  const [role, setRole] = useState<Role>("coordinator");
  // P4-A: defaults render pre-mount (no hydration mismatch); query + persisted
  // prefs apply in the mount effect. window.location is read in useEffect
  // (not useSearchParams) so this route needs no Suspense boundary.
  const [prefs, setPrefs] = useState<PersistedPrefs>({});
  const [query, setQuery] = useState<Record<string, string | undefined>>({});
  const [item, setItem] = useState<Item | null | undefined>(undefined);
  const [events, setEvents] = useState<Event[]>([]);
  const [note, setNote] = useState("");
  const [dupTarget, setDupTarget] = useState("");
  const [processing, setProcessing] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  // AD-3 confirm gate: arming key for terminal actions (Resolve/Reject)
  // when cfg.confirm is on. First click arms, second executes.
  const [armed, setArmed] = useState<string | null>(null);

  const lang: Lang = resolveAppConfig(query, prefs).lang;
  // P4-A SIMPLE_MODE on this screen: hide the duplicate SUGGESTIONS section;
  // the hard-link panel ("Linked duplicate") always stays.
  const simple = resolveAppConfig(query, prefs).simpleMode;
  const confirm = resolveAppConfig(query, prefs).confirm;
  // Challenge-1 acceptance: link namespace for Back-to-Board + report links.
  const seedId = resolveAppConfig(query, prefs).seedId;

  useEffect(() => {
    setMounted(true);
    try {
      const sp = new URLSearchParams(window.location.search);
      const q: Record<string, string | undefined> = {
        role: sp.get("role") ?? undefined,
        lang: sp.get("lang") ?? undefined,
        simple: sp.get("simple") ?? undefined,
        demo: sp.get("demo") ?? undefined,
        seed: sp.get("seed") ?? undefined,
      };
      setQuery(q);
      const stored = loadPersistedPrefs();
      setPrefs(stored);
      setRole(resolveAppConfig(q, stored).role);
      setActiveSeedId(resolveAppConfig(q, stored).seedId);
      // Challenge-1 acceptance: deep links must seed the pack namespace so
      // incident/report detail resolves without a prior board visit.
      ensureSeeded();
    } catch {
      // URL/storage unreadable: defaults stand.
    }
    const found = getItem(id);
    setItem(found);
    const all = listEvents().filter(
      (e) => validateEvent(e) && e.itemId === id,
    );
    all.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    setEvents(all);
  }, [id]);

  const refresh = useCallback(() => {
    const found = getItem(id);
    setItem(found);
    const all = listEvents().filter(
      (e) => validateEvent(e) && e.itemId === id,
    );
    all.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    setEvents(all);
  }, [id]);

  const dupTargetItem: Item | null = useMemo(() => {
    if (item === null || item === undefined) return null;
    if (item.duplicateOfId === null) return null;
    return getItem(item.duplicateOfId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.duplicateOfId, item?.id, mounted]);

  // P4-B suggestions: same-location word-overlap candidates (pure display;
  // any link still requires an explicit coordinator Mark click). Recomputed
  // when the item or its event count changes (mark/unmark refresh both).
  const suggestions = useMemo(() => {
    if (item === null || item === undefined) return [];
    try {
      return suggestDuplicates(item, listItems(), 3);
    } catch {
      return [];
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, item?.status, item?.duplicateOfId, events.length, mounted]);

  const suggestionTitles = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of suggestions) {
      try {
        const target = getItem(s.id);
        if (target !== null) map.set(s.id, target.title);
      } catch {
        // Leave title unresolved; id still renders.
      }
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestions]);

  if (!mounted || item === undefined) {
    return (
      <section aria-labelledby="request-title" className="space-y-3">
        <p className="font-mono text-xs text-zinc-500">{id}</p>
        <h1 id="request-title" className="text-2xl font-semibold">
          Loading…
        </h1>
        <div className="animate-pulse rounded-lg border border-zinc-200 bg-white p-4">
          <div className="h-4 w-2/3 rounded bg-zinc-100" />
          <div className="mt-2 h-3 w-1/3 rounded bg-zinc-100" />
        </div>
      </section>
    );
  }

  // Challenge-1: incident pages render the stored-incident view; report
  // pages (/request/RPT-xx) keep the legacy review UI below (with an
  // incident-membership banner).
  if (id.startsWith("INC-")) {
    return <IncidentView id={id} />;
  }

  if (item === null) {
    return (
      <section aria-labelledby="request-title" className="space-y-3">
        <h1 id="request-title" className="text-2xl font-semibold">
          Request not found
        </h1>
        <p className="text-sm text-zinc-500">
          No report exists with ID {id}.
        </p>
        <Link
          href={seedHref("/board", seedId)}
          className="inline-block min-h-[44px] rounded bg-zinc-900 px-3 py-2 text-sm leading-[28px] text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
        >
          Back to Board
        </Link>
      </section>
    );
  }

  const decided =
    item.status === "resolved" ||
    item.status === "rejected" ||
    item.status === "duplicate";
  const busy = processing !== null;

  function doTransition(to: Status, label: string, extra?: { duplicateOfId?: string }, confirmed = false) {
    if (item === null || item === undefined) return;
    const itemId = item.id;
    setProcessing(label);
    setBanner(null);
    setArmed(null);
    // setTimeout keeps the disabled state paintable on double-click (E6).
    window.setTimeout(() => {
      const rawNote = note.trim();
      const finalNote = confirmed
        ? confirmNote(note)
        : rawNote.length > 0
          ? rawNote
          : undefined;
      const res = transitionItem(
        itemId,
        to,
        role,
        finalNote,
        extra?.duplicateOfId,
      );
      if (res.ok) {
        setBanner({ kind: "ok", text: `Report ${itemId} → ${to}.` });
        setNote("");
        setDupTarget("");
      } else {
        setBanner({ kind: "err", text: res.error });
      }
      refresh();
      setProcessing(null);
    }, 0);
  }

  const stepper: Array<{ to: Status; label: string }> = [
    { to: "in_progress", label: "Start progress" },
    { to: "resolved", label: "Resolve" },
  ];

  return (
    <section aria-labelledby="request-title" className="space-y-4">
      <div>
        <label
          htmlFor="detail-role"
          className="mb-1 block text-sm font-medium"
        >
          {t("roleLabel", lang)}
        </label>
        <select
          id="detail-role"
          value={role}
          onChange={(e) => {
            setRole(e.target.value as Role);
            setArmed(null);
          }}
          className="min-h-[44px] w-full max-w-xs rounded border border-zinc-200 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
        >
          <option value="student">Student</option>
          <option value="coordinator">Coordinator</option>
          <option value="assignee">Assignee</option>
        </select>
      </div>

      <div>
        <p className="font-mono text-xs text-zinc-500">
          {item.id} {item.short}
        </p>
        <h1
          id="request-title"
          className="break-words text-2xl font-semibold"
        >
          {item.title}
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span
            className={`rounded px-2 py-0.5 text-xs font-semibold ${SEVERITY_CHIP[item.severity]}`}
          >
            {item.severity}
          </span>
          <span className="font-mono text-xs text-zinc-700">
            P{item.priority_score}
          </span>
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700">
            {item.status}
          </span>
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700">
            {confidenceBand(item.confidence)} confidence{" "}
            {Math.round(item.confidence * 100)}%
          </span>
        </div>
        <p className="mt-1 break-words text-xs text-zinc-500">
          {item.location} &middot; {item.category}
        </p>
      </div>

      <IncidentBanner itemId={item.id} incidentId={item.incidentId ?? null} seedId={seedId} />

      {needsHuman(item) && (
        <p
          role="status"
          className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
        >
          {item.confidence < 0.6
            ? "Low confidence — needs human review."
            : "Needs human review before action."}{" "}
          Suggested action: {item.recommended_action}. Status changes only on
          click.
        </p>
      )}

      <div className="rounded-lg border border-zinc-200 bg-white p-4">
        <h2 className="text-sm font-semibold">{t("detailDescription", lang)}</h2>
        <p className="mt-1 break-words text-sm">{item.description}</p>
      </div>

      <dl className="grid gap-2 rounded-lg border border-zinc-200 bg-white p-4 text-sm">
        <div className="flex flex-col gap-1 sm:flex-row sm:gap-2">
          <dt className="shrink-0 text-zinc-500 sm:w-40">
            Recommended action
          </dt>
          <dd className="break-words">{item.recommended_action}</dd>
        </div>
        <div className="flex flex-col gap-1 sm:flex-row sm:gap-2">
          <dt className="shrink-0 text-zinc-500 sm:w-40">Confidence</dt>
          <dd>
            {Math.round(item.confidence * 100)}% (
            {confidenceBand(item.confidence)})
          </dd>
        </div>
        <div className="flex flex-col gap-1 sm:flex-row sm:gap-2">
          <dt className="shrink-0 text-zinc-500 sm:w-40">Status</dt>
          <dd>{item.status}</dd>
        </div>
      </dl>

      <div className="space-y-4 rounded-lg border border-zinc-200 bg-white p-4">
        <h2 className="text-sm font-semibold">{t("detailDuplicates", lang)}</h2>
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            {t("detailLinkedDuplicate", lang)}
          </h3>
          {item.duplicateOfId === null ? (
            <p className="mt-1 text-sm text-zinc-500">
              No linked duplicates.
            </p>
          ) : dupTargetItem !== null ? (
            <p className="mt-1 text-sm">
              Possible duplicate of{" "}
              <Link
                href={seedHref(`/request/${dupTargetItem.id}`, seedId)}
                className="underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
              >
                {dupTargetItem.id} — {dupTargetItem.title}
              </Link>
            </p>
          ) : (
            <p className="mt-1 text-sm text-zinc-500">
              Linked duplicate {item.duplicateOfId} not found.
            </p>
          )}
          {item.status === "duplicate" && role === "coordinator" && (
            <button
              type="button"
              disabled={busy}
              onClick={() => doTransition("open", "unmark")}
              className="mt-2 min-h-[44px] rounded border border-zinc-300 px-3 py-2 text-sm disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
            >
              {t("detailNotDuplicate", lang)}
            </button>
          )}
        </div>
        {!simple && (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              {t("detailPossibleDuplicates", lang)}
            </h3>
            {suggestions.length === 0 ? (
              <p className="mt-1 text-sm text-zinc-500">
                No similar reports found.
              </p>
            ) : (
              <ul className="mt-2 space-y-2">
                {suggestions.map((s) => (
                  <li
                    key={s.id}
                    className="flex flex-col gap-2 rounded border border-zinc-200 p-2 text-sm sm:flex-row sm:items-center"
                  >
                    <span className="min-w-0 flex-1 break-words">
                      <span className="font-mono">{s.id}</span>
                      {suggestionTitles.has(s.id) && (
                        <span> — {suggestionTitles.get(s.id)}</span>
                      )}{" "}
                      <span className="text-zinc-500">
                        (similarity {Math.round(s.score * 100)}%)
                      </span>
                    </span>
                    <span className="flex shrink-0 gap-2">
                      <Link
                        href={seedHref(`/request/${s.id}`, seedId)}
                        className="inline-block min-h-[44px] rounded border border-zinc-200 px-3 py-2 leading-[28px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
                      >
                        View
                      </Link>
                      {role === "coordinator" && (
                        <button
                          type="button"
                          disabled={
                            busy || !canTransition(item.status, "duplicate")
                          }
                          onClick={() =>
                            doTransition("duplicate", `mark-${s.id}`, {
                              duplicateOfId: s.id,
                            })
                          }
                          className="min-h-[44px] rounded border border-zinc-300 px-3 py-2 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
                        >
                          Mark
                        </button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white p-4">
        <h2 className="text-sm font-semibold">{t("detailReviewActions", lang)}</h2>
        <div className="mt-2">
          <label htmlFor="action-note" className="mb-1 block text-sm font-medium">
            Note (optional)
          </label>
          <input
            id="action-note"
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Decision reason…"
            className="min-h-[44px] w-full rounded border border-zinc-200 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
          />
        </div>
        <div className="mt-3 flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={
                busy ||
                decided ||
                role !== "coordinator" ||
                !canTransition(item.status, "approved")
              }
              onClick={() => doTransition("approved", "approve")}
              className="min-h-[44px] rounded bg-zinc-900 px-3 py-2 text-sm text-white disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
            >
              {t("detailApprove", lang)}
            </button>
            <button
              type="button"
              disabled={
                busy ||
                decided ||
                role !== "coordinator" ||
                !canTransition(item.status, "rejected")
              }
              onClick={() => {
                if (confirm && armed !== "rejected") {
                  setArmed("rejected");
                  return;
                }
                doTransition("rejected", "reject", undefined, confirm);
              }}
              className="min-h-[44px] rounded border border-zinc-300 px-3 py-2 text-sm disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
            >
              {armed === "rejected" && confirm
                ? t("confirmAgain", lang)
                : t("detailReject", lang)}
            </button>
            {stepper.map((s) => (
              <button
                key={s.to}
                type="button"
                disabled={
                  busy || decided || !canTransition(item.status, s.to) ||
                  (role !== "coordinator" && role !== "assignee")
                }
                onClick={() => {
                  const needsArm = s.to === "resolved" && confirm;
                  if (needsArm && armed !== "resolved") {
                    setArmed("resolved");
                    return;
                  }
                  doTransition(s.to, s.to, undefined, needsArm);
                }}
                className="min-h-[44px] rounded border border-zinc-300 px-3 py-2 text-sm disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
              >
                {s.to === "resolved" && armed === "resolved" && confirm
                  ? t("confirmAgain", lang)
                  : s.label}
              </button>
            ))}
          </div>
          {role === "coordinator" && canTransition(item.status, "duplicate") && !decided && (
            <div className="flex flex-col gap-2 rounded border border-zinc-200 p-2">
              <label
                htmlFor="dup-target"
                className="block text-sm font-medium"
              >
                Mark as duplicate of (report ID)
              </label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  id="dup-target"
                  type="text"
                  value={dupTarget}
                  onChange={(e) => setDupTarget(e.target.value)}
                  placeholder="RPT-1001"
                  className="min-h-[44px] w-full rounded border border-zinc-200 px-3 py-2 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
                />
                <button
                  type="button"
                  disabled={busy || dupTarget.trim().length === 0}
                  onClick={() =>
                    doTransition("duplicate", "duplicate", {
                      duplicateOfId: dupTarget.trim(),
                    })
                  }
                  className="min-h-[44px] shrink-0 rounded border border-zinc-300 px-3 py-2 text-sm disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
                >
                  {t("detailMarkDuplicate", lang)}
                </button>
              </div>
            </div>
          )}
          {role === "student" && (
            <p className="text-xs text-zinc-500">
              Students can submit reports but cannot change status.
            </p>
          )}
          {role === "assignee" && (
            <p className="text-xs text-zinc-500">
              Assignees can move Approved → In Progress → Resolved only.
            </p>
          )}
        </div>
        <div aria-live="polite" className="mt-2">
          {banner !== null && (
            <p
              role={banner.kind === "err" ? "alert" : "status"}
              className={
                banner.kind === "ok"
                  ? "rounded bg-green-50 p-2 text-sm text-green-900"
                  : "rounded bg-red-50 p-2 text-sm text-red-900"
              }
            >
              {banner.text}
            </p>
          )}
          {decided && banner === null && item.status !== "duplicate" && (
            <p className="rounded bg-zinc-100 p-2 text-sm text-zinc-700">
              This report is {item.status}; no further actions.
            </p>
          )}
          {decided && banner === null && item.status === "duplicate" && role !== "coordinator" && (
            <p className="rounded bg-zinc-100 p-2 text-sm text-zinc-700">
              This report is {item.status}; no further actions.
            </p>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white p-4">
        <h2 className="text-sm font-semibold">{t("detailTimeline", lang)}</h2>
        {events.length === 0 ? (
          <p className="mt-1 text-sm text-zinc-500">No events yet.</p>
        ) : (
          <ol className="mt-2 space-y-2">
            {events.map((e) => (
              <li key={e.id} className="break-words text-sm">
                <span className="font-medium">{eventLabel(e)}</span>{" "}
                <span className="text-zinc-500">
                  {e.from ?? "—"} → {e.to}
                </span>{" "}
                <span className="text-xs text-zinc-500">
                  by {e.actor} at {e.at}
                </span>
                {typeof e.note === "string" && e.note.length > 0 && (
                  <span className="block break-words text-xs text-zinc-600">
                    Note: {e.note}
                  </span>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>

      <Link
        href={seedHref("/board", seedId)}
        className="inline-block min-h-[44px] rounded border border-zinc-200 px-3 py-2 text-sm leading-[28px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
      >
        Back to Board
      </Link>
    </section>
  );
}
