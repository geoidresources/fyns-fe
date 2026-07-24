// Deliverables — pure builders for the CSV export and the Site Report. No React,
// no DOM: rows in, strings/derived data out, so it's unit-testable. The report
// UI (SiteReport.tsx) and the download trigger (ViewerCanvas) call these.

/** One measurement, flattened for export/report. `metrics` is the numeric map
 * from calc.ts `metricsOf(resultForKind(m))` — dynamic per kind. */
export interface ReportRow {
  name: string;
  kind: string;
  folder: string | null;
  status: string;
  metrics: Record<string, number>;
}

/** Friendly labels + units for the metric keys the compute tiers emit. Unknown
 * keys fall back to a de-underscored title, so a new metric never breaks export. */
const METRIC_LABELS: Record<string, string> = {
  volume_m3: "Volume (m³)",
  cut_volume_m3: "Cut (m³)",
  fill_volume_m3: "Fill (m³)",
  net_change_m3: "Net change (m³)",
  tonnage_t: "Tonnage (t)",
  area_m2: "Area (m²)",
  surface_area_m2: "Surface area (m²)",
  plan_area_m2: "Plan area (m²)",
  length_m: "Length (m)",
  perimeter_m: "Perimeter (m)",
  rise_m: "Rise (m)",
  grade_pct: "Grade (%)",
};

export function metricLabel(key: string): string {
  return METRIC_LABELS[key] ?? key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Stable column order across a heterogeneous set: known metrics in curated
 * order first (only those that actually appear), then any extras alphabetically.
 * Computed as the union over every row so no measurement's number is dropped. */
export function metricColumns(rows: ReportRow[]): string[] {
  const seen = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r.metrics)) seen.add(k);
  const known = Object.keys(METRIC_LABELS).filter((k) => seen.has(k));
  const extra = [...seen].filter((k) => !(k in METRIC_LABELS)).sort();
  return [...known, ...extra];
}

/** RFC-4180: quote a field iff it contains a quote, comma, CR or LF; double any
 * embedded quotes. */
function csvField(v: string): string {
  return /["\n\r,]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Spreadsheet-friendly number — up to 2 dp, no thousands separators (units live
 * in the header), empty string for absent/non-finite. */
function csvNum(n: number | undefined): string {
  return typeof n === "number" && Number.isFinite(n) ? String(Math.round(n * 100) / 100) : "";
}

/** Measurements → CSV text (CRLF line breaks, per RFC-4180). Header is the
 * identity columns plus one column per metric that appears anywhere. */
export function measurementsToCsv(rows: ReportRow[]): string {
  const cols = metricColumns(rows);
  const header = ["Name", "Kind", "Folder", "Status", ...cols.map(metricLabel)];
  const lines = [header.map(csvField).join(",")];
  for (const r of rows) {
    const cells = [
      r.name,
      r.kind,
      r.folder ?? "",
      r.status,
      ...cols.map((c) => csvNum(r.metrics[c])),
    ];
    lines.push(cells.map(csvField).join(","));
  }
  return lines.join("\r\n");
}

/** Report headline totals — summed across rows that carry the metric. Returns
 * only totals that have at least one contributing measurement. */
export interface ReportTotals {
  count: number;
  stockpileVolumeM3: number | null;
  netChangeM3: number | null;
  byKind: Array<{ kind: string; count: number }>;
}

export function reportTotals(rows: ReportRow[]): ReportTotals {
  let vol = 0;
  let volN = 0;
  let net = 0;
  let netN = 0;
  const kinds = new Map<string, number>();
  for (const r of rows) {
    kinds.set(r.kind, (kinds.get(r.kind) ?? 0) + 1);
    const v = r.metrics.volume_m3;
    if (typeof v === "number" && Number.isFinite(v)) {
      vol += v;
      volN++;
    }
    const n = r.metrics.net_change_m3;
    if (typeof n === "number" && Number.isFinite(n)) {
      net += n;
      netN++;
    }
  }
  return {
    count: rows.length,
    stockpileVolumeM3: volN > 0 ? vol : null,
    netChangeM3: netN > 0 ? net : null,
    byKind: [...kinds.entries()]
      .map(([kind, count]) => ({ kind, count }))
      .sort((a, b) => b.count - a.count),
  };
}
