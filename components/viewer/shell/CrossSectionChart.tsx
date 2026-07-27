"use client";

// Cross-section elevation chart (Survey/CAD exports bundle). A pure
// presentational component fed by the profile-extract sidecar JSON: it fetches
// `{ samples:[{distance_m,x,y,z}], length_m }` and hand-rolls an inline-SVG
// station(x)-vs-elevation(z) area+line chart — same idiom as ComparisonCard's
// sparkline (no chart lib). Mounted by FeatureInspector for the SELECTED
// cross_section measurement once its result carries a `profile_url`.
//
// The frontend never computes elevations (§4): every z here is the server's.
// `z === null` marks DSM nodata and renders as a GAP (the line breaks; the value
// is never plotted as 0). Lengths/elevations format through the row's unit
// system so imperial users read feet.

import * as React from "react";
import { Activity, AlertTriangle, Loader2 } from "lucide-react";

import { proxyGcsUrls } from "@/components/viewer/shell/sceneHelpers";
import { convertForDisplay, type UnitSystem } from "@/lib/viewer/units";
import { parseProfileDoc, profileChartGeometry, type ProfileDoc } from "@/lib/viewer/crossSection";

// Logical SVG canvas. It scales to the panel width via the viewBox;
// preserveAspectRatio "none" holds the ~140px height at any width, and
// non-scaling strokes keep line/grid weights crisp despite the x-stretch. Text
// lives in HTML around the SVG, so it never distorts.
const W = 320;
const H = 140;
const PAD_X = 6;
const PAD_Y = 10;

type FetchState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; doc: ProfileDoc };

/** Metric-metres value → the row's unit system (imperial → feet), 1 decimal. */
function fmtLen(valueM: number, system: UnitSystem): string {
  const c = convertForDisplay("length_m", valueM, system);
  return `${c.value.toLocaleString(undefined, { maximumFractionDigits: 1 })}${c.unit ? ` ${c.unit}` : ""}`;
}
function fmtElev(valueM: number, system: UnitSystem): string {
  const c = convertForDisplay("elevation_m", valueM, system);
  return `${c.value.toLocaleString(undefined, { maximumFractionDigits: 1 })}${c.unit ? ` ${c.unit}` : ""}`;
}

export function CrossSectionChart({
  profileUrl,
  unitSystem,
}: {
  profileUrl: string;
  unitSystem: UnitSystem;
}) {
  const [state, setState] = React.useState<FetchState>({ status: "loading" });
  const [prevUrl, setPrevUrl] = React.useState(profileUrl);

  // Reset to loading the moment the URL changes (a different measurement, or a
  // re-sample). Adjusting state during render — not in the effect — is the
  // sanctioned way to avoid the cascading re-render a setState-in-effect causes
  // (https://react.dev/learn/you-might-not-need-an-effect) and keeps the prior
  // profile from flashing under the new one.
  if (profileUrl !== prevUrl) {
    setPrevUrl(profileUrl);
    setState({ status: "loading" });
  }

  // Fetch keyed on the profile URL. AbortController cancels an in-flight fetch on
  // url-change / unmount so we never setState after either.
  React.useEffect(() => {
    const controller = new AbortController();
    // The measurements list is NOT proxied, so profile_url is a raw GCS URL —
    // route it through the same-origin /gcs proxy (the bucket has no CORS) first.
    const url = proxyGcsUrls(profileUrl);
    fetch(url, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`Profile fetch failed (${res.status})`);
        return res.json();
      })
      .then((raw) => {
        if (controller.signal.aborted) return;
        const doc = parseProfileDoc(raw);
        setState(
          doc
            ? { status: "ready", doc }
            : { status: "error", message: "Profile data was malformed." }
        );
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || (err as { name?: string })?.name === "AbortError") return;
        setState({
          status: "error",
          message: err instanceof Error ? err.message : "Failed to load profile.",
        });
      });
    return () => controller.abort();
  }, [profileUrl]);

  // Derive the SVG geometry from fetched state (never stored — derive, not sync).
  const geom = React.useMemo(
    () =>
      state.status === "ready"
        ? profileChartGeometry(state.doc, { width: W, height: H, padX: PAD_X, padY: PAD_Y })
        : null,
    [state]
  );

  return (
    <div className="rounded-lg bg-[#19191d] p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-gray-500">
          <Activity size={11} className="text-[#C97A4E]" />
          Elevation profile
        </span>
        {geom && geom.hasData && (
          <span className="font-mono text-[11px] text-gray-400">{fmtLen(geom.lengthM, unitSystem)}</span>
        )}
      </div>

      {state.status === "loading" && (
        <div className="flex h-[140px] items-center justify-center gap-2 text-xs text-gray-500">
          <Loader2 size={14} className="animate-spin text-[#C97A4E]" />
          Loading profile…
        </div>
      )}

      {state.status === "error" && (
        <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/[0.08] p-2.5">
          <AlertTriangle size={13} className="mt-px shrink-0 text-red-400" />
          <p className="text-[11px] leading-snug text-red-300">{state.message}</p>
        </div>
      )}

      {geom && !geom.hasData && (
        <p className="text-[11px] leading-snug text-gray-500">
          No elevation data along this line — every sample is DSM nodata.
        </p>
      )}

      {geom && geom.hasData && (
        <div>
          <div className="relative">
            {/* Elevation axis labels in HTML (never distorted by the stretched SVG). */}
            <span className="pointer-events-none absolute left-0 top-0 font-mono text-[9px] text-gray-500">
              {fmtElev(geom.maxZ, unitSystem)}
            </span>
            <span className="pointer-events-none absolute bottom-0 left-0 font-mono text-[9px] text-gray-500">
              {fmtElev(geom.minZ, unitSystem)}
            </span>
            <svg
              viewBox={`0 0 ${W} ${H}`}
              preserveAspectRatio="none"
              className="w-full"
              style={{ height: H }}
              role="img"
              aria-label={`Elevation profile from ${fmtElev(geom.minZ, unitSystem)} to ${fmtElev(
                geom.maxZ,
                unitSystem
              )} over ${fmtLen(geom.lengthM, unitSystem)}`}
            >
              {/* Faint gridlines at the max / mid / min elevation levels. */}
              {geom.gridYs.map((y, i) => (
                <line
                  key={`grid-${i}`}
                  x1={PAD_X}
                  y1={y}
                  x2={W - PAD_X}
                  y2={y}
                  stroke="#ffffff"
                  strokeOpacity={0.07}
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              {/* Chart floor. */}
              <line
                x1={PAD_X}
                y1={geom.baselineY}
                x2={W - PAD_X}
                y2={geom.baselineY}
                stroke="#ffffff"
                strokeOpacity={0.12}
                strokeWidth={1}
                strokeDasharray="2 2"
                vectorEffect="non-scaling-stroke"
              />
              {/* Accent area fill under each contiguous (non-nodata) run. */}
              {geom.areaSegments.map((d, i) => (
                <path key={`area-${i}`} d={d} fill="#C97A4E" fillOpacity={0.12} />
              ))}
              {/* Profile line, broken at DSM-nodata gaps. */}
              {geom.lineSegments.map((pts, i) => (
                <polyline
                  key={`line-${i}`}
                  points={pts}
                  fill="none"
                  stroke="#C97A4E"
                  strokeWidth={1.5}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </svg>
          </div>
          {/* Station axis: line start → total length. */}
          <div className="mt-1 flex justify-between font-mono text-[9px] text-gray-600">
            <span>0</span>
            <span>{fmtLen(geom.lengthM, unitSystem)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
