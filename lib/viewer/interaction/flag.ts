// Migration seam (plan §P0): the v2 machine-driven interaction layer mounts only
// when this is set. Unset/0 → 100% legacy path, untouched. Removed at P3.
// NEXT_PUBLIC_* is inlined at build time, so flipping requires a dev-server restart.
export const INTERACTION_V2 = process.env.NEXT_PUBLIC_INTERACTION_V2 === "1";
