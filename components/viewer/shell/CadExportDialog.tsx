"use client";

// CAD export flow (viewer-shell Export & reports, D8). A self-contained overlay
// opened from the TreePanel dropdown — NOT a module or rail entry. It turns the
// survey's measurements into a GeoJSON FeatureCollection reprojected into the
// working CRS (projected metres — a lon/lat DXF is useless in CAD), dispatches
// the generic export-cad processor via POST /surveys/:id/generate, polls the
// manifest for the resulting `layers.exports` bundle, and surfaces a download
// link per format.
//
// Numbers are the server's: this never computes areas/volumes. The only client
// math is the WGS84 → working-CRS reprojection of geometry (proj4, §4.6), which
// is a coordinate transform, not a measurement.

import { useCallback, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, Loader2, XCircle } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useViewerStore, useViewerStoreApi } from "@/lib/viewer/state/store";
import { generateSurvey, getManifest, type ExportLayer } from "@/lib/api/assetSvc";
import { ApiError } from "@/lib/api/client";
import { proxyGcsUrls } from "@/components/viewer/shell/sceneHelpers";
import { buildMeasurementFeatureCollection } from "@/lib/viewer/measurementFeatures";
import { getWorkingTransform } from "@/lib/viewer/projection";

// The formats we request. DXF is geometry-only; LandXML is Point-features-only
// (CgPoints, z from the 3rd coordinate); CSV keeps a flat row per feature.
const FORMATS = ["dxf", "landxml", "csv"] as const;

const FORMAT_LABELS: Record<string, string> = {
  dxf: "DXF",
  landxml: "LandXML",
  csv: "CSV",
  geojson: "GeoJSON",
  shp: "Shapefile",
};

// Download filename extension per format (landxml → .xml, shp → .zip bundle).
const FORMAT_EXT: Record<string, string> = {
  dxf: "dxf",
  landxml: "xml",
  csv: "csv",
  geojson: "geojson",
  shp: "zip",
};

const POLL_INTERVAL_MS = 2500;
const POLL_TIMEOUT_MS = 90_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Phase = "idle" | "dispatching" | "computing" | "ready" | "failed";

interface DownloadLink {
  format: string;
  url: string;
}

/** The set of every export-cad output URL currently on the manifest — snapshotted
 * before dispatch so the poll can tell the FRESH bundle from a prior run's. */
function exportCadUrlSet(exports: ExportLayer[] | null | undefined): Set<string> {
  const urls = new Set<string>();
  for (const e of exports ?? []) {
    if (e.processor_type !== "export-cad" || !e.output_urls) continue;
    for (const u of Object.values(e.output_urls)) if (u) urls.add(u);
  }
  return urls;
}

/** Pull the first export-cad bundle that carries at least one URL not present in
 * `before` (handles replace, append, and re-run-with-new-URLs manifest shapes). */
function freshExportLinks(
  exports: ExportLayer[] | null | undefined,
  before: Set<string>
): DownloadLink[] | null {
  for (const e of exports ?? []) {
    if (e.processor_type !== "export-cad" || !e.output_urls) continue;
    const out = e.output_urls;
    const order = e.formats?.length ? e.formats : Object.keys(out);
    const links = order.filter((f) => out[f]).map((f) => ({ format: f, url: out[f] }));
    if (links.some((l) => !before.has(l.url))) return links;
  }
  return null;
}

export function CadExportDialog({
  open,
  onOpenChange,
  measurementId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set, export ONLY this measurement's boundary (per-stockpile CAD);
   * otherwise every measurement on the survey. */
  measurementId?: string;
}) {
  const storeApi = useViewerStoreApi();
  const workingCrs = useViewerStore((s) => s.manifest?.survey.working_crs ?? null);
  const featureCount = useViewerStore((s) =>
    measurementId
      ? s.measurements.some((m) => m.id === measurementId && m.geometry)
        ? 1
        : 0
      : s.measurements.filter((m) => m.geometry).length
  );
  const scopedName = useViewerStore((s) =>
    measurementId ? s.measurements.find((m) => m.id === measurementId)?.name ?? null : null
  );
  const downloadBase = scopedName
    ? scopedName.replace(/[^\w-]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase() || "stockpile"
    : "measurements";

  const [phase, setPhase] = useState<Phase>("idle");
  const [links, setLinks] = useState<DownloadLink[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  // Which formats to request. Sticky across opens so a repeat export keeps the
  // user's choice; defaults to all three.
  const [selectedFormats, setSelectedFormats] = useState<string[]>([...FORMATS]);
  const toggleFormat = useCallback(
    (f: string) =>
      setSelectedFormats((prev) => (prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f])),
    []
  );
  // Flipped true on close so an in-flight poll loop bails instead of setting
  // state on an unmounted/hidden dialog.
  const cancelledRef = useRef(false);

  // Reset on close (and cancel any in-flight poll) in the open-change EVENT — not
  // an effect — so the next open starts clean without a render-time setState.
  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (next) {
        cancelledRef.current = false;
      } else {
        cancelledRef.current = true;
        setPhase("idle");
        setLinks([]);
        setError(null);
        setWarning(null);
      }
      onOpenChange(next);
    },
    [onOpenChange]
  );

  const runExport = useCallback(async () => {
    cancelledRef.current = false;
    setError(null);
    setWarning(null);
    setLinks([]);
    setPhase("dispatching");

    const state = storeApi.getState();
    const surveyId = state.surveyId;
    const crs = state.manifest?.survey.working_crs?.trim() || null;
    const measurements = measurementId
      ? state.measurements.filter((m) => m.id === measurementId)
      : state.measurements;

    // Resolve the projection: working CRS → projected metres. If there is no
    // working CRS, or proj4 can't resolve a def for it, fall back to geographic
    // EPSG:4326 (lon/lat degrees) and warn — a geographic CAD file is degraded
    // but honest about its CRS (§5 guard).
    let sourceCrs = "EPSG:4326";
    let forward: ((lonLat: [number, number]) => [number, number]) | undefined;
    if (crs) {
      const transform = await getWorkingTransform(crs);
      if (transform) {
        sourceCrs = crs;
        forward = transform.forward;
      } else {
        setWarning(
          `Couldn't resolve a projection for ${crs} — exporting geographic lon/lat (degrees), not metres.`
        );
      }
    } else {
      setWarning("This survey has no working CRS — exporting geographic lon/lat (degrees), not metres.");
    }
    if (cancelledRef.current) return;

    const fc = buildMeasurementFeatureCollection(measurements, forward);
    if (fc.features.length === 0) {
      setError("No measurements with geometry to export.");
      setPhase("failed");
      return;
    }

    const before = exportCadUrlSet(state.manifest?.layers.exports);

    try {
      await generateSurvey(surveyId, {
        processor_type: "export-cad",
        version: "v1",
        payload: {
          source: { inline: fc },
          source_crs: sourceCrs,
          formats: selectedFormats,
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
        const found = freshExportLinks(manifest.layers.exports, before);
        if (found && found.length) {
          setLinks(found);
          setPhase("ready");
          return;
        }
      } catch {
        // Transient manifest read — keep polling until the deadline.
      }
    }
    if (!cancelledRef.current) {
      setError("Timed out waiting for the export. It may still finish — reopen to check.");
      setPhase("failed");
    }
  }, [storeApi, measurementId, selectedFormats]);

  const busy = phase === "dispatching" || phase === "computing";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>CAD export</DialogTitle>
          <DialogDescription>
            {measurementId
              ? "DXF, LandXML and CSV for this measurement's boundary."
              : "DXF, LandXML and CSV built from this survey's measurements."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {/* Target CRS / geometry summary (idle preview + throughout). */}
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-[11px] text-gray-400">
            <div className="flex items-center justify-between">
              <span>{measurementId ? "Measurement" : "Measurements"}</span>
              <span className="max-w-[60%] truncate text-gray-200">
                {measurementId ? (scopedName ?? featureCount) : featureCount}
              </span>
            </div>
            <div className="mt-1.5 flex items-center justify-between">
              <span>Target CRS</span>
              <span className="text-gray-200">
                {workingCrs ? `${workingCrs} (metres)` : "EPSG:4326 (degrees)"}
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
            <div className="flex flex-col gap-2.5">
              <div>
                <p className="mb-1.5 text-[10px] uppercase tracking-wide text-gray-500">Formats to export</p>
                <div className="flex flex-wrap gap-1.5">
                  {FORMATS.map((f) => {
                    const on = selectedFormats.includes(f);
                    return (
                      <button
                        key={f}
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggleFormat(f)}
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
                  DXF = all geometry · LandXML = points only · CSV = coordinate table
                </p>
              </div>
              <Button
                size="sm"
                onClick={runExport}
                disabled={featureCount === 0 || selectedFormats.length === 0}
              >
                <Download size={14} className="mr-1.5" />
                {selectedFormats.length === 0
                  ? "Pick a format"
                  : `Export ${FORMATS.filter((f) => selectedFormats.includes(f))
                      .map((f) => FORMAT_LABELS[f])
                      .join(" · ")}`}
              </Button>
            </div>
          )}

          {busy && (
            <div className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-xs text-gray-300">
              <Loader2 size={14} className="animate-spin text-[#C97A4E]" />
              {phase === "dispatching" ? "Dispatching export…" : "Generating deliverables… (up to a minute)"}
            </div>
          )}

          {phase === "ready" && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-1.5 text-xs text-emerald-400">
                <CheckCircle2 size={14} />
                Export ready
              </div>
              <div className="flex flex-col gap-1.5">
                {links.map((link) => (
                  <a
                    key={link.format}
                    href={link.url}
                    download={`${downloadBase}.${FORMAT_EXT[link.format] ?? link.format}`}
                    className="flex items-center justify-between rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2 text-xs text-gray-200 transition-colors hover:border-[#C97A4E]/40 hover:bg-white/[0.04]"
                  >
                    <span className="font-medium">{FORMAT_LABELS[link.format] ?? link.format.toUpperCase()}</span>
                    <Download size={14} className="text-[#C97A4E]" />
                  </a>
                ))}
              </div>
              <Button size="sm" variant="outline" onClick={runExport}>
                Export again
              </Button>
            </div>
          )}

          {phase === "failed" && (
            <div className="flex flex-col gap-2">
              <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/10 p-2.5">
                <XCircle size={13} className="mt-px shrink-0 text-red-400" />
                <p className="text-[11px] leading-snug text-red-300">{error}</p>
              </div>
              <Button size="sm" variant="outline" onClick={runExport}>
                Try again
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
