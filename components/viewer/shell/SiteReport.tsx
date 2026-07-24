"use client";

// Site Report (Track A deliverables) — a client-facing, print-optimized summary
// of a survey: header, headline totals, the measurements table, and a temporal
// comparison section when compare measurements exist. Rendered as a light
// "document" preview on a dark backdrop (portaled to <body>); the Print button
// calls window.print(), and the inline @media print block isolates just the
// paper so "Save as PDF" produces a clean A4 sheet with none of the app chrome.
//
// Frontend-only: everything comes from data already in the store + manifest.

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Printer, X } from "lucide-react";

import { getProject } from "@/lib/api/userSvc";
import { formatSurveyDate } from "@/lib/utils";
import { useViewerStore } from "@/lib/viewer/state/store";
import { metricsOf, resultForKind } from "@/lib/viewer/calc";
import { metricLabel, reportTotals, type ReportRow } from "@/lib/viewer/exportReport";
import { temporalComparePair } from "@/lib/viewer/compare";
import { useCompareSurveys } from "@/components/viewer/shell/hooks/useCompareSurveys";

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 1 });
const fmt0 = (n: number) => Math.round(n).toLocaleString();

/** The single headline number to show per row in the table, by kind. */
function primaryMetric(kind: string, metrics: Record<string, number>): { label: string; value: number } | null {
  const pick = (k: string) => (k in metrics ? { label: metricLabel(k), value: metrics[k] } : null);
  switch (kind) {
    case "stockpile":
    case "volume":
      return pick("volume_m3");
    case "cut_fill":
      return pick("net_change_m3");
    case "area":
      return pick("area_m2") ?? pick("surface_area_m2");
    case "distance":
    case "line":
      return pick("length_m");
    case "section":
    case "slope":
      return pick("length_m") ?? pick("grade_pct");
    default: {
      const k = Object.keys(metrics)[0];
      return k ? { label: metricLabel(k), value: metrics[k] } : null;
    }
  }
}

export function SiteReport({ open, onClose }: { open: boolean; onClose: () => void }) {
  const measurements = useViewerStore((s) => s.measurements);
  const survey = useViewerStore((s) => s.manifest?.survey ?? null);
  const projectId = survey?.project_id ?? null;

  const { dateOf } = useCompareSurveys(projectId);
  const [siteName, setSiteName] = useState<string | null>(null);

  // Project name lookup (best-effort). Render-phase reset on project change so a
  // stale name never shows; the fetch itself stays in the effect.
  const [loadedFor, setLoadedFor] = useState(projectId);
  if (loadedFor !== projectId) {
    setLoadedFor(projectId);
    setSiteName(null);
  }
  useEffect(() => {
    if (!open || !projectId) return;
    let cancelled = false;
    getProject(projectId)
      .then((p) => !cancelled && setSiteName(p?.name ?? null))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, projectId]);

  // Esc closes (capture phase so it never falls through to a viewer listener).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  const rows = useMemo<ReportRow[]>(
    () =>
      measurements
        .filter((m) => m.geometry)
        .map((m) => ({
          name: m.name,
          kind: m.kind,
          folder: m.folder ?? null,
          status: m.status,
          metrics: metricsOf(resultForKind(m)),
        })),
    [measurements]
  );
  const totals = useMemo(() => reportTotals(rows), [rows]);

  const compares = useMemo(
    () =>
      measurements
        .map((m) => {
          const pair = temporalComparePair(m.params as Record<string, unknown> | undefined);
          if (!pair) return null;
          const mt = metricsOf(resultForKind(m));
          return {
            name: m.name,
            aDate: dateOf.get(pair.aId) ?? null,
            bDate: dateOf.get(pair.bId) ?? null,
            cut: mt.cut_volume_m3,
            fill: mt.fill_volume_m3,
            net: mt.net_change_m3,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null),
    [measurements, dateOf]
  );

  if (!open || typeof document === "undefined" || !survey) return null;

  const title = siteName ?? `Survey ${formatSurveyDate(survey.survey_date)}`;
  const crs = survey.working_crs || "local grid";
  const today = new Date().toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

  return createPortal(
    <>
      <style>{`
        @media print {
          body { visibility: hidden !important; background: #fff !important; }
          #geoid-report, #geoid-report * { visibility: visible !important; }
          #geoid-report { position: absolute !important; inset: 0 auto auto 0 !important;
            width: 100% !important; max-width: none !important; box-shadow: none !important;
            border-radius: 0 !important; margin: 0 !important; }
          .report-no-print { display: none !important; }
          @page { margin: 16mm; }
        }
      `}</style>
      <div className="fixed inset-0 z-[90] overflow-y-auto bg-black/70 backdrop-blur-sm">
        {/* toolbar — not printed */}
        <div className="report-no-print sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-white/[0.08] bg-[#141417]/90 px-5 py-2.5 backdrop-blur-md">
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[#C97A4E]">Site report · preview</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="flex items-center gap-1.5 rounded-lg bg-[#C97A4E] px-3 py-1.5 text-[12.5px] font-semibold text-[#141417] transition-opacity hover:opacity-90"
            >
              <Printer size={14} /> Print / Save PDF
            </button>
            <button
              type="button"
              aria-label="Close report"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-300 hover:bg-white/[0.08] hover:text-white"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* the paper */}
        <div
          id="geoid-report"
          className="mx-auto my-8 w-[min(820px,calc(100vw-32px))] rounded-xl bg-white px-12 py-11 text-[#1a1a1a] shadow-[0_20px_80px_rgba(0,0,0,0.5)]"
          style={{ fontFamily: "ui-sans-serif, -apple-system, 'Segoe UI', Roboto, sans-serif" }}
        >
          {/* header */}
          <div className="flex items-start justify-between gap-6 border-b-2 border-[#C97A4E] pb-5">
            <div>
              <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-[#C97A4E]">GEOID · Survey report</div>
              <h1 className="mt-1.5 text-[26px] font-bold leading-tight text-[#151515]">{title}</h1>
              <div className="mt-1 text-[13px] text-[#5a5a5a]">
                Flight {formatSurveyDate(survey.survey_date)} · {crs}
                {survey.vertical_datum ? ` · ${survey.vertical_datum}` : ""}
              </div>
            </div>
            <div className="text-right text-[11px] text-[#8a8a8a]">
              Generated<br />
              <span className="text-[13px] font-medium text-[#4a4a4a]">{today}</span>
            </div>
          </div>

          {/* summary tiles */}
          <div className="mt-6 grid grid-cols-3 gap-3">
            <Tile label="Measurements" value={String(totals.count)} />
            <Tile label="Total stockpile volume" value={totals.stockpileVolumeM3 != null ? `${fmt0(totals.stockpileVolumeM3)} m³` : "—"} />
            <Tile
              label="Net change"
              value={totals.netChangeM3 != null ? `${totals.netChangeM3 >= 0 ? "+" : ""}${fmt0(totals.netChangeM3)} m³` : "—"}
              tone={totals.netChangeM3 == null ? undefined : totals.netChangeM3 >= 0 ? "up" : "down"}
            />
          </div>

          {/* measurements table */}
          <h2 className="mt-9 mb-2 text-[12px] font-semibold uppercase tracking-[0.1em] text-[#8a7a6a]">Measurements</h2>
          {rows.length === 0 ? (
            <p className="py-4 text-[13px] italic text-[#9a9a9a]">No measurements on this survey yet.</p>
          ) : (
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-[#e2e2e2] text-left text-[11px] uppercase tracking-wide text-[#9a9a9a]">
                  <th className="py-2 pr-3 font-semibold">Name</th>
                  <th className="py-2 pr-3 font-semibold">Type</th>
                  <th className="py-2 pr-3 font-semibold">Folder</th>
                  <th className="py-2 pl-3 text-right font-semibold" style={{ fontVariantNumeric: "tabular-nums" }}>Result</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const pm = primaryMetric(r.kind, r.metrics);
                  return (
                    <tr key={i} className="border-b border-[#efefef]">
                      <td className="py-2 pr-3 font-medium text-[#2a2a2a]">{r.name}</td>
                      <td className="py-2 pr-3 capitalize text-[#6a6a6a]">{r.kind.replace(/_/g, " ")}</td>
                      <td className="py-2 pr-3 text-[#8a8a8a]">{r.folder ?? "—"}</td>
                      <td className="py-2 pl-3 text-right text-[#2a2a2a]" style={{ fontVariantNumeric: "tabular-nums" }}>
                        {pm ? `${fmt(pm.value)}` : "—"}
                        {pm && <span className="ml-1 text-[10px] text-[#a0a0a0]">{pm.label.replace(/^[^(]*\(|\)$/g, "").trim()}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {/* comparison section */}
          {compares.length > 0 && (
            <>
              <h2 className="mt-9 mb-2 text-[12px] font-semibold uppercase tracking-[0.1em] text-[#8a7a6a]">Change between surveys</h2>
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-[#e2e2e2] text-left text-[11px] uppercase tracking-wide text-[#9a9a9a]">
                    <th className="py-2 pr-3 font-semibold">Region</th>
                    <th className="py-2 pr-3 font-semibold">Period</th>
                    <th className="py-2 px-3 text-right font-semibold" style={{ fontVariantNumeric: "tabular-nums" }}>Cut</th>
                    <th className="py-2 px-3 text-right font-semibold" style={{ fontVariantNumeric: "tabular-nums" }}>Fill</th>
                    <th className="py-2 pl-3 text-right font-semibold" style={{ fontVariantNumeric: "tabular-nums" }}>Net</th>
                  </tr>
                </thead>
                <tbody>
                  {compares.map((c, i) => (
                    <tr key={i} className="border-b border-[#efefef]">
                      <td className="py-2 pr-3 font-medium text-[#2a2a2a]">{c.name}</td>
                      <td className="py-2 pr-3 text-[#6a6a6a]">
                        {c.aDate ? formatSurveyDate(c.aDate) : "A"} → {c.bDate ? formatSurveyDate(c.bDate) : "B"}
                      </td>
                      <td className="py-2 px-3 text-right text-[#b45248]" style={{ fontVariantNumeric: "tabular-nums" }}>{c.cut != null ? `${fmt0(c.cut)} m³` : "—"}</td>
                      <td className="py-2 px-3 text-right text-[#3f7d52]" style={{ fontVariantNumeric: "tabular-nums" }}>{c.fill != null ? `${fmt0(c.fill)} m³` : "—"}</td>
                      <td className="py-2 pl-3 text-right font-semibold text-[#2a2a2a]" style={{ fontVariantNumeric: "tabular-nums" }}>
                        {c.net != null ? `${c.net >= 0 ? "+" : ""}${fmt0(c.net)} m³` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {/* footer */}
          <div className="mt-10 border-t border-[#e8e8e8] pt-4 text-[11px] text-[#a0a0a0]">
            Volumes computed against the survey DSM in {crs}
            {survey.vertical_datum ? ` (${survey.vertical_datum})` : ""}. Generated by GEOID.
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  const color = tone === "up" ? "#3f7d52" : tone === "down" ? "#b45248" : "#151515";
  return (
    <div className="rounded-lg border border-[#ececec] bg-[#fafafa] px-4 py-3">
      <div className="text-[10px] font-medium uppercase tracking-wide text-[#9a9a9a]">{label}</div>
      <div className="mt-1 text-[19px] font-bold" style={{ color, fontVariantNumeric: "tabular-nums" }}>{value}</div>
    </div>
  );
}
