import { apiFetch } from "@/lib/api/client";

// asset-svc client — surveys, render manifest, measurements. Base URL is
// env-driven; routes live under /asset-svc/api/v1. Types mirror the Go DTOs in
// asset-svc-refactor/internal/dtos (field names matter).

const BASE =
  (process.env.NEXT_PUBLIC_ASSET_SVC_URL || "http://localhost:8082") + "/asset-svc/api/v1";

/** Minimal GeoJSON geometry (Polygon / LineString / …). */
export interface GeoJsonGeometry {
  type: string;
  coordinates: unknown;
}

// ---------------------------------------------------------------- surveys

export interface Survey {
  id: string;
  client_id: string;
  project_id: string;
  survey_date: string;
  survey_type: string;
  status: string;
  version_number?: number;
  working_crs: string;
  vertical_datum: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export function listSurveys(projectId: string): Promise<{ surveys: Survey[] }> {
  return apiFetch<{ surveys: Survey[] }>(BASE, `/surveys?project_id=${encodeURIComponent(projectId)}`);
}

// ---------------------------------------------------------------- manifest

export interface ManifestSurvey {
  id: string;
  project_id: string;
  status: string;
  survey_date: string;
  working_crs?: string;
  vertical_datum?: string;
  version?: { id: string; number: number; status: string };
}

/** Elevation statistics the terrain processor computes from the surface raster
 * (terrain_surfaces.metadata->'stats'). Elevations are meters in the layer's
 * vertical datum; histogram spans [histogram_min, histogram_max]. */
export interface TerrainStats {
  min_elevation: number;
  max_elevation: number;
  mean: number;
  std_dev: number;
  histogram?: number[];
  histogram_min?: number;
  histogram_max?: number;
}

/** bbox is [west, south, east, north] in degrees. */
export interface TerrainLayer {
  surface_type: string; // dsm | dtm
  tile_directory_url?: string;
  raw_raster_url?: string;
  bbox?: number[];
  min_zoom?: number;
  max_zoom?: number;
  crs?: string;
  vertical_datum?: string;
  stats?: TerrainStats;
}

export interface AssetLayer {
  processor_type: string;
  asset_kind: string; // ortho | pointcloud | lens
  output_urls?: Record<string, string>;
  bbox?: number[];
  min_zoom?: number;
  max_zoom?: number;
  crs?: string;
}

export interface VectorLayer {
  role: string;
  geojson_url?: string;
  format?: string;
  feature_count: number;
  crs?: string;
  interval_m?: number;
  properties?: Record<string, unknown>;
}

export interface SiteModelLayer {
  asset_id: string;
  tileset_url?: string;
  /** Source mesh format: photogrammetry (3mx/osgb/obj/3tz — renders crisp on
   * terrain) vs `dxf` (a thin CAD surface that floats/cliffs). Drives the
   * viewer's hero default. */
  source_format?: string;
  anchor_lon: number;
  anchor_lat: number;
  anchor_height: number;
  crs?: string;
  vertical_datum?: string;
}

export interface DesignLayer {
  id: string;
  name: string;
  format: string;
  file_url?: string;
  crs?: string;
  vertical_datum?: string;
}

export interface ManifestLayers {
  terrain: TerrainLayer[] | null;
  ortho: AssetLayer[] | null;
  pointcloud: AssetLayer[] | null;
  lenses: AssetLayer[] | null;
  vectors: VectorLayer[] | null;
  site_models: SiteModelLayer[] | null;
  designs: DesignLayer[] | null;
}

export interface StockpileEntry {
  pile_id: string;
  material_name?: string;
  area_m2: number;
  volume_m3: number;
  adjusted_volume_m3: number;
  tonnage_t: number;
  delta_volume_m3: number;
  mesh_url?: string;
}

export interface CutFillEntry {
  baseline_survey_id: string;
  comparison_survey_id: string;
  scope: string;
  zone_id: string;
  zone_name?: string;
  cut_volume_m3: number;
  fill_volume_m3: number;
  net_change_m3: number;
  heatmap_tiles_url?: string;
  diff_raster_url?: string;
}

export interface MeasurementSummary {
  id: string;
  kind: string;
  name: string;
  folder?: string;
  geometry?: GeoJsonGeometry;
  params?: Record<string, unknown>;
  status: string; // draft | computing | completed | failed
  result_ref?: string;
  result?: Record<string, number>;
}

export interface Manifest {
  survey: ManifestSurvey;
  layers: ManifestLayers;
  analytics: {
    stockpiles: StockpileEntry[] | null;
    cut_fill: CutFillEntry[] | null;
  };
  measurements: MeasurementSummary[] | null;
}

export function getManifest(surveyId: string): Promise<Manifest> {
  return apiFetch<Manifest>(BASE, `/surveys/${surveyId}/manifest`);
}

// ------------------------------------------------------------ measurements

export interface Measurement {
  id: string;
  client_id: string;
  survey_id: string;
  kind: string;
  name: string;
  folder?: string;
  geometry?: GeoJsonGeometry;
  params?: Record<string, unknown>;
  status: string; // draft | computing | completed | failed
  result_ref?: string;
  result?: Record<string, number>;
  created_at: string;
  updated_at: string;
}

export interface CreateMeasurementRequest {
  kind: string; // stockpile | volume | cut_fill | cross_section | contour | tin
  name: string;
  folder?: string;
  geometry?: GeoJsonGeometry;
  params?: Record<string, unknown>;
}

export function listMeasurements(surveyId: string): Promise<{ measurements: Measurement[] }> {
  return apiFetch<{ measurements: Measurement[] }>(BASE, `/surveys/${surveyId}/measurements`);
}

export function createMeasurement(surveyId: string, req: CreateMeasurementRequest): Promise<Measurement> {
  return apiFetch<Measurement>(BASE, `/surveys/${surveyId}/measurements`, {
    method: "POST",
    body: req,
  });
}

/** Dispatches the compute workflow (202). Inputs auto-resolve server-side. */
export function computeMeasurement(
  surveyId: string,
  measurementId: string
): Promise<{ workflow_id: string; status: string }> {
  return apiFetch<{ workflow_id: string; status: string }>(
    BASE,
    `/surveys/${surveyId}/measurements/${measurementId}/compute`,
    { method: "POST", body: {} }
  );
}

export function deleteMeasurement(surveyId: string, measurementId: string): Promise<void> {
  return apiFetch<void>(BASE, `/surveys/${surveyId}/measurements/${measurementId}`, {
    method: "DELETE",
  });
}
