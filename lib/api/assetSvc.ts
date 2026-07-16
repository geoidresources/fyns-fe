import { apiFetch, resolveServiceBase } from "@/lib/api/client";

// asset-svc client — surveys, render manifest, measurements. Base URL is
// env-driven; routes live under /asset-svc/api/v1. Types mirror the Go DTOs in
// asset-svc-refactor/internal/dtos (field names matter).

const BASE = resolveServiceBase(
  process.env.NEXT_PUBLIC_ASSET_SVC_URL,
  "/asset-svc/api/v1",
  "NEXT_PUBLIC_ASSET_SVC_URL",
  "http://localhost:8082"
);

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

/** Body for POST /surveys — working CRS / vertical datum are NOT client-supplied;
 * asset-svc snapshots them from the project. */
export interface CreateSurveyRequest {
  project_id: string;
  survey_date: string; // YYYY-MM-DD
  survey_type?: string;
  metadata?: Record<string, unknown>;
}

export function createSurvey(req: CreateSurveyRequest): Promise<Survey> {
  return apiFetch<Survey>(BASE, "/surveys", { method: "POST", body: req });
}

// ------------------------------------------------------------------ ingest

/** One requested upload slot (asset-svc ingest.UploadInit). `kind` must be one
 * of the ingest validKinds: terrain | ortho | pointcloud | vector | site_model
 * | images | gcp. */
export interface UploadInitFile {
  filename: string;
  kind: string;
  role?: string;
  content_type?: string;
  crs?: string;
}

/** A registered (or pending) source object on a survey. */
export interface SourceAsset {
  id: string;
  client_id: string;
  survey_id: string;
  kind: string;
  role?: string;
  url: string;
  filename?: string;
  size_bytes?: number;
  crs?: string;
  vertical_datum?: string;
  status: string;
  metadata?: Record<string, unknown>;
}

export interface InitiatedUpload {
  asset: SourceAsset;
  upload_url: string;
}

/** Mints signed PUT URLs under original/<survey_id>/ and records pending
 * assets. The client PUTs each file to its upload_url, then calls
 * markAssetUploaded. */
export function initUploads(
  surveyId: string,
  files: UploadInitFile[]
): Promise<{ uploads: InitiatedUpload[] }> {
  return apiFetch<{ uploads: InitiatedUpload[] }>(BASE, `/surveys/${surveyId}/assets/init`, {
    method: "POST",
    body: { files },
  });
}

export function markAssetUploaded(surveyId: string, assetId: string): Promise<SourceAsset> {
  return apiFetch<SourceAsset>(BASE, `/surveys/${surveyId}/assets/${assetId}/uploaded`, {
    method: "PATCH",
  });
}

/** Source objects uploaded/registered on a survey (status: pending_upload |
 * registered). */
export function listSurveyAssets(surveyId: string): Promise<{ assets: SourceAsset[] }> {
  return apiFetch<{ assets: SourceAsset[] }>(BASE, `/surveys/${surveyId}/assets`);
}

// ---------------------------------------------------------------- generate

/** Addressable input artifact for a processor (asset-svc dtos.ArtifactRefDTO). */
export interface GenerateArtifactRef {
  url: string;
  kind: string;
  crs?: string;
}

/** Body for POST /surveys/:id/generate — dispatches one processor workflow.
 * `payload` is the processor's typed input (workflow-geo-svc framework
 * schemas); see lib/upload/planner.ts for the per-processor shapes. */
export interface GenerateRequest {
  processor_type: string;
  version?: string;
  payload?: Record<string, unknown>;
  inputs?: GenerateArtifactRef[];
}

export function generateSurvey(
  surveyId: string,
  req: GenerateRequest
): Promise<{ workflow_id: string; status: string }> {
  return apiFetch<{ workflow_id: string; status: string }>(BASE, `/surveys/${surveyId}/generate`, {
    method: "POST",
    body: req,
  });
}

// ------------------------------------------------------------------ designs

/** Body for POST /designs — registers an uploaded design file on a project. */
export interface CreateDesignRequest {
  project_id: string;
  name: string;
  format: string; // dxf | landxml | obj | geojson | ifc
  file_url: string;
  source_crs?: string;
  metadata?: Record<string, unknown>;
}

export interface DesignRecord {
  id: string;
  project_id: string;
  name: string;
  format: string;
  file_url?: string;
  source_crs?: string;
  status?: string;
  created_at?: string;
}

export function createDesign(req: CreateDesignRequest): Promise<DesignRecord> {
  return apiFetch<DesignRecord>(BASE, "/designs", { method: "POST", body: req });
}

export function listDesigns(projectId: string): Promise<{ designs: DesignRecord[] }> {
  return apiFetch<{ designs: DesignRecord[] }>(
    BASE,
    `/designs?project_id=${encodeURIComponent(projectId)}`
  );
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

// The §7.1 v1 result document stored verbatim on measurements.result by the
// measurement-result consumer: metrics + artifacts + provenance ("receipt") on
// success, error {class, message} on failure. Legacy rows are flat metric maps —
// the index signature admits them; read via lib/viewer/calc.ts metricsOf().
export interface MeasurementResultDoc {
  version?: number;
  semantics?: string;
  metrics?: Record<string, number>;
  artifacts?: {
    diff_raster_url?: string;
    heatmap_tiles_url?: string;
    base_surface_url?: string;
    bbox?: number[];
  };
  provenance?: {
    processor?: string;
    effective?: Record<string, unknown>;
    inputs?: unknown[];
    tools?: Record<string, string>;
  };
  error?: { class: string; message: string };
  [key: string]: unknown;
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
  result?: MeasurementResultDoc;
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
  /** Draw-first draft: created the moment a shape is finished, not yet kept.
   * Promote via updateMeasurement({draft:false}); orthogonal to status. */
  draft?: boolean;
  result_ref?: string;
  /** The LATEST run's v1 doc (success or error) — failure display + legacy rows. */
  result?: MeasurementResultDoc;
  /** Per-calc-type memory: kind → that type's last SUCCESSFUL v1 doc. The type
   * dropdown is a view switch over this map; compute is explicit Run/Re-run. */
  results?: Record<string, MeasurementResultDoc>;
  created_at: string;
  updated_at: string;
}

export interface CreateMeasurementRequest {
  kind: string; // stockpile | volume | cut_fill | cross_section | contour | tin
  name: string;
  folder?: string;
  geometry?: GeoJsonGeometry;
  params?: Record<string, unknown>;
  draft?: boolean;
}

/** PATCH body — every field optional; omitted = unchanged. `params` is a
 * PARTIAL object deep-merged server-side over the stored params (§6.1
 * override semantics); `draft: false` promotes a draw-first draft. */
export interface UpdateMeasurementRequest {
  name?: string;
  folder?: string;
  kind?: string;
  params?: Record<string, unknown>;
  draft?: boolean;
}

/** Optional `search` filters server-side by measurement name (case-insensitive
 * substring, asset-svc `?search=`). Empty/blank is omitted so the URL stays
 * clean and the endpoint returns the full set. */
export function listMeasurements(
  surveyId: string,
  search?: string
): Promise<{ measurements: Measurement[] }> {
  const q = search?.trim();
  const qs = q ? `?search=${encodeURIComponent(q)}` : "";
  return apiFetch<{ measurements: Measurement[] }>(BASE, `/surveys/${surveyId}/measurements${qs}`);
}

export function createMeasurement(surveyId: string, req: CreateMeasurementRequest): Promise<Measurement> {
  return apiFetch<Measurement>(BASE, `/surveys/${surveyId}/measurements`, {
    method: "POST",
    body: req,
  });
}

/** Dispatches the compute workflow (202). Inputs auto-resolve server-side. */
/** Partial update (PATCH): rename, re-folder, re-kind, params patch, draft
 * promotion. Returns the fresh row. */
export function updateMeasurement(
  surveyId: string,
  measurementId: string,
  body: UpdateMeasurementRequest
): Promise<Measurement> {
  return apiFetch<Measurement>(
    BASE,
    `/surveys/${surveyId}/measurements/${measurementId}`,
    { method: "PATCH", body }
  );
}

/** Dispatch compute. `body.params` is a partial params object the backend
 * deep-merges over the measurement's stored params AND persists before
 * dispatch (§6.1 — the row always states what ran); `body.force` bypasses the
 * compute-in-flight 409. Empty body = run with stored params. */
export function computeMeasurement(
  surveyId: string,
  measurementId: string,
  body?: { params?: Record<string, unknown>; force?: boolean }
): Promise<{ workflow_id: string; status: string }> {
  return apiFetch<{ workflow_id: string; status: string }>(
    BASE,
    `/surveys/${surveyId}/measurements/${measurementId}/compute`,
    { method: "POST", body: body ?? {} }
  );
}

export function deleteMeasurement(surveyId: string, measurementId: string): Promise<void> {
  return apiFetch<void>(BASE, `/surveys/${surveyId}/measurements/${measurementId}`, {
    method: "DELETE",
  });
}
