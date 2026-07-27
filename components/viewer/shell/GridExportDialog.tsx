"use client";

// Survey-points export flow (viewer-shell Export & reports). A self-contained
// overlay opened from the TreePanel dropdown — sibling to CadExportDialog, same
// dispatch → poll-manifest → download shape. grid-extract turns the survey's
// DSM raster into a REGULAR GRID of survey points (3D GeoJSON or CSV x,y,z),
// one format per run. It dispatches the generic grid-extract processor via
// POST /surveys/:id/generate, polls manifest.layers.points for the FRESH entry
// (URL-diff vs a pre-dispatch snapshot — the output URL carries the workflow id
// so it changes per run), and surfaces the download link + returned point_count.
//
// Numbers are the server's: this never samples the DSM itself. The only client
// math is the metres → CRS-units bridge for the spacing input (§4 live-feedback
// class), because grid-extract's `spacing_m` is expressed in the RASTER's CRS
// units: projected DSMs (EPSG:32756 …) take metres as-is; geographic DSMs
// (EPSG:4326 — the Mine Site co-registered rasters) need metres → degrees at the
// site's centre latitude. The point-count estimate is likewise provisional
// feedback (a fine grid over a big site is millions of points / 100+ MB).

import { useCallback, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, Grid3x3, Loader2, XCircle } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useViewerStore, useViewerStoreApi } from "@/lib/viewer/state/store";
import {
  generateSurvey,
  getManifest,
  type PointsLayer,
  type TerrainLayer,
} from "@/lib/api/assetSvc";
import type { Project } from "@/lib/api/userSvc";
import { ApiError } from "@/lib/api/client";
import { proxyGcsUrls, unproxyGcsUrl } from "@/components/viewer/shell/sceneHelpers";

// One serialization per run — grid-extract takes a single `format`, not an array.
const FORMATS = ["geojson", "csv"] as const;
type GridFormat = (typeof FORMATS)[number];

const FORMAT_LABELS: Record<GridFormat, string> = {
  geojson: "GeoJSON",
  csv: "CSV",
};

const POLL_INTERVAL_MS = 2500;
// grid-extract reads the whole DSM and rasterizes a grid — heavier than the
// inline CAD export, so a slightly longer bound before we call it timed out.
const POLL_TIMEOUT_MS = 120_000;

const DEFAULT_SPACING_M = 5;
// Soft point-count guard: past this the file is large (100+ MB) and slow.
const LARGE_POINT_COUNT = 1_000_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Phase = "idle" | "dispatching" | "computing" | "ready" | "failed";

// `unproxyGcsUrl` (the /gcs → canonical inverse used for the dispatch source)
// now lives in sceneHelpers, shared with the change-detect dispatch flow.

// Geographic CRSs the metres → degrees bridge must fire for. 4326 (WGS84) is the
// one the Mine Site DSMs use; the rest are the common lat/lon datums a survey
// might carry. Everything else (UTM/MGA/NZTM/BNG …) is projected metres.
const GEOGRAPHIC_EPSG = new Set([4326, 4979, 4269, 4258, 4283, 7844, 4167, 4759, 4008]);

/** Pull the numeric EPSG code out of a CRS string ("EPSG:32756", "4326", …). */
function epsgCode(crs?: string | null): number | null {
  if (!crs) return null;
  const m = /(?:EPSG:)?\s*(\d{4,6})/i.exec(crs.trim());
  if (!m) return null;
  const code = Number(m[1]);
  return Number.isFinite(code) ? code : null;
}

/** True when the raster CRS measures in degrees (grid-extract `spacing_m` then
 * needs a metres → degrees conversion). A raw `+proj=longlat` def counts too. */
function isGeographicCrs(crs?: string | null): boolean {
  if (!crs) return false;
  if (crs.toLowerCase().includes("longlat")) return true;
  const code = epsgCode(crs);
  return code !== null && GEOGRAPHIC_EPSG.has(code);
}

/** Centre latitude for the bridge: DSM bbox first (bbox is always WGS84 degrees,
 * even when the raster is projected), then any terrain bbox, then the project
 * centre. Null only when a survey has no extent at all. */
function resolveCentreLat(
  dsm: TerrainLayer | undefined,
  terrain: TerrainLayer[] | null | undefined,
  project: Project | null
): number | null {
  const fromBbox = (t?: TerrainLayer) =>
    t?.bbox && t.bbox.length === 4 ? (t.bbox[1] + t.bbox[3]) / 2 : null;
  const dsmLat = fromBbox(dsm);
  if (dsmLat !== null) return dsmLat;
  for (const t of terrain ?? []) {
    const lat = fromBbox(t);
    if (lat !== null) return lat;
  }
  return project?.center_lat ?? null;
}

interface SpacingPlan {
  geographic: boolean;
  centreLat: number | null;
  /** Value to send as `spacing_m` in the raster's CRS units — metres when
   * projected, degrees when geographic. Null when geographic but no latitude
   * resolves (Export is then blocked rather than silently sending degrees-as-metres). */
  value: number | null;
  note: string;
}

/** Resolve the effective spacing to send + a human note, from the metres input
 * and the DSM's CRS. Pure — called in render (for the note) and again at
 * dispatch (for the payload) so the two never drift. */
function planSpacing(
  dsm: TerrainLayer | undefined,
  terrain: TerrainLayer[] | null | undefined,
  project: Project | null,
  metres: number
): SpacingPlan {
  const crs = dsm?.crs;
  const geographic = isGeographicCrs(crs);
  const centreLat = resolveCentreLat(dsm, terrain, project);

  if (!geographic) {
    return {
      geographic,
      centreLat,
      value: metres,
      note: `Sent as ${metres} m in ${crs ?? "the raster CRS"} (projected units).`,
    };
  }
  if (centreLat === null) {
    return {
      geographic,
      centreLat,
      value: null,
      note: `${crs ?? "This DSM"} is geographic, but no latitude is available to convert metres → degrees.`,
    };
  }
  // Standard small-angle bridge (§task): a metre of easting spans this many
  // degrees of longitude at the site's latitude. Conservative — uses the
  // longitude scale (cos-shrunk), which is the coarser of the two axes.
  const deg = metres / (111320 * Math.cos((centreLat * Math.PI) / 180));
  return {
    geographic,
    centreLat,
    value: deg,
    note: `${crs} is geographic — ${metres} m ≈ ${deg.toFixed(7)}° at ${centreLat.toFixed(4)}° lat.`,
  };
}

/** Rough grid point-count from the DSM bbox + spacing, for the size guard only
 * (provisional — the server returns the real count). Null when there's no bbox. */
function estimatePointCount(
  dsm: TerrainLayer | undefined,
  centreLat: number | null,
  metres: number
): number | null {
  const b = dsm?.bbox;
  if (!b || b.length !== 4 || centreLat === null || !(metres > 0)) return null;
  const [w, s, e, n] = b;
  const widthM = Math.abs(e - w) * 111320 * Math.cos((centreLat * Math.PI) / 180);
  const heightM = Math.abs(n - s) * 110540;
  if (!(widthM > 0) || !(heightM > 0)) return null;
  return Math.round((widthM / metres + 1) * (heightM / metres + 1));
}

/** Every grid-extract output URL currently on the manifest — snapshotted before
 * dispatch so the poll can tell the FRESH point set from a prior run's. */
function pointsUrlSet(points: PointsLayer[] | null | undefined): Set<string> {
  const urls = new Set<string>();
  for (const p of points ?? []) {
    if (p.processor_type !== "grid-extract" || !p.output_urls) continue;
    for (const u of Object.values(p.output_urls)) if (u) urls.add(u);
  }
  return urls;
}

interface FreshPoints {
  url: string;
  pointCount?: number;
}

/** First grid-extract entry carrying a URL not present in `before` (the single
 * output file — its key is "url", but take whichever value is fresh). */
function freshPointsExport(
  points: PointsLayer[] | null | undefined,
  before: Set<string>
): FreshPoints | null {
  for (const p of points ?? []) {
    if (p.processor_type !== "grid-extract" || !p.output_urls) continue;
    const fresh = Object.values(p.output_urls).find((u) => u && !before.has(u));
    if (fresh) return { url: fresh, pointCount: p.point_count };
  }
  return null;
}

export function GridExportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const storeApi = useViewerStoreApi();
  const dsm = useViewerStore((s) =>
    s.manifest?.layers.terrain?.find((t) => t.surface_type === "dsm")
  );
  const terrain = useViewerStore((s) => s.manifest?.layers.terrain ?? null);
  const project = useViewerStore((s) => s.project);

  const dsmUrl = dsm?.raw_raster_url ?? null;

  // Spacing as a string so the field can be cleared mid-edit; metres is derived.
  const [spacingInput, setSpacingInput] = useState(String(DEFAULT_SPACING_M));
  const [selectedFormat, setSelectedFormat] = useState<GridFormat>("geojson");

  const [phase, setPhase] = useState<Phase>("idle");
  const [link, setLink] = useState<FreshPoints | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  // Flipped true on close so an in-flight poll loop bails instead of setting
  // state on a hidden dialog (same pattern as CadExportDialog).
  const cancelledRef = useRef(false);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (next) {
        cancelledRef.current = false;
      } else {
        cancelledRef.current = true;
        setPhase("idle");
        setLink(null);
        setError(null);
        setWarning(null);
      }
      onOpenChange(next);
    },
    [onOpenChange]
  );

  const metres = Number(spacingInput);
  const metresValid = Number.isFinite(metres) && metres > 0;
  const plan = planSpacing(dsm, terrain, project, metres);
  const estimate = metresValid ? estimatePointCount(dsm, plan.centreLat, metres) : null;

  // Export is blocked when there's no DSM, an invalid spacing, or a geographic
  // DSM with no resolvable latitude (a degrees value we can't compute).
  const disabledReason = !dsmUrl
    ? "This survey has no DSM raster — grid-extract needs a DSM to sample."
    : !metresValid
      ? "Enter a spacing greater than 0."
      : plan.value === null
        ? plan.note
        : null;

  const runExport = useCallback(async () => {
    cancelledRef.current = false;
    setError(null);
    setWarning(null);
    setLink(null);

    const state = storeApi.getState();
    const surveyId = state.surveyId;
    const liveDsm = state.manifest?.layers.terrain?.find((t) => t.surface_type === "dsm");
    const liveTerrain = state.manifest?.layers.terrain ?? null;
    const url = liveDsm?.raw_raster_url;
    const crs = liveDsm?.crs;

    if (!url) {
      setError("This survey has no DSM raster to extract from.");
      setPhase("failed");
      return;
    }

    const value = Number(spacingInput);
    if (!Number.isFinite(value) || value <= 0) {
      setError("Enter a spacing greater than 0.");
      setPhase("failed");
      return;
    }

    const spacingPlan = planSpacing(liveDsm, liveTerrain, state.project, value);
    if (spacingPlan.value === null) {
      setError(spacingPlan.note);
      setPhase("failed");
      return;
    }

    setPhase("dispatching");
    const before = pointsUrlSet(state.manifest?.layers.points);

    try {
      await generateSurvey(surveyId, {
        processor_type: "grid-extract",
        version: "v1",
        payload: {
          source: { url: unproxyGcsUrl(url), kind: "terrain", crs },
          spacing_m: spacingPlan.value,
          format: selectedFormat,
        },
      });
    } catch (err) {
      if (cancelledRef.current) return;
      setError(err instanceof ApiError ? err.message : "Failed to dispatch the export.");
      setPhase("failed");
      return;
    }
    if (cancelledRef.current) return;
    setPhase("computing");

    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
      if (cancelledRef.current) return;
      try {
        const manifest = proxyGcsUrls(await getManifest(surveyId));
        if (cancelledRef.current) return;
        const found = freshPointsExport(manifest.layers.points, before);
        if (found) {
          setLink(found);
          setPhase("ready");
          return;
        }
      } catch {
        // Transient manifest read — keep polling until the deadline.
      }
    }
    if (!cancelledRef.current) {
      setError("Timed out waiting for the point extract. It may still finish — reopen to check.");
      setPhase("failed");
    }
  }, [storeApi, spacingInput, selectedFormat]);

  const busy = phase === "dispatching" || phase === "computing";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Survey points</DialogTitle>
          <DialogDescription>
            A regular grid of survey points sampled from this survey&apos;s DSM.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {/* Source summary — the DSM this extracts from (idle preview + throughout). */}
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-[11px] text-gray-400">
            <div className="flex items-center justify-between">
              <span>Source</span>
              <span className="text-gray-200">{dsmUrl ? "Survey DSM" : "No DSM"}</span>
            </div>
            <div className="mt-1.5 flex items-center justify-between">
              <span>DSM CRS</span>
              <span className="max-w-[60%] truncate text-gray-200">
                {dsm?.crs ? `${dsm.crs}${plan.geographic ? " (geographic)" : " (projected)"}` : "—"}
              </span>
            </div>
          </div>

          {warning && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 p-2.5">
              <AlertTriangle size={13} className="mt-px shrink-0 text-amber-400" />
              <p className="text-[11px] leading-snug text-amber-300">{warning}</p>
            </div>
          )}

          {phase === "idle" && (
            <div className="flex flex-col gap-3">
              {/* Spacing — always entered in metres; the CRS bridge is applied at dispatch. */}
              <div className="flex flex-col gap-1.5">
                <Label className="text-[11px] text-gray-400">Grid spacing (metres)</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.5"
                  inputMode="decimal"
                  value={spacingInput}
                  onChange={(e) => setSpacingInput(e.target.value)}
                  className="h-8 bg-[#16181D] border-white/5 text-xs"
                />
                {dsmUrl && metresValid && (
                  <p className="text-[10px] leading-snug text-gray-500">{plan.note}</p>
                )}
              </div>

              {/* Format — one serialization per run. */}
              <div>
                <p className="mb-1.5 text-[10px] uppercase tracking-wide text-gray-500">Format</p>
                <div className="flex flex-wrap gap-1.5">
                  {FORMATS.map((f) => {
                    const on = selectedFormat === f;
                    return (
                      <button
                        key={f}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setSelectedFormat(f)}
                        className={`rounded-md border px-2.5 py-1 text-[11.5px] font-medium transition-colors ${
                          on
                            ? "border-[#C97A4E]/40 bg-[#C97A4E]/[0.12] text-[#C97A4E]"
                            : "border-white/10 bg-white/[0.02] text-gray-400 hover:text-gray-200"
                        }`}
                      >
                        {FORMAT_LABELS[f]}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-1 text-[9.5px] leading-snug text-gray-600">
                  GeoJSON = 3D points · CSV = x,y,z rows
                </p>
              </div>

              {/* Soft point-count guard (provisional estimate). */}
              {estimate !== null && estimate >= LARGE_POINT_COUNT && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 p-2.5">
                  <AlertTriangle size={13} className="mt-px shrink-0 text-amber-400" />
                  <p className="text-[11px] leading-snug text-amber-300">
                    ~{estimate.toLocaleString()} points at this spacing — the file may be 100+ MB and
                    slow to generate. Increase the spacing for a lighter grid.
                  </p>
                </div>
              )}

              {disabledReason ? (
                <p className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5 text-[11px] leading-snug text-gray-500">
                  {disabledReason}
                </p>
              ) : (
                estimate !== null && (
                  <p className="text-[10px] text-gray-600">
                    ≈ {estimate.toLocaleString()} points (estimate)
                  </p>
                )
              )}

              <Button size="sm" onClick={runExport} disabled={disabledReason !== null}>
                <Grid3x3 size={14} className="mr-1.5" />
                Extract {FORMAT_LABELS[selectedFormat]}
              </Button>
            </div>
          )}

          {busy && (
            <div className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-xs text-gray-300">
              <Loader2 size={14} className="animate-spin text-[#C97A4E]" />
              {phase === "dispatching" ? "Dispatching extract…" : "Sampling the DSM grid… (up to two minutes)"}
            </div>
          )}

          {phase === "ready" && link && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-1.5 text-xs text-emerald-400">
                <CheckCircle2 size={14} />
                Points ready
                {typeof link.pointCount === "number" && (
                  <span className="text-gray-400">· {link.pointCount.toLocaleString()} points</span>
                )}
              </div>
              <a
                href={link.url}
                download={`survey_points.${selectedFormat}`}
                className="flex items-center justify-between rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2 text-xs text-gray-200 transition-colors hover:border-[#C97A4E]/40 hover:bg-white/[0.04]"
              >
                <span className="font-medium">{FORMAT_LABELS[selectedFormat]}</span>
                <Download size={14} className="text-[#C97A4E]" />
              </a>
              <Button size="sm" variant="outline" onClick={runExport}>
                Extract again
              </Button>
            </div>
          )}

          {phase === "failed" && (
            <div className="flex flex-col gap-2">
              <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/10 p-2.5">
                <XCircle size={13} className="mt-px shrink-0 text-red-400" />
                <p className="text-[11px] leading-snug text-red-300">{error}</p>
              </div>
              <Button size="sm" variant="outline" onClick={runExport} disabled={!dsmUrl}>
                Try again
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
