"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { buildCsv, exportFilename } from "../../lib/csv";
import {
  explainIncident,
  matchReportToIncidents,
} from "../../lib/clustering";
import {
  loadPersistedPrefs,
  resolveAppConfig,
  savePersistedPrefs,
  seedHref,
  t,
  type Lang,
  type PersistedPrefs,
} from "../../lib/config";
import {
  incidentStatusLabel,
  type Item,
  type MasterIncident,
  type Severity,
} from "../../lib/schema";
import {
  ensureSeeded,
  listIncidentEvents,
  listIncidents,
  listItems,
  reseedDemo,
  setActiveSeedId,
} from "../../lib/store";

const SEVERITY_CHIP: Record<Severity, string> = {
  P0: "bg-red-600 text-white",
  P1: "bg-orange-500 text-white",
  P2: "bg-amber-200 text-amber-900",
  P3: "bg-zinc-200 text-zinc-700",
};

type StatusFilter =
  | "active"
  | "all"
  | "open"
  | "approved"
  | "in_progress"
  | "resolved"
  | "rejected"
  | "duplicate";
type SortMode = "priority" | "newest";

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: "active", label: "Active" },
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "approved", label: "Assigned" },
  { value: "in_progress", label: "In Progress" },
  { value: "resolved", label: "Resolved" },
  { value: "rejected", label: "Rejected" },
  { value: "duplicate", label: "Duplicate" },
];

// P4-B search normalization: lowercase, punctuation/whitespace collapsed.
function normSearch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

interface CardData {
  incident: MasterIncident;
  members: Item[];
  maxScore: number;
  newestAt: number;
  uncertain: boolean;
  explanation: string;
  pending: { incidentId: string; score: number } | null;
}

function IncidentCard({ card, seedId }: { card: CardData; seedId: string }) {
  const { incident, members, maxScore, uncertain, explanation, pending } = card;
  return (
    <li className="rounded-lg border border-zinc-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded px-2 py-0.5 text-xs font-semibold ${SEVERITY_CHIP[incident.severity]}`}
        >
          {incident.severity}
        </span>
        <span className="font-mono text-xs text-zinc-700">P{maxScore}</span>
        <span className="font-mono text-xs text-zinc-400">{incident.id}</span>
        <span className="flex-1" />
        <span
          className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-900"
          title="Reports grouped in this incident"
        >
          &times;{members.length} report{members.length === 1 ? "" : "s"}
        </span>
        {uncertain && (
          <span
            className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900"
            title="At least one grouped report needs human review"
          >
            &#9888; needs review
          </span>
        )}
        {pending !== null && (
          <span
            className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-900"
            title={`Possible match to ${pending.incidentId} awaiting review`}
          >
            &#9673; candidate to review
          </span>
        )}
        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700">
          {incidentStatusLabel(incident.status)}
        </span>
      </div>
      <Link
        href={seedHref(`/request/${incident.id}`, seedId)}
        className="mt-2 block min-h-[44px] break-words font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
      >
        {incident.title}
      </Link>
      <p className="mt-1 break-words text-xs text-zinc-500">
        {incident.locationLabel} &middot; {incident.category} &middot;{" "}
        {incident.department}
      </p>
      <p className="mt-1 break-words text-xs text-zinc-500">{explanation}</p>
    </li>
  );
}

function BoardInner() {
  const params = useSearchParams();
  const query = useMemo(
    () => ({
      role: params.get("role") ?? undefined,
      lang: params.get("lang") ?? undefined,
      simple: params.get("simple") ?? undefined,
      demo: params.get("demo") ?? undefined,
      seed: params.get("seed") ?? undefined,
    }),
    [params],
  );
  const [prefs, setPrefs] = useState<PersistedPrefs>({});
  const [items, setItems] = useState<Item[] | null>(null);
  const [incidents, setIncidents] = useState<MasterIncident[] | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [sortMode, setSortMode] = useState<SortMode>("priority");
  const [search, setSearch] = useState("");
  const [role, setRole] = useState<"student" | "coordinator" | "assignee">(
    "coordinator",
  );

  const cfg = resolveAppConfig(query, prefs);
  const demo = cfg.demo;
  const lang: Lang = cfg.lang;
  const simple = cfg.simpleMode;

  useEffect(() => {
    const stored = loadPersistedPrefs();
    setPrefs(stored);
    setRole(resolveAppConfig(query, stored).role);
    setActiveSeedId(resolveAppConfig(query, stored).seedId);
    if (demo) {
      reseedDemo();
    } else {
      ensureSeeded();
    }
    setItems(listItems());
    setIncidents(listIncidents());
    // Touch the incident-event layer so lazy state initializes uniformly.
    listIncidentEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo]);

  function handleRole(next: "student" | "coordinator" | "assignee") {
    setRole(next);
    setPrefs((prev) => {
      const merged = { ...prev, role: next };
      savePersistedPrefs({ role: next });
      return merged;
    });
  }

  // ONE card per canonical incident (merged aliases never render).
  const cards = useMemo<CardData[] | null>(() => {
    if (items === null || incidents === null) return null;
    const byId = new Map(items.map((i) => [i.id, i]));
    const canonical = incidents.filter((i) => i.mergedIntoId === null);
    // Pending-candidate flags: single-member incidents whose sole report
    // review-matches another canonical incident (human decision outstanding).
    const pendingBy = new Map<string, { incidentId: string; score: number }>();
    for (const inc of canonical) {
      if (inc.attachedReportIds.length !== 1) continue;
      const sole = byId.get(inc.attachedReportIds[0]);
      if (sole === undefined) continue;
      try {
        const cands = matchReportToIncidents(
          sole,
          canonical.filter((o) => o.id !== inc.id),
          byId,
          1,
        );
        if (cands.length > 0 && cands[0].band === "review") {
          pendingBy.set(inc.id, {
            incidentId: cands[0].incidentId,
            score: cands[0].score,
          });
        }
      } catch {
        // Matcher is pure; a failure here must never break the board.
      }
    }
    return canonical.map((incident) => {
      const members = incident.attachedReportIds
        .map((id) => byId.get(id))
        .filter((m): m is Item => m !== undefined);
      let maxScore = 0;
      let newestAt = 0;
      let uncertain = false;
      for (const m of members) {
        if (m.priority_score > maxScore) maxScore = m.priority_score;
        const at = Date.parse(m.createdAt);
        if (at > newestAt) newestAt = at;
        if (m.confidence < 0.6) uncertain = true;
      }
      let explanation = "";
      try {
        explanation = explainIncident(incident, byId);
      } catch {
        explanation = `${members.length} grouped reports`;
      }
      return {
        incident,
        members,
        maxScore,
        newestAt,
        uncertain,
        explanation,
        pending: pendingBy.get(incident.id) ?? null,
      };
    });
  }, [items, incidents]);

  const visible = useMemo(() => {
    if (cards === null) return null;
    const needle = normSearch(search);
    const filtered = cards.filter((c) => {
      const st = c.incident.status;
      if (statusFilter === "active") {
        if (st !== "open" && st !== "approved" && st !== "in_progress") {
          return false;
        }
      } else if (statusFilter !== "all" && st !== statusFilter) {
        return false;
      }
      if (needle.length > 0) {
        const hay = normSearch(
          `${c.incident.title} ${c.incident.locationLabel} ${c.incident.category} ${c.incident.department} ` +
            c.members.map((m) => `${m.title} ${m.description} ${m.location}`).join(" "),
        );
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    if (sortMode === "priority") {
      filtered.sort((a, b) => b.maxScore - a.maxScore || b.newestAt - a.newestAt);
    } else {
      filtered.sort((a, b) => b.newestAt - a.newestAt);
    }
    return filtered;
  }, [cards, statusFilter, sortMode, search]);

  const totalReports = useMemo(() => {
    if (visible === null) return 0;
    return visible.reduce((n, c) => n + c.members.length, 0);
  }, [visible]);

  function handleExport() {
    if (visible === null) return;
    // F10: export the CURRENTLY VISIBLE (filtered+sorted) records, expanded
    // to member report rows in display order (incident sort, members
    // oldest-first). Rows stay reports; CSV columns frozen (stability clause).
    const rows: Item[] = [];
    for (const c of visible) {
      const ordered = [...c.members].sort((a, b) =>
        a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1,
      );
      for (const m of ordered) rows.push(m);
    }
    const csv = buildCsv(rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = exportFilename();
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <section aria-labelledby="board-title" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 id="board-title" className="text-2xl font-semibold">
          {t("boardTitle", lang)}
        </h1>
        <span className="flex-1" />
        {demo && (
          <span className="rounded bg-zinc-900 px-2 py-0.5 text-xs text-white">
            Demo data
          </span>
        )}
        {visible !== null && (
          <span className="text-xs text-zinc-500" aria-live="polite">
            {visible.length} incidents ({totalReports} reports)
          </span>
        )}
      </div>
      <div className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-3 sm:flex-row sm:flex-wrap sm:items-end">
        <div>
          <label
            htmlFor="board-role"
            className="mb-1 block text-xs font-medium text-zinc-600"
          >
            {t("roleLabel", lang)}
          </label>
          <select
            id="board-role"
            value={role}
            onChange={(e) =>
              handleRole(
                e.target.value as "student" | "coordinator" | "assignee",
              )
            }
            className="min-h-[44px] rounded border border-zinc-200 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
          >
            <option value="student">Student</option>
            <option value="coordinator">Coordinator</option>
            <option value="assignee">Assignee</option>
          </select>
        </div>
        <div>
          <label
            htmlFor="board-search"
            className="mb-1 block text-xs font-medium text-zinc-600"
          >
            {t("boardSearch", lang)}
          </label>
          <input
            id="board-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("boardSearchPlaceholder", lang)}
            className="min-h-[44px] w-full rounded border border-zinc-200 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2 sm:w-auto"
          />
        </div>
        <div>
          <label
            htmlFor="board-status"
            className="mb-1 block text-xs font-medium text-zinc-600"
          >
            {t("boardStatus", lang)}
          </label>
          <select
            id="board-status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="min-h-[44px] rounded border border-zinc-200 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        {!simple && (
          <div>
            <label
              htmlFor="board-sort"
              className="mb-1 block text-xs font-medium text-zinc-600"
            >
              {t("boardSort", lang)}
            </label>
            <select
              id="board-sort"
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as SortMode)}
              className="min-h-[44px] rounded border border-zinc-200 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
            >
              <option value="priority">Max score↓</option>
              <option value="newest">Newest member</option>
            </select>
          </div>
        )}
        <span className="flex-1" />
        {!simple && (
          <button
            type="button"
            onClick={handleExport}
            disabled={visible === null}
            className="min-h-[44px] rounded bg-zinc-900 px-3 py-2 text-sm text-white disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
          >
            {t("boardExport", lang)}
          </button>
        )}
      </div>
      <div aria-live="polite">
        {visible === null ? (
          <ul className="space-y-3" aria-label="Loading queue">
            {[0, 1, 2].map((i) => (
              <li
                key={i}
                className="animate-pulse rounded-lg border border-zinc-200 bg-white p-4"
              >
                <div className="h-4 w-2/3 rounded bg-zinc-100" />
                <div className="mt-2 h-3 w-1/3 rounded bg-zinc-100" />
              </li>
            ))}
          </ul>
        ) : visible.length === 0 ? (
          <div className="rounded-lg border border-zinc-200 bg-white p-4">
            <p className="text-sm">{t("boardEmpty", lang)}</p>
            <Link
              href="/submit"
              className="mt-2 inline-block min-h-[44px] rounded bg-zinc-900 px-3 py-2 text-sm leading-[28px] text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
            >
              {t("boardEmptyCta", lang)}
            </Link>
          </div>
        ) : (
          <ul className="space-y-3">
            {visible.map((card) => (
              <IncidentCard key={card.incident.id} card={card} seedId={cfg.seedId} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

export default function BoardPage() {
  return (
    <Suspense
      fallback={
        <section aria-labelledby="board-title" className="space-y-3">
          <h1 id="board-title" className="text-2xl font-semibold">
            Priority Board
          </h1>
          <ul className="space-y-3" aria-label="Loading queue">
            {[0, 1, 2].map((i) => (
              <li
                key={i}
                className="animate-pulse rounded-lg border border-zinc-200 bg-white p-4"
              >
                <div className="h-4 w-2/3 rounded bg-zinc-100" />
                <div className="mt-2 h-3 w-1/3 rounded bg-zinc-100" />
              </li>
            ))}
          </ul>
        </section>
      }
    >
      <BoardInner />
    </Suspense>
  );
}
