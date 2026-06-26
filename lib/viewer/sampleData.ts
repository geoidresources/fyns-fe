// Sample data mirroring the Figma "MapViewer" design. These fixtures populate
// the panel sections the backend does not serve yet — Designs and grouped
// Measurements — so the UI is fully demonstrable. Each export is the seam where
// real asset-svc data plugs in: replace the fixture with the manifest field
// (manifest.layers.designs, measurements grouped by `folder`) once wired.

import type { DesignControl } from "@/components/viewer/LayerPanel";
import type { Measurement } from "@/lib/api/assetSvc";

/** A measurement row that is display-only (no compute/delete) — demo content. */
export type PanelMeasurement = Measurement & { demo?: boolean };

export const SAMPLE_DESIGNS: DesignControl[] = [
  { key: "sample-design-pit", label: "pit phase 3 (DXF)", visible: true, renderable: true },
  { key: "sample-design-haul", label: "haul road A (LandXML)", visible: true, renderable: true },
];

// Pre-formatted, single-line labels so rows read exactly like the design,
// e.g. "SP-01 · limestone · 14,820 m³".
function demoMeasurement(folder: string, name: string): PanelMeasurement {
  return {
    id: `sample-${folder}-${name}`.replace(/[^a-z0-9-]/gi, "-").toLowerCase(),
    client_id: "sample",
    survey_id: "sample",
    kind: "volume",
    name,
    folder,
    status: "completed",
    created_at: "2024-05-18T00:00:00Z",
    updated_at: "2024-05-18T00:00:00Z",
    demo: true,
  };
}

const STOCKPILES = [
  "SP-01 · limestone · 14,820 m³",
  "SP-02 · coal · 8,420 m³",
  "SP-03 · limestone · 12,140 m³",
  "SP-04 · overburden · 21,560 m³",
  "SP-05 · coal · 6,980 m³",
  "SP-06 · limestone · 9,310 m³",
  "SP-07 · ROM ore · 17,240 m³",
  "SP-08 · overburden · 25,870 m³",
  "SP-09 · coal · 5,640 m³",
  "SP-10 · limestone · 11,020 m³",
  "SP-11 · ROM ore · 19,430 m³",
  "SP-12 · overburden · 23,110 m³",
];

const BLASTING = [
  "Blast area B7-E (post-blast)",
  "Blast area B6-W (pre-blast)",
  "Exclusion zone B7",
];

const BERM_CHECKS = ["Berm B3 crest", "Berm B4 toe", "Berm B5 width"];

const BENCH_MONITORING = [
  "Bench 1040 RL",
  "Bench 1025 RL",
  "Bench 1010 RL",
  "Bench 995 RL",
  "Bench 980 RL",
  "Bench 965 RL",
  "Bench 950 RL",
  "Bench 935 RL",
];

const HAUL_ROAD = ["Ramp R1 gradient", "Ramp R2 width", "Junction J3 sight line"];
const FIELD_OPS = ["Dewatering sump 2", "Stockpile pad C"];
const HYDRO = ["Sediment pond SP-A", "Diversion drain D2"];

/** Grouped sample measurements in the Figma folder order. */
export const SAMPLE_MEASUREMENTS: PanelMeasurement[] = [
  ...STOCKPILES.map((n) => demoMeasurement("Stockpiles", n)),
  ...BLASTING.map((n) => demoMeasurement("Blasting", n)),
  ...BERM_CHECKS.map((n) => demoMeasurement("Berm checks", n)),
  ...BENCH_MONITORING.map((n) => demoMeasurement("Bench monitoring", n)),
  ...HAUL_ROAD.map((n) => demoMeasurement("Haul road analysis", n)),
  ...FIELD_OPS.map((n) => demoMeasurement("Field ops", n)),
  ...HYDRO.map((n) => demoMeasurement("Hydro", n)),
];
