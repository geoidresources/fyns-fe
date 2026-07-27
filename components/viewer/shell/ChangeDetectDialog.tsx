"use client";

// AI change-detection trigger (P0, task 1). A self-contained overlay opened from
// the compare-mode surface (SurveyCompare) — sibling to GridExportDialog /
// CadExportDialog, same dispatch → poll-manifest → result shape with a
// cancelledRef bail-on-close. It dispatches the `change-detect` processor on the
// CURRENT survey (the "to" / newer epoch), referencing survey A (the "from" /
// older epoch, defaulted from the compare slice), then polls
// manifest.analytics.changes for the FRESH entry (URL-diff vs a pre-dispatch
// snapshot — the SAME pattern GridExportDialog uses for layers.points, but with a
// longer bound: change-detect is heavy).
//
// Numbers are the server's (§4): this never diffs the DSMs itself. The resolved
// DSM ArtifactRefs are built EXACTLY as GridExportDialog builds its `source`
// (unproxyGcsUrl + terrain.find(surface_type==="dsm")). The "to" DSM is the
// current survey's (from the store manifest); the "from" DSM is fetched with
// getManifest(A) — the store holds only the current survey's manifest.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Loader2,
  ScanSearch,
  XCircle,
} from "lucide-react";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useViewerStore, useViewerStoreApi } from "@/lib/viewer/state/store";
import { generateSurvey, getManifest, type Manifest, type TerrainLayer } from "@/lib/api/assetSvc";
import { ApiError } from "@/lib/api/client";
import { proxyGcsUrls, unproxyGcsUrl } from "@/components/viewer/shell/sceneHelpers";
import {
  buildChangeDetectPayload,
  changesUrlSet,
  freshChangeEntry,
  summarizeChangeEntry,
} from "@/lib/viewer/changeDetect";
import { useCompareSurveys } from "@/components/viewer/shell/hooks/useCompareSurveys";
import { formatSurveyDate } from "@/lib/utils";

const DEFAULT_THRESHOLD_M = 0.25;
const DEFAULT_MIN_AREA_M2 = 10;

const POLL_INTERVAL_MS = 3500;
// change-detect diffs two whole DSMs, masks, and polygonizes — much heavier than
// the inline exports, so a long bound before we call it timed out (§task ~180s).
const POLL_TIMEOUT_MS = 180_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Phase = "idle" | "dispatching" | "computing" | "ready" | "failed";

interface DetectResult {
  regionCount: number;
  cutVolumeM3: number;
  fillVolumeM3: number;
  netM3: number;
}

const findDsm = (m: Manifest | null | undefined): TerrainLayer | undefined =>
  m?.layers.terrain?.find((t) => t.surface_type === "dsm");

const fmtVol = (v: number): string =>
  `${Math.round(v).toLocaleString()} m³`;

export function ChangeDetectDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const storeApi = useViewerStoreApi();
  const surveyId = useViewerStore((s) => s.surveyId);
  const compareA = useViewerStore((s) => s.compareA);
  const projectId = useViewerStore((s) => s.manifest?.survey.project_id ?? null);
  const toDate = useViewerStore((s) => s.manifest?.survey.survey_date ?? null);
  const hasToDsm = useViewerStore((s) => !!findDsm(s.manifest)?.raw_raster_url);

  const { surveys, dateOf } = useCompareSurveys(projectId);

  // The "from" (reference / older / A) survey. Defaulted from compareA; the "to"
  // is always the CURRENT survey (the store manifest's), so the result lands on
  // this survey's manifest and both the immediate render and the on-reload render
  // (task 4) read the same analytics.changes.
  const [fromId, setFromId] = useState<string | null>(compareA);
  const [thresholdInput, setThresholdInput] = useState(String(DEFAULT_THRESHOLD_M));
  const [minAreaInput, setMinAreaInput] = useState(String(DEFAULT_MIN_AREA_M2));

  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<DetectResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Flipped true on close so an in-flight poll loop bails instead of setting
  // state on a hidden dialog (same pattern as GridExportDialog/CadExportDialog).
  const cancelledRef = useRef(false);

  // Re-seed the "from" pick from the compare slice on each OPEN transition
  // (render-phase reset — the repo's approved pattern, since an effect-setState
  // cascades a re-render under React Compiler; see useCompareSurveys). While open,
  // the user's own pick is preserved.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setFromId(compareA);
  }

  // Bail any in-flight poll if the dialog unmounts (e.g. the user exits compare
  // mode mid-detect) — mirrors the on-close cancel, for the unmount path.
  useEffect(() => {
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (next) {
        cancelledRef.current = false;
      } else {
        cancelledRef.current = true;
        setPhase("idle");
        setResult(null);
        setError(null);
      }
      onOpenChange(next);
    },
    [onOpenChange]
  );

  const thresholdM = Number(thresholdInput);
  const minAreaM2 = Number(minAreaInput);
  const thresholdValid = Number.isFinite(thresholdM) && thresholdM > 0;
  const minAreaValid = Number.isFinite(minAreaM2) && minAreaM2 >= 0;

  // Sibling epochs the user can pick as "from" — everything except the current
  // ("to") survey. Ordered oldest → newest by useCompareSurveys.
  const fromOptions = (surveys ?? []).filter((s) => s.id !== surveyId);

  const disabledReason = !hasToDsm
    ? "The current survey has no DSM — change-detect needs a DSM on both epochs."
    : !fromId
      ? "Pick a reference (from) survey to compare against."
      : fromId === surveyId
        ? "The reference survey must differ from the current survey."
        : !thresholdValid
          ? "Enter a change threshold greater than 0."
          : !minAreaValid
            ? "Enter a minimum area of 0 or more."
            : null;

  const runDetect = useCallback(async () => {
    cancelledRef.current = false;
    setError(null);
    setResult(null);

    const state = storeApi.getState();
    const currentSurveyId = state.surveyId;
    const fromSurveyId = fromId;
    const threshold = Number(thresholdInput);
    const minArea = Number(minAreaInput);

    if (!fromSurveyId || fromSurveyId === currentSurveyId) {
      setError("Pick a reference (from) survey different from the current one.");
      setPhase("failed");
      return;
    }
    if (!(threshold > 0) || !(minArea >= 0)) {
      setError("Enter a threshold greater than 0 and a non-negative minimum area.");
      setPhase("failed");
      return;
    }

    // "to" DSM — the CURRENT survey's, from the store manifest (already /gcs
    // proxied; unproxyGcsUrl restores the canonical URL the processor wants).
    const toDsm = findDsm(state.manifest);
    if (!toDsm?.raw_raster_url) {
      setError("The current survey has no DSM raster to diff.");
      setPhase("failed");
      return;
    }

    setPhase("dispatching");

    // "from" DSM — the store holds only the current survey's manifest, so fetch
    // survey A's manifest for its DSM (its raw_raster_url is already canonical).
    let fromManifest: Manifest;
    try {
      fromManifest = await getManifest(fromSurveyId);
    } catch (err) {
      if (cancelledRef.current) return;
      setError(err instanceof ApiError ? err.message : "Couldn't load the reference survey.");
      setPhase("failed");
      return;
    }
    if (cancelledRef.current) return;

    const fromDsm = findDsm(fromManifest);
    if (!fromDsm?.raw_raster_url) {
      setError("The reference survey has no DSM raster to diff against.");
      setPhase("failed");
      return;
    }

    const payload = buildChangeDetectPayload({
      fromUrl: unproxyGcsUrl(fromDsm.raw_raster_url),
      fromCrs: fromDsm.crs,
      toUrl: unproxyGcsUrl(toDsm.raw_raster_url),
      toCrs: toDsm.crs,
      thresholdM: threshold,
      minAreaM2: minArea,
    });

    // Snapshot the current change URLs so the poll can tell the FRESH entry from
    // a prior run's (store manifest + poll manifest are both /gcs-proxied).
    const before = changesUrlSet(state.manifest?.analytics?.changes);

    try {
      await generateSurvey(currentSurveyId, {
        processor_type: "change-detect",
        version: "v1",
        payload,
      });
    } catch (err) {
      if (cancelledRef.current) return;
      setError(err instanceof ApiError ? err.message : "Failed to dispatch change-detect.");
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
        const manifest = proxyGcsUrls(await getManifest(currentSurveyId));
        if (cancelledRef.current) return;
        const fresh = freshChangeEntry(manifest.analytics?.changes, before);
        if (fresh) {
          // Push the fresh manifest into the store: useChangeLayer's fetch effect
          // then loads + renders the polygons and the Changes card populates —
          // the SAME reactive path a reload uses (task 4), so success just means
          // "the store now knows".
          storeApi.getState().setManifest(manifest);
          storeApi.getState().setChangeLayerVisible(true);
          const s = summarizeChangeEntry(fresh);
          setResult({
            regionCount: s.regionCount,
            cutVolumeM3: s.cutVolumeM3,
            fillVolumeM3: s.fillVolumeM3,
            netM3: s.netM3,
          });
          setPhase("ready");
          return;
        }
      } catch {
        // Transient manifest read — keep polling until the deadline.
      }
    }
    if (!cancelledRef.current) {
      setError("Timed out waiting for change-detect. It may still finish — reopen to check.");
      setPhase("failed");
    }
  }, [storeApi, fromId, thresholdInput, minAreaInput]);

  const busy = phase === "dispatching" || phase === "computing";

  const fromLabel = fromId ? (dateOf.get(fromId) ? formatSurveyDate(dateOf.get(fromId)!) : "Survey A") : "—";
  const toLabel = toDate ? formatSurveyDate(toDate) : "Current survey";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Detect changes</DialogTitle>
          <DialogDescription>
            Classified cut / fill change regions between two survey epochs&apos; DSMs.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {/* Epoch pair — from (reference) → to (current). */}
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-[11px] text-gray-400">
            <div className="mb-2 flex items-center gap-1.5 text-gray-200">
              <span className="text-gray-400">From</span>
              <span className="font-medium">{fromLabel}</span>
              <ArrowRight size={12} className="shrink-0 text-gray-500" />
              <span className="text-gray-400">to</span>
              <span className="font-medium">{toLabel}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span>Reference (from)</span>
              <Select value={fromId ?? undefined} onValueChange={setFromId}>
                <SelectTrigger className="h-7 w-[150px]" aria-label="Reference survey">
                  <SelectValue placeholder="Select survey" />
                </SelectTrigger>
                <SelectContent>
                  {fromOptions.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {formatSurveyDate(s.survey_date)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="mt-1.5 flex items-center justify-between">
              <span>Current (to)</span>
              <span className="max-w-[60%] truncate text-gray-200">
                {toLabel}
                {!hasToDsm && <span className="text-amber-400"> · no DSM</span>}
              </span>
            </div>
          </div>

          {phase === "idle" && (
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label className="text-[11px] text-gray-400">Change threshold (metres)</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.05"
                  inputMode="decimal"
                  value={thresholdInput}
                  onChange={(e) => setThresholdInput(e.target.value)}
                  className="h-8 bg-[#16181D] border-white/5 text-xs"
                />
                <p className="text-[10px] leading-snug text-gray-500">
                  Minimum vertical Δ (m) to count as change — smaller catches finer movement.
                </p>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label className="text-[11px] text-gray-400">Minimum region area (m²)</Label>
                <Input
                  type="number"
                  min="0"
                  step="1"
                  inputMode="decimal"
                  value={minAreaInput}
                  onChange={(e) => setMinAreaInput(e.target.value)}
                  className="h-8 bg-[#16181D] border-white/5 text-xs"
                />
                <p className="text-[10px] leading-snug text-gray-500">
                  Drops speckle — regions below this footprint are ignored.
                </p>
              </div>

              {disabledReason && (
                <p className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5 text-[11px] leading-snug text-gray-500">
                  {disabledReason}
                </p>
              )}

              <Button size="sm" onClick={runDetect} disabled={disabledReason !== null}>
                <ScanSearch size={14} className="mr-1.5" />
                Detect changes
              </Button>
            </div>
          )}

          {busy && (
            <div className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-xs text-gray-300">
              <Loader2 size={14} className="animate-spin text-[#C97A4E]" />
              {phase === "dispatching"
                ? "Dispatching change-detect…"
                : "Diffing DSMs and polygonizing changes… (this can take a few minutes)"}
            </div>
          )}

          {phase === "ready" && result && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-1.5 text-xs text-emerald-400">
                <CheckCircle2 size={14} />
                {result.regionCount} region{result.regionCount === 1 ? "" : "s"} detected
              </div>
              <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2 font-mono text-[12px]">
                <span className="text-gray-400">
                  cut <span style={{ color: "#EF4444" }}>{fmtVol(result.cutVolumeM3)}</span>
                </span>
                <span className="text-gray-600">·</span>
                <span className="text-gray-400">
                  fill <span style={{ color: "#3B82F6" }}>{fmtVol(result.fillVolumeM3)}</span>
                </span>
              </div>
              <p className="text-[10px] leading-snug text-gray-500">
                Rendered on the map — see the Changes card for per-region detail.
              </p>
              <Button size="sm" variant="outline" onClick={runDetect}>
                Detect again
              </Button>
            </div>
          )}

          {phase === "failed" && (
            <div className="flex flex-col gap-2">
              <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/10 p-2.5">
                <XCircle size={13} className="mt-px shrink-0 text-red-400" />
                <p className="text-[11px] leading-snug text-red-300">{error}</p>
              </div>
              <Button size="sm" variant="outline" onClick={runDetect} disabled={disabledReason !== null}>
                Try again
              </Button>
            </div>
          )}

          {phase === "idle" && !hasToDsm && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 p-2.5">
              <AlertTriangle size={13} className="mt-px shrink-0 text-amber-400" />
              <p className="text-[11px] leading-snug text-amber-300">
                The current survey has no processed DSM, so there is nothing to diff.
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
