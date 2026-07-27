// Upload planning — pure logic, no React, no network.
//
// Maps the Upload page's data types + files onto the real backend contracts:
//  - ingest kinds (asset-svc ingest.validKinds: terrain | ortho | pointcloud |
//    vector | site_model | images | gcp), and
//  - processor dispatches (asset-svc POST /surveys/:id/generate → workflow-geo-svc
//    framework processors). Payload shapes mirror each processor's typed Input
//    schema (workflow-geo-svc/internal/processor/<pkg>/types.go) — field names
//    matter, they are validated server-side.
//
// Per-epoch pipeline (PROCESSOR_DESIGN.md §6): DSM/DTM rasters dispatch BOTH
//  - `co-register`  → normalized raw raster → terrain_surfaces.raw_raster_url
//    (what measurement compute resolves — the "no co-registered DSM" 422), and
//  - `terrain-quantized-mesh` → Cesium tiles → terrain_surfaces.tile_directory_url
//    (what the viewer renders).
// The two completions merge into one terrain_surfaces row per (survey, type).

import type { GenerateRequest } from "@/lib/api/assetSvc";

export type DataType = "survey" | "lidar" | "preprocessed" | "design";

/** Per-file role driving both the ingest kind and the processor plan. */
export type FileRole =
  | "images" // geotagged survey photos (zip → image-index)
  | "pointcloud" // .las/.laz → pointcloud-tiles
  | "dsm" // GeoTIFF surface → co-register + terrain-quantized-mesh
  | "dtm"
  | "ortho" // orthophoto GeoTIFF → orthophoto-tiles
  | "contours" // vector contours → vector-features
  | "vector" // other vector overlays → vector-features
  | "gcp" // GCP csv → gcp-ingest
  | "site_model" // mesh (needs a WGS84 anchor — ingest only, no auto-dispatch)
  | "design"; // project design file → POST /designs

export const ROLE_LABELS: Record<FileRole, string> = {
  images: "Images",
  pointcloud: "Point cloud",
  dsm: "DSM",
  dtm: "DTM",
  ortho: "Orthophoto",
  contours: "Contours",
  vector: "Vector",
  gcp: "GCPs",
  site_model: "3D mesh",
  design: "Design",
};

/** Roles the user may switch a file to, per data type (the per-row select). */
export const SELECTABLE_ROLES: Record<DataType, FileRole[]> = {
  survey: ["images", "gcp"],
  lidar: ["pointcloud"],
  preprocessed: ["dsm", "dtm", "ortho", "pointcloud", "contours", "vector", "gcp", "site_model"],
  design: ["design"],
};

/** File-picker accept list per data type. */
export const ACCEPT: Record<DataType, string> = {
  survey: ".jpg,.jpeg,.png,.tif,.tiff,.zip,.csv",
  lidar: ".las,.laz,.zip",
  preprocessed: ".tif,.tiff,.las,.laz,.dxf,.shp,.geojson,.json,.zip,.csv,.obj,.osgb,.3mx",
  design: ".dxf,.xml,.landxml,.geojson,.json,.obj,.ifc",
};

export const DROPZONE_HINT: Record<DataType, string> = {
  survey: "JPG, TIFF — 10+ geotagged images (or one .zip)",
  lidar: "LAS / LAZ point clouds",
  preprocessed: "GeoTIFF DSM / DTM / ortho, LAZ, contour DXF / SHP / GeoJSON",
  design: "DXF, LandXML, GeoJSON, OBJ, IFC design surfaces",
};

function ext(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

/** Best-guess role from the filename within a data type; the user can correct
 * it per file. Name hints (dsm/dtm/ortho/contour) win over bare extension. */
export function guessRole(filename: string, dataType: DataType): FileRole {
  const n = filename.toLowerCase();
  const e = ext(n);

  if (dataType === "design") return "design";
  if (dataType === "lidar") return "pointcloud";
  if (dataType === "survey") return e === "csv" ? "gcp" : "images";

  // preprocessed — sniff the role from the name, then the extension.
  if (e === "las" || e === "laz") return "pointcloud";
  if (e === "csv") return "gcp";
  if (e === "obj" || e === "osgb" || e === "3mx") return "site_model";
  if (e === "tif" || e === "tiff") {
    if (n.includes("dtm")) return "dtm";
    if (n.includes("dsm")) return "dsm";
    if (n.includes("ortho")) return "ortho";
    return "dsm"; // most pre-processed GeoTIFFs here are surfaces
  }
  if (e === "dxf" || e === "shp" || e === "geojson" || e === "json" || e === "zip") {
    return n.includes("contour") ? "contours" : "vector";
  }
  return "vector";
}

/** Ingest kind for a role (must be an asset-svc ingest validKind). */
export function roleToAssetKind(role: FileRole): string {
  switch (role) {
    case "images":
      return "images";
    case "pointcloud":
      return "pointcloud";
    case "dsm":
    case "dtm":
      return "terrain";
    case "ortho":
      return "ortho";
    case "contours":
    case "vector":
    case "design":
      return "vector";
    case "gcp":
      return "gcp";
    case "site_model":
      return "site_model";
  }
}

/** MIME type for the signed PUT (must match what the URL was signed with). */
export function contentTypeFor(filename: string): string {
  switch (ext(filename)) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "tif":
    case "tiff":
      return "image/tiff";
    case "zip":
      return "application/zip";
    case "json":
    case "geojson":
      return "application/json";
    case "csv":
      return "text/csv";
    case "xml":
      return "application/xml";
    default:
      return "application/octet-stream";
  }
}

/** An uploaded file the planner turns into processor dispatches. */
export interface PlannedFile {
  name: string;
  role: FileRole;
  /** Bucket URL of the uploaded object (asset.url from initUploads). */
  url: string;
}

export interface PlannerOptions {
  /** Horizontal CRS chosen in the form, e.g. "EPSG:32645". */
  epsg: string;
  /** The survey's snapshotted working CRS — preferred co-register target. */
  workingCrs?: string;
}

/** One generate call to fire, with a user-facing label. */
export interface PlannedDispatch {
  label: string;
  request: GenerateRequest;
}

/** What could not be auto-dispatched, and why (shown in the summary). */
export interface PlannedSkip {
  filename: string;
  reason: string;
}

export interface ProcessorPlan {
  dispatches: PlannedDispatch[];
  skips: PlannedSkip[];
}

/**
 * Builds the processor dispatch plan for a set of uploaded files. Payload
 * shapes are lock-step with the workflow-geo-svc framework Input schemas.
 */
export function buildProcessorPlan(files: PlannedFile[], opts: PlannerOptions): ProcessorPlan {
  const dispatches: PlannedDispatch[] = [];
  const skips: PlannedSkip[] = [];
  const targetCrs = (opts.workingCrs || "").trim() || opts.epsg;

  // vector-features batches every vector file into one call.
  const vectorFiles: PlannedFile[] = [];

  for (const f of files) {
    switch (f.role) {
      case "dsm":
      case "dtm": {
        // 1) co-register — normalizes CRS and lands the RAW raster analytics
        //    (stockpile/cut-fill compute) resolve. Vertical datums are left
        //    unset: co-register v1 fails Permanent on a vertical mismatch
        //    rather than converting, so we don't assert one from a dropdown.
        dispatches.push({
          label: `Co-register ${f.role.toUpperCase()} (${f.name})`,
          request: {
            processor_type: "co-register",
            payload: {
              source: { url: f.url, kind: "terrain", crs: opts.epsg },
              target_crs: targetCrs,
              surface_type: f.role,
            },
            inputs: [{ url: f.url, kind: "terrain", crs: opts.epsg }],
          },
        });
        // 2) terrain-quantized-mesh — Cesium tiles for the viewer.
        dispatches.push({
          label: `Terrain tiles ${f.role.toUpperCase()} (${f.name})`,
          request: {
            processor_type: "terrain-quantized-mesh",
            payload: {
              source: { url: f.url, kind: "terrain", crs: opts.epsg },
              surface_type: f.role,
            },
            inputs: [{ url: f.url, kind: "terrain", crs: opts.epsg }],
          },
        });
        break;
      }
      case "ortho":
        dispatches.push({
          label: `Ortho tiles (${f.name})`,
          request: {
            processor_type: "orthophoto-tiles",
            payload: { source: { url: f.url, kind: "ortho", crs: opts.epsg } },
            inputs: [{ url: f.url, kind: "ortho", crs: opts.epsg }],
          },
        });
        break;
      case "pointcloud":
        dispatches.push({
          label: `Point-cloud tiles (${f.name})`,
          request: {
            processor_type: "pointcloud-tiles",
            payload: {
              source: { url: f.url, kind: "pointcloud", crs: opts.epsg },
              source_crs: opts.epsg,
            },
            inputs: [{ url: f.url, kind: "pointcloud", crs: opts.epsg }],
          },
        });
        break;
      case "contours":
      case "vector":
        vectorFiles.push(f);
        break;
      case "gcp":
        dispatches.push({
          label: `GCP ingest (${f.name})`,
          request: {
            processor_type: "gcp-ingest",
            payload: { source: { url: f.url, kind: "gcp" } },
            inputs: [{ url: f.url, kind: "gcp" }],
          },
        });
        break;
      case "images":
        // image-index reads EXIF GPS out of a zip (or a single image); loose
        // photo sets are ingested as source assets but only zips are indexed.
        if (ext(f.name) === "zip") {
          dispatches.push({
            label: `Index image positions (${f.name})`,
            request: {
              processor_type: "image-index",
              payload: { source: { url: f.url, kind: "images" } },
              inputs: [{ url: f.url, kind: "images" }],
            },
          });
        } else {
          skips.push({
            filename: f.name,
            reason: "stored as source imagery — zip the set to index camera positions",
          });
        }
        break;
      case "site_model":
        // mesh-3dtiles needs a WGS84 anchor + source format the form doesn't
        // collect yet — ingest the file, leave processing to the backend team.
        skips.push({
          filename: f.name,
          reason: "3D mesh stored — mesh-3dtiles dispatch needs a placement anchor (not collected here yet)",
        });
        break;
      case "design":
        // Designs are registered via POST /designs, not a processor dispatch.
        break;
    }
  }

  if (vectorFiles.length > 0) {
    dispatches.push({
      label: `Vector features (${vectorFiles.map((v) => v.name).join(", ")})`,
      request: {
        processor_type: "vector-features",
        payload: {
          files: vectorFiles.map((v) => ({
            source: { url: v.url, kind: "vector", crs: opts.epsg },
            source_crs: opts.epsg,
            role: v.role === "contours" ? "contours" : "overlay",
            format: v.role === "contours" ? "contour" : "",
          })),
        },
        inputs: vectorFiles.map((v) => ({ url: v.url, kind: "vector", crs: opts.epsg })),
      },
    });
  }

  return { dispatches, skips };
}

/** Design file format for POST /designs, from the filename. */
export function designFormat(filename: string): string {
  switch (ext(filename)) {
    case "dxf":
      return "dxf";
    case "xml":
    case "landxml": // LandXML surfaces are commonly named *.landxml, not *.xml
      return "landxml";
    case "obj":
      return "obj";
    case "ifc":
      return "ifc";
    default:
      return "geojson";
  }
}
