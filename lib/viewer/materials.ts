// Client-owned material catalog for stockpile tonnage (density → tonnage).
// Pure module: no React, no Cesium — unit-testable directly.
//
// Division of responsibility (rules 4 + 5):
//   • The FE OWNS this catalog. It is estimation reference data (material → bulk
//     density), so it lives in localStorage like a preference — not the URL, not
//     the server. A shared/project catalog is a follow-up for the go-api agent.
//   • Per-pile ASSIGNMENT persists SERVER-SIDE on the measurement
//     (`params.material_name`), so it survives reloads and is the join to a pile.
//   • Density is resolved from this catalog at dispatch time and sent in the
//     stockpile-inventory `materials[]` payload, where the SERVER computes
//     tonnage. The FE never multiplies volume × density for display.

export interface MaterialEntry {
  /** Stable slug key (the Select value). */
  id: string;
  /** Human name — also what we send as `material_name` and what an inventory
   * row echoes back in `StockpileEntry.material_name`. */
  name: string;
  /** Bulk (loose) density, tonnes per cubic metre. Drives tonnage. */
  densityTPerM3: number;
}

/** Server default when a pile carries no material (asset-svc: 1.8 t/m³). */
export const DEFAULT_BULK_DENSITY_T_M3 = 1.8;

/** Seed catalog — common mine/civil materials with representative loose bulk
 * densities (t/m³). Editable and extensible by the user in the panel. */
export const DEFAULT_MATERIALS: readonly MaterialEntry[] = [
  { id: "topsoil", name: "Topsoil", densityTPerM3: 1.3 },
  { id: "sand", name: "Sand", densityTPerM3: 1.6 },
  { id: "gravel", name: "Gravel", densityTPerM3: 1.8 },
  { id: "aggregate", name: "Aggregate", densityTPerM3: 1.5 },
  { id: "crushed-rock", name: "Crushed rock", densityTPerM3: 1.6 },
  { id: "coal", name: "Coal", densityTPerM3: 0.9 },
  { id: "iron-ore", name: "Iron ore", densityTPerM3: 2.5 },
  { id: "clay", name: "Clay", densityTPerM3: 1.9 },
  { id: "overburden", name: "Overburden", densityTPerM3: 1.8 },
  { id: "limestone", name: "Limestone", densityTPerM3: 1.6 },
];

const STORAGE_KEY = "geoid.materials.v1";

/** Slug for a material name; falls back to a time-seeded id for empty/symbol
 * names so a catalog never collapses two rows onto one key. */
export function slugifyMaterial(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || `material-${Date.now()}`;
}

function isValidEntry(x: unknown): x is MaterialEntry {
  if (!x || typeof x !== "object") return false;
  const e = x as Record<string, unknown>;
  return (
    typeof e.id === "string" &&
    e.id.length > 0 &&
    typeof e.name === "string" &&
    e.name.trim().length > 0 &&
    typeof e.densityTPerM3 === "number" &&
    Number.isFinite(e.densityTPerM3) &&
    e.densityTPerM3 > 0
  );
}

/** A fresh copy of the seed catalog (never hand out the frozen constants). */
export function defaultCatalog(): MaterialEntry[] {
  return DEFAULT_MATERIALS.map((m) => ({ ...m }));
}

/** Read the persisted catalog (SSR-safe). Malformed/empty storage → defaults. */
export function loadMaterialCatalog(): MaterialEntry[] {
  if (typeof window === "undefined") return defaultCatalog();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultCatalog();
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const valid = parsed.filter(isValidEntry);
      if (valid.length > 0) return valid;
    }
  } catch {
    // corrupt JSON / disabled storage — fall through to defaults
  }
  return defaultCatalog();
}

/** Persist the catalog (best-effort; quota/private-mode failures are ignored — the
 * catalog still applies for the session). */
export function saveMaterialCatalog(catalog: MaterialEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(catalog));
  } catch {
    // ignore
  }
}

/** Look a material up by its human name (the value stored on a pile). */
export function materialByName(
  catalog: MaterialEntry[],
  name: string | null | undefined
): MaterialEntry | undefined {
  if (!name) return undefined;
  return catalog.find((m) => m.name === name);
}

/** The material name assigned to a pile, or "" when unassigned. */
export function pileMaterialName(params: Record<string, unknown> | null | undefined): string {
  const name = params?.material_name;
  return typeof name === "string" ? name : "";
}
