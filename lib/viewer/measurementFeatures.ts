// The single source of truth for turning a survey's measurements into a GeoJSON
// FeatureCollection — shared by the "Measurements (GeoJSON)" download
// (ViewerCanvas.exportMeasurements) and the CAD-export dispatch (CadExportDialog).
//
// Kept out of exportReport.ts on purpose: that module is a leaf with only
// type-only imports so the node `--test` runner can import it directly, whereas
// this builder pulls in calc + projection at RUNTIME (like cutfillRaster.ts).
// No React, no DOM — measurements in, FeatureCollection out.

import type { GeoJsonGeometry, Measurement } from "@/lib/api/assetSvc";
import { metricsOf, resultForKind } from "@/lib/viewer/calc";
import { reprojectGeometry } from "@/lib/viewer/projection";

/** A measurement flattened to a GeoJSON Feature. `properties` carries identity
 * (id/name/kind/folder/status) plus the current-kind numeric metrics; geometry
 * is either WGS84 lon/lat (plain export) or reprojected working-CRS metres. */
export interface MeasurementFeature {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry: GeoJsonGeometry;
}

export interface MeasurementFeatureCollection {
  type: "FeatureCollection";
  features: MeasurementFeature[];
}

/** The measurement fields the builder reads — a structural subset so both the
 * store's `Measurement` and any lighter row satisfy it. */
type MeasurementLike = Pick<
  Measurement,
  "id" | "name" | "kind" | "folder" | "status" | "geometry" | "result" | "results"
>;

/**
 * Build a GeoJSON FeatureCollection from the survey's measurements. Only those
 * WITH geometry are included; each Feature's properties are the identity fields
 * plus `metricsOf(resultForKind(m))` — the server's numbers, never recomputed
 * on the client (§4).
 *
 * `forward` (a `WorkingTransform.forward`) reprojects every geometry from WGS84
 * lon/lat into the working CRS, preserving Z; omit it to keep geographic lon/lat.
 * The plain GeoJSON download omits it; the CAD export passes one so the DXF /
 * LandXML / CSV carry projected metres (a lon/lat DXF is useless in CAD), and
 * degrades to geographic — flagged — only when no transform resolves.
 */
export function buildMeasurementFeatureCollection(
  measurements: ReadonlyArray<MeasurementLike>,
  forward?: (lonLat: [number, number]) => [number, number]
): MeasurementFeatureCollection {
  const features: MeasurementFeature[] = [];
  for (const m of measurements) {
    if (!m.geometry) continue;
    features.push({
      type: "Feature",
      properties: {
        id: m.id,
        name: m.name,
        kind: m.kind,
        folder: m.folder ?? null,
        status: m.status,
        ...metricsOf(resultForKind(m)),
      },
      geometry: forward ? reprojectGeometry(m.geometry, forward) : m.geometry,
    });
  }
  return { type: "FeatureCollection", features };
}
