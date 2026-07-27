"use client";

// On-demand contour generation — the trigger that completes "contours at any
// interval". A self-contained overlay, sibling to GridExportDialog /
// ChangeDetectDialog: same DSM-source resolution, dispatch → poll-manifest →
// URL-diff shape with a cancelledRef bail-on-close. It dispatches the
// `contour-generate` processor over the survey's DSM, polls
// manifest.layers.vectors for the FRESH contour entry (URL-diff on geojson_url vs
// a pre-dispatch snapshot — the SAME pattern GridExportDialog uses for
// layers.points), then pushes the manifest into the store: useLayerLifecycle's
// layer-build effect registers the contour vector (a geojson-lazy handle) and
// rebuilds layerControls, so TreePanel's availableContourIntervals picks up the
// new interval_m. Finally it selects that interval through the EXISTING wired
// render path (handleContourIntervalChange) so the isolines actually draw.
//
// Numbers are the server's (§4): this never traces contours itself. The interval
// is a VERTICAL elevation step (metres) — unlike grid-extract's horizontal
// spacing it needs NO metres→degrees CRS bridge, so there is no client-side
// sampling here (nothing provisional to mark).

import { useCallback, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Spline, XCircle } from "lucide-react";

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
import { generateSurvey, getManifest } from "@/lib/api/assetSvc";
import { ApiError } from "@/lib/api/client";
import { proxyGcsUrls, unproxyGcsUrl } from "@/components/viewer/shell/sceneHelpers";
import { useViewerActions } from "@/components/viewer/shell/viewerActions";
import {
  buildContourGeneratePayload,
  contoursUrlSet,
  freshContourVector,
} from "@/lib/viewer/contourGenerate";

const POLL_INTERVAL_MS = 3000;
// Tracing contours over a whole DSM is heavy (marching-squares across every
// elevation band of a large raster), so allow a long bound before we give up —
// a shorter one timed out on big surveys (§task ~120s).
const POLL_TIMEOUT_MS = 120_000;

const DEFAULT_INTERVAL_M = 5;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Phase = "idle" | "dispatching" | "computing" | "ready" | "failed";

interface ReadyContour {
  intervalM: number;
  featureCount: number;
}

export function ContourGenerateDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const storeApi = useViewerStoreApi();
  const actions = useViewerActions();
  const dsm = useViewerStore((s) =>
    s.manifest?.layers.terrain?.find((t) => t.surface_type === "dsm")
  );
  const dsmUrl = dsm?.raw_raster_url ?? null;

  // Interval as a string so the field can be cleared mid-edit; metres is derived.
  const [intervalInput, setIntervalInput] = useState(String(DEFAULT_INTERVAL_M));

  const [phase, setPhase] = useState<Phase>("idle");
  const [ready, setReady] = useState<ReadyContour | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Flipped true on close so an in-flight poll loop bails instead of setting
  // state on a hidden dialog (same pattern as GridExportDialog/ChangeDetectDialog).
  const cancelledRef = useRef(false);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (next) {
        cancelledRef.current = false;
      } else {
        cancelledRef.current = true;
        setPhase("idle");
        setReady(null);
        setError(null);
      }
      onOpenChange(next);
    },
    [onOpenChange]
  );

  const interval = Number(intervalInput);
  const intervalValid = Number.isFinite(interval) && interval > 0;

  // Blocked when there's no DSM to trace or the interval isn't a positive metre.
  const disabledReason = !dsmUrl
    ? "This survey has no DSM raster — contour generation needs a DSM to trace."
    : !intervalValid
      ? "Enter a contour interval greater than 0."
      : null;

  const runGenerate = useCallback(async () => {
    cancelledRef.current = false;
    setError(null);
    setReady(null);

    const state = storeApi.getState();
    const surveyId = state.surveyId;
    const liveDsm = state.manifest?.layers.terrain?.find((t) => t.surface_type === "dsm");
    const url = liveDsm?.raw_raster_url;
    const crs = liveDsm?.crs;

    if (!url) {
      setError("This survey has no DSM raster to trace contours from.");
      setPhase("failed");
      return;
    }

    const value = Number(intervalInput);
    if (!Number.isFinite(value) || value <= 0) {
      setError("Enter a contour interval greater than 0.");
      setPhase("failed");
      return;
    }

    setPhase("dispatching");
    // Snapshot the current contour URLs so the poll can tell the FRESH set from a
    // prior run's (store manifest + poll manifest are both /gcs-proxied).
    const before = contoursUrlSet(state.manifest?.layers.vectors);

    try {
      await generateSurvey(surveyId, {
        processor_type: "contour-generate",
        version: "v1",
        // intervals_m:[value] (NOT scalar interval_m) → role contours_<N>m, so
        // intervals coexist and the interval-select dropdown stays meaningful.
        payload: buildContourGeneratePayload({ url: unproxyGcsUrl(url), crs, intervalM: value }),
      });
    } catch (err) {
      if (cancelledRef.current) return;
      setError(err instanceof ApiError ? err.message : "Failed to dispatch contour generation.");
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
        const found = freshContourVector(manifest.layers.vectors, before);
        if (found) {
          // Push the fresh manifest: the layer-build effect registers the contour
          // vector + rebuilds layerControls, so availableContourIntervals picks up
          // interval_m — the SAME reactive path a reload uses.
          storeApi.getState().setManifest(manifest);
          const intervalM = found.intervalM ?? value;
          // Draw it through the wired render path. Deferred a macrotask so the
          // manifest rebuild AND ViewerCanvas's layerControlsRef sync (both
          // passive effects) have flushed before the handler reads them; without
          // the defer it would map over the pre-rebuild controls and find no
          // contour layer to show.
          setTimeout(() => {
            if (cancelledRef.current) return;
            actions.handleContourIntervalChange(intervalM);
          }, 0);
          setReady({ intervalM, featureCount: found.featureCount });
          setPhase("ready");
          return;
        }
      } catch {
        // Transient manifest read — keep polling until the deadline.
      }
    }
    if (!cancelledRef.current) {
      setError("Timed out waiting for contour generation. It may still finish — reopen to check.");
      setPhase("failed");
    }
  }, [storeApi, actions, intervalInput]);

  const busy = phase === "dispatching" || phase === "computing";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Generate contours</DialogTitle>
          <DialogDescription>
            Elevation isolines traced from this survey&apos;s DSM at a chosen vertical interval.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {/* Source summary — the DSM these are traced from (idle preview + throughout). */}
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-[11px] text-gray-400">
            <div className="flex items-center justify-between">
              <span>Source</span>
              <span className="text-gray-200">{dsmUrl ? "Survey DSM" : "No DSM"}</span>
            </div>
            <div className="mt-1.5 flex items-center justify-between">
              <span>DSM CRS</span>
              <span className="max-w-[60%] truncate text-gray-200">{dsm?.crs ?? "—"}</span>
            </div>
          </div>

          {phase === "idle" && (
            <div className="flex flex-col gap-3">
              {/* Interval — a VERTICAL elevation step; no CRS bridge (unlike grid spacing). */}
              <div className="flex flex-col gap-1.5">
                <Label className="text-[11px] text-gray-400">Contour interval (metres)</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.5"
                  inputMode="decimal"
                  value={intervalInput}
                  onChange={(e) => setIntervalInput(e.target.value)}
                  className="h-8 bg-[#16181D] border-white/5 text-xs"
                />
                <p className="text-[10px] leading-snug text-gray-500">
                  Vertical elevation step between isolines. Each interval is kept as its own set,
                  so you can generate several and switch between them.
                </p>
              </div>

              {disabledReason && (
                <p className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5 text-[11px] leading-snug text-gray-500">
                  {disabledReason}
                </p>
              )}

              <Button size="sm" onClick={runGenerate} disabled={disabledReason !== null}>
                <Spline size={14} className="mr-1.5" />
                Generate {intervalValid ? `${interval} m ` : ""}contours
              </Button>
            </div>
          )}

          {busy && (
            <div className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-xs text-gray-300">
              <Loader2 size={14} className="animate-spin text-[#C97A4E]" />
              {phase === "dispatching"
                ? "Dispatching contour generation…"
                : "Tracing isolines across the DSM… (up to two minutes)"}
            </div>
          )}

          {phase === "ready" && ready && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-1.5 text-xs text-emerald-400">
                <CheckCircle2 size={14} />
                {ready.intervalM} m contours ready
                <span className="text-gray-400">· {ready.featureCount.toLocaleString()} lines</span>
              </div>
              <p className="text-[10px] leading-snug text-gray-500">
                Drawn on the map — pick the interval in the Contour Interval selector to switch or
                hide it.
              </p>
              <Button size="sm" variant="outline" onClick={runGenerate}>
                Generate again
              </Button>
            </div>
          )}

          {phase === "failed" && (
            <div className="flex flex-col gap-2">
              <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/10 p-2.5">
                <XCircle size={13} className="mt-px shrink-0 text-red-400" />
                <p className="text-[11px] leading-snug text-red-300">{error}</p>
              </div>
              <Button size="sm" variant="outline" onClick={runGenerate} disabled={!dsmUrl}>
                Try again
              </Button>
            </div>
          )}

          {phase === "idle" && !dsmUrl && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 p-2.5">
              <AlertTriangle size={13} className="mt-px shrink-0 text-amber-400" />
              <p className="text-[11px] leading-snug text-amber-300">
                This survey has no processed DSM, so there is no surface to trace contours from.
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
