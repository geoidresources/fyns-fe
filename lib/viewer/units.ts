// Per-measurement unit display (design panel: Metric (m³, t) | Imperial
// (yd³, tons) | Custom). Pure DISPLAY conversion — stored metrics stay metric
// (the processors compute in meters); the chosen system persists on the row as
// `params.units` via PATCH so every client renders it the same way.

export type UnitSystem = "metric" | "imperial";

export const UNIT_SYSTEMS: { id: UnitSystem; label: string }[] = [
  { id: "metric", label: "Metric (m³, t)" },
  { id: "imperial", label: "Imperial (yd³, tons)" },
];

export function unitSystemOf(params: Record<string, unknown> | null | undefined): UnitSystem {
  return params?.units === "imperial" ? "imperial" : "metric";
}

const M3_TO_YD3 = 1.30795062;
const T_TO_SHORT_TONS = 1.10231131;
const M_TO_FT = 3.28084;
const M2_TO_FT2 = 10.7639104;

/** Kind of quantity a metric key holds, by suffix convention (the processor
 * emits *_m3 / *_t / *_m2 / *_m / *_percent / bare counts). */
export function quantityOf(key: string): "volume" | "mass" | "area" | "length" | "percent" | "count" {
  if (key.endsWith("_m3")) return "volume";
  if (key.endsWith("_t")) return "mass";
  if (key.endsWith("_m2")) return "area";
  if (key.endsWith("_m")) return "length";
  if (key.endsWith("_percent")) return "percent";
  return "count";
}

/** Convert a metric value + its display unit into the target system. */
export function convertForDisplay(
  key: string,
  value: number,
  system: UnitSystem
): { value: number; unit: string } {
  const q = quantityOf(key);
  if (system === "imperial") {
    switch (q) {
      case "volume":
        return { value: value * M3_TO_YD3, unit: "yd³" };
      case "mass":
        return { value: value * T_TO_SHORT_TONS, unit: "tons" };
      case "area":
        return { value: value * M2_TO_FT2, unit: "ft²" };
      case "length":
        return { value: value * M_TO_FT, unit: "ft" };
    }
  }
  switch (q) {
    case "volume":
      return { value, unit: "m³" };
    case "mass":
      return { value, unit: "t" };
    case "area":
      return { value, unit: "m²" };
    case "length":
      return { value, unit: "m" };
    case "percent":
      return { value, unit: "%" };
    default:
      return { value, unit: "" };
  }
}
