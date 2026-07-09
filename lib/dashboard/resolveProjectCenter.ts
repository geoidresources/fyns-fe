import { getManifest, listSurveys, type Manifest } from "@/lib/api/assetSvc";
import { getProject, type Project } from "@/lib/api/userSvc";

export interface Wgs84Center {
  lat: number;
  lng: number;
}

/** True WGS84 degrees — rejects nulls and projected easting/northing stored wrongly. */
export function projectWgs84Center(
  project: Pick<Project, "center_lat" | "center_lng">
): Wgs84Center | null {
  const { center_lat: lat, center_lng: lng } = project;
  if (lat == null || lng == null) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

function centerFromBbox(bbox?: number[]): Wgs84Center | null {
  if (!bbox || bbox.length !== 4) return null;
  const [west, south, east, north] = bbox;
  if ([west, south, east, north].some((n) => typeof n !== "number" || !Number.isFinite(n))) return null;
  if (west >= east || south >= north) return null;
  return { lat: (south + north) / 2, lng: (west + east) / 2 };
}

function centerFromManifest(manifest: Manifest): Wgs84Center | null {
  const bboxes = [
    ...(manifest.layers.terrain || []).map((l) => l.bbox),
    ...(manifest.layers.ortho || []).map((l) => l.bbox),
    ...(manifest.layers.pointcloud || []).map((l) => l.bbox),
    ...(manifest.layers.lenses || []).map((l) => l.bbox),
  ];
  for (const bbox of bboxes) {
    const center = centerFromBbox(bbox);
    if (center) return center;
  }

  const siteModel = manifest.layers.site_models?.find(
    (m) => Number.isFinite(m.anchor_lat) && Number.isFinite(m.anchor_lon)
  );
  if (siteModel) {
    return { lat: siteModel.anchor_lat, lng: siteModel.anchor_lon };
  }

  return null;
}

/**
 * Resolve a fly-to / map-marker position for a project. listProjects often
 * omits center_lat/center_lng (mine sites) — fall back to project detail,
 * then the latest survey manifest bbox / site-model anchor.
 */
export async function resolveProjectCenter(project: Project): Promise<Wgs84Center | null> {
  const fromList = projectWgs84Center(project);
  if (fromList) return fromList;

  try {
    const detail = await getProject(project.id);
    const fromDetail = projectWgs84Center(detail);
    if (fromDetail) return fromDetail;
  } catch {
    // fall through to survey manifest
  }

  try {
    const { surveys } = await listSurveys(project.id);
    const latest = [...(surveys || [])].sort((a, b) =>
      b.survey_date.localeCompare(a.survey_date)
    )[0];
    if (!latest) return null;
    const manifest = await getManifest(latest.id);
    return centerFromManifest(manifest);
  } catch {
    return null;
  }
}
