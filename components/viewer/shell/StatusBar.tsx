"use client";

// Zone 6 — StatusBar + ScaleBar + CRSDialog (viewer-shell §4.6, rebuild). The
// docked h-6 bar spanning grid columns 2–3, replacing the retired
// ViewerStatusBar overlay. It keeps the two proven listener patterns:
//   - cursor pick @100 ms (ScreenSpaceEventHandler MOUSE_MOVE, throttled),
//   - camera settle (percentageChanged=0.05, `changed` + `moveEnd`).
//
// LEFT   projected cursor readout `N … E … m  Z … m (datum)` through the
//        working-CRS transform (D5, lib/viewer/projection.ts), degrading to
//        LAT/LNG when no definition resolves — never blank.
// CENTER CRS chip `EPSG:… · datum` (accent) opening the CRSDialog.
// RIGHT  ScaleBar (normative recipe below), ALT, north arrow + heading
//        (ported from ViewerStatusBar.tsx:108-118), survey date.
//
// All readouts are font-mono tabular-nums per §8 (IBM Plex Mono is --font-mono).

import React, { useEffect, useRef, useState } from "react";
import {
  Cartesian2,
  Cartesian3,
  Math as CesiumMath,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
} from "cesium";
import { Navigation2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  pickScenePosition,
  toLngLatHeight,
  type LngLatHeight,
} from "@/lib/viewer/measure";
import {
  getWorkingTransform,
  type WorkingTransform,
} from "@/lib/viewer/projection";
import { useViewerStore } from "@/lib/viewer/state/store";
import { useCesiumViewer } from "@/lib/viewer/state/cesiumContext";

const CURSOR_SAMPLE_MS = 100;
const SCALE_SAMPLE_MS = 100;

// ---------------------------------------------------------------- formatting

/** Thousands-grouped, exactly 2 dp (§4.6: `N 6,812,345.21`). Deterministic
 * locale so the readout never varies with browser language. */
function fmtGrouped2(n: number): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatAltitude(heightMeters: number): string {
  return heightMeters >= 10000
    ? `${(heightMeters / 1000).toFixed(1)} km`
    : `${Math.round(heightMeters)} m`;
}

/** Largest "nice" length {1,2,5}×10^k that is ≤ maxMeters (§4.6 ScaleBar). */
function niceFloor(maxMeters: number): number {
  if (!(maxMeters > 0) || !Number.isFinite(maxMeters)) return 0;
  const k = Math.floor(Math.log10(maxMeters));
  const base = Math.pow(10, k);
  const m = maxMeters / base;
  return (m >= 5 ? 5 : m >= 2 ? 2 : 1) * base;
}

function scaleLabel(meters: number): string {
  if (meters >= 1000) {
    const km = meters / 1000;
    return `${km.toLocaleString("en-US", { maximumFractionDigits: 2 })} km`;
  }
  return `${meters.toLocaleString("en-US", { maximumFractionDigits: 2 })} m`;
}

// ------------------------------------------------------------------ ScaleBar

/** §4.6 normative: on camera settle, depth-pick two points at (w/2±64, h−80);
 * metersPerPixel = distance/128; render the largest nice {1,2,5}×10^k length
 * whose pixel width ≤ 120 (mathematically ≥ 48px follows); hide when either
 * pick misses. Throttled to 100 ms. */
function ScaleBar() {
  const { viewerRef, viewerReady } = useCesiumViewer();
  const [bar, setBar] = useState<{ widthPx: number; label: string } | null>(null);
  const lastSampleRef = useRef(0);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewerReady || !viewer || viewer.isDestroyed()) return;

    const update = () => {
      const now = performance.now();
      if (now - lastSampleRef.current < SCALE_SAMPLE_MS) return;
      lastSampleRef.current = now;
      if (viewer.isDestroyed()) return;

      const canvas = viewer.scene.canvas;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w < 160 || h < 100) {
        setBar(null);
        return;
      }
      const y = h - 80;
      const a = pickScenePosition(viewer, new Cartesian2(w / 2 - 64, y));
      const b = pickScenePosition(viewer, new Cartesian2(w / 2 + 64, y));
      if (!a || !b) {
        setBar(null);
        return;
      }
      const metersPerPixel = Cartesian3.distance(a, b) / 128;
      if (!(metersPerPixel > 0) || !Number.isFinite(metersPerPixel)) {
        setBar(null);
        return;
      }
      const nice = niceFloor(120 * metersPerPixel);
      if (nice <= 0) {
        setBar(null);
        return;
      }
      const widthPx = nice / metersPerPixel;
      if (widthPx < 48) {
        setBar(null); // unreachable by construction; guard against degenerate picks
        return;
      }
      setBar({ widthPx, label: scaleLabel(nice) });
    };

    viewer.camera.percentageChanged = 0.05;
    viewer.camera.changed.addEventListener(update);
    viewer.camera.moveEnd.addEventListener(update);
    update();

    return () => {
      if (viewer.isDestroyed()) return;
      viewer.camera.changed.removeEventListener(update);
      viewer.camera.moveEnd.removeEventListener(update);
    };
  }, [viewerRef, viewerReady]);

  if (!bar) return null;

  return (
    <span className="flex items-center gap-1.5" title="Ground distance at screen center">
      <span
        aria-hidden
        className="h-[5px] border-x border-b border-gray-400/80"
        style={{ width: `${Math.round(bar.widthPx)}px` }}
      />
      <span>{bar.label}</span>
    </span>
  );
}

// ----------------------------------------------------------------- CRSDialog

function crsSourceNote(transform: WorkingTransform | null): string {
  switch (transform?.source) {
    case "manifest":
      return "Definition supplied by the survey manifest.";
    case "utm":
      return "Definition computed from the standard WGS84 / UTM zone.";
    case "curated":
      return "Definition from GEOID's curated CRS table.";
    case "epsg.io":
      return "Definition fetched from epsg.io and cached locally.";
    default:
      return "No projection definition resolved — coordinates shown as geographic LAT/LNG.";
  }
}

function CRSDialog({
  open,
  onOpenChange,
  workingCrs,
  verticalDatum,
  crsLabel,
  units,
  transform,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workingCrs: string;
  verticalDatum: string | null;
  crsLabel: string | null;
  units: string;
  transform: WorkingTransform | null;
}) {
  const rows: { label: string; value: string }[] = [
    { label: "Code", value: transform?.code ? `EPSG:${transform.code}` : workingCrs },
    { label: "Name", value: crsLabel ?? workingCrs },
    { label: "Units", value: units },
    { label: "Vertical datum", value: verticalDatum ?? "—" },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Coordinate reference system</DialogTitle>
          <DialogDescription>
            Positions in this survey are reported in its working CRS.
          </DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[7.5rem_1fr] gap-x-3 gap-y-2 text-xs">
          {rows.map((r) => (
            <React.Fragment key={r.label}>
              <dt className="text-gray-500">{r.label}</dt>
              <dd className="font-mono tabular-nums text-gray-200">{r.value}</dd>
            </React.Fragment>
          ))}
        </dl>
        <p className="text-[11px] leading-relaxed text-gray-500">
          {crsSourceNote(transform)} Heights are ellipsoidal — the geoid offset
          for the vertical datum is not applied in Phase 1.
        </p>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ StatusBar

interface CameraReadout {
  headingDegrees: number;
  heightMeters: number;
}

export function StatusBar() {
  const { viewerRef, viewerReady } = useCesiumViewer();
  const manifest = useViewerStore((s) => s.manifest);
  const project = useViewerStore((s) => s.project);

  const workingCrs = manifest?.survey.working_crs ?? null;
  const verticalDatum = manifest?.survey.vertical_datum ?? null;
  const surveyDate = manifest?.survey.survey_date;
  const units = project?.crs_units ?? "m";

  // The resolved forward transform, keyed by the CRS it was resolved FOR: a
  // survey/CRS change derives back to null until the new resolution lands (no
  // synchronous setState reset needed). Failure keeps it null → the readout
  // stays on LAT/LNG, never blank (D5).
  const [resolved, setResolved] = useState<{
    crs: string;
    transform: WorkingTransform | null;
  } | null>(null);
  const [cursor, setCursor] = useState<LngLatHeight | null>(null);
  const [camera, setCamera] = useState<CameraReadout | null>(null);
  const [crsOpen, setCrsOpen] = useState(false);
  const lastSampleRef = useRef(0);

  useEffect(() => {
    if (!workingCrs) return;
    let alive = true;
    getWorkingTransform(workingCrs)
      .then((t) => {
        if (alive) setResolved({ crs: workingCrs, transform: t });
      })
      .catch(() => {
        if (alive) setResolved({ crs: workingCrs, transform: null });
      });
    return () => {
      alive = false;
    };
  }, [workingCrs]);

  const transform =
    resolved && workingCrs && resolved.crs === workingCrs ? resolved.transform : null;

  // Cursor position — throttled depth-buffer pick under the mouse (the proven
  // 100 ms pattern from the retired ViewerStatusBar).
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewerReady || !viewer || viewer.isDestroyed()) return;

    const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((movement: { endPosition: Cartesian2 }) => {
      const now = performance.now();
      if (now - lastSampleRef.current < CURSOR_SAMPLE_MS) return;
      lastSampleRef.current = now;
      if (viewer.isDestroyed()) return;
      const position = pickScenePosition(viewer, movement.endPosition);
      setCursor(position ? toLngLatHeight(position) : null);
    }, ScreenSpaceEventType.MOUSE_MOVE);

    return () => handler.destroy();
  }, [viewerRef, viewerReady]);

  // Camera heading + altitude — settle listeners (changed@0.05 + moveEnd).
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewerReady || !viewer || viewer.isDestroyed()) return;

    const update = () => {
      if (viewer.isDestroyed()) return;
      setCamera({
        headingDegrees: CesiumMath.toDegrees(viewer.camera.heading),
        heightMeters: viewer.camera.positionCartographic.height,
      });
    };
    viewer.camera.percentageChanged = 0.05;
    viewer.camera.changed.addEventListener(update);
    viewer.camera.moveEnd.addEventListener(update);
    update();

    return () => {
      if (viewer.isDestroyed()) return;
      viewer.camera.changed.removeEventListener(update);
      viewer.camera.moveEnd.removeEventListener(update);
    };
  }, [viewerRef, viewerReady]);

  const heading = camera ? ((camera.headingDegrees % 360) + 360) % 360 : 0;

  // Projected [E, N] for the cursor, when a transform resolved. One proj4
  // forward per throttled sample (≤10 Hz) — cheap, zone-local (§3.6).
  let projected: { e: number; n: number } | null = null;
  if (cursor && transform) {
    try {
      const [e, n] = transform.forward([cursor.longitude, cursor.latitude]);
      if (Number.isFinite(e) && Number.isFinite(n)) projected = { e, n };
    } catch {
      projected = null; // out-of-domain forward → fall back to LAT/LNG
    }
  }

  return (
    <div className="relative z-30 flex h-6 min-w-0 items-center justify-between gap-4 border-t border-white/[0.08] bg-[#111114]/85 px-3 font-mono text-[10px] tabular-nums text-gray-400 backdrop-blur-md">
      {/* LEFT — projected cursor readout, LAT/LNG fallback (never blank). */}
      <div className="flex min-w-0 items-center gap-3">
        {!viewerReady ? null : cursor ? (
          projected ? (
            <>
              <span className="truncate">
                N {fmtGrouped2(projected.n)}&ensp;E {fmtGrouped2(projected.e)} {units}
              </span>
              <span
                className="text-gray-500"
                title="Heights are ellipsoidal — geoid offset for the vertical datum is not applied in Phase 1"
              >
                Z {cursor.height.toFixed(1)} m{verticalDatum ? ` (${verticalDatum})` : ""}
              </span>
            </>
          ) : (
            <>
              <span className="truncate">
                LAT {cursor.latitude.toFixed(5)}° · LNG {cursor.longitude.toFixed(5)}°
              </span>
              <span
                className="text-gray-500"
                title="Heights are ellipsoidal — geoid offset for the vertical datum is not applied in Phase 1"
              >
                ELEV {cursor.height.toFixed(1)} m
              </span>
            </>
          )
        ) : (
          <span className="truncate text-gray-600">
            Move the cursor over the site for coordinates
          </span>
        )}
      </div>

      {/* CENTER — CRS chip → CRSDialog. Absolutely centered so the flanking
          readouts never push it around. */}
      {workingCrs && (
        <>
          <button
            type="button"
            onClick={() => setCrsOpen(true)}
            title="Coordinate reference system"
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-[4px] bg-[#C97A4E]/10 px-1.5 py-px text-[#C97A4E] transition-colors hover:bg-[#C97A4E]/20"
          >
            {transform?.code ? `EPSG:${transform.code}` : workingCrs}
            {verticalDatum ? ` · ${verticalDatum}` : ""}
          </button>
          <CRSDialog
            open={crsOpen}
            onOpenChange={setCrsOpen}
            workingCrs={workingCrs}
            verticalDatum={verticalDatum}
            crsLabel={project?.crs_label ?? null}
            units={units}
            transform={transform}
          />
        </>
      )}

      {/* RIGHT — scale bar, ALT, north arrow + heading, survey date. */}
      <div className="flex shrink-0 items-center gap-3">
        <ScaleBar />
        {camera && <span>ALT {formatAltitude(camera.heightMeters)}</span>}
        {viewerReady && (
          <span className="flex items-center gap-1" title="North">
            {/* Navigation2 is a symmetric north-pointing arrowhead (points
                straight up at 0°); plain Navigation points up-RIGHT, so its
                rotation misreads the heading by ~45°. */}
            <Navigation2
              size={10}
              className="text-[#C97A4E]"
              style={{ transform: `rotate(${-heading}deg)` }}
            />
            {heading.toFixed(0).padStart(3, "0")}°
          </span>
        )}
        {surveyDate && <span className="text-gray-500">{surveyDate}</span>}
      </div>
    </div>
  );
}
