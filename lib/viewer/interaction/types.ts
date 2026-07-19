// Interaction v2 shared types (plan §3 — see docs/interaction-v2-checklist.md).
// This module tree is CESIUM-FREE by design: vertices are opaque {x,y,z} records
// (Cesium's Cartesian3 satisfies Vec3 structurally), so the whole machine runs
// under `node --test` with zero renderer imports.

/** Opaque 3D position — Cartesian3-compatible, never constructed here. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** The two draw primitives the machine places (Point rides the probe path). */
export type Primitive = "polyline" | "polygon";

/** Undo/redo unit: the WHOLE draft geometry, so every mutation kind (append,
 * drag, insert, delete, edge-open) restores uniformly (plan §11 ledger #3). */
export interface Snapshot {
  draft: Vec3[];
  ringOpen: boolean;
}

export const snapshotOf = (draft: Vec3[], ringOpen: boolean): Snapshot => ({
  draft: [...draft],
  ringOpen,
});
