"use client";

// URL state codec (viewer-shell §5). The real implementation lands in task 1.4:
// a `store.subscribe` writer (§5.4) over `[cameraPose, activeModule,
// selection.measurementIds, layerVisDiff, view.baseMap]`, debounced 300ms and
// gated on `hydrated`, plus the read-on-load restoration order (§5.6). It writes
// via `window.history.replaceState` — never `router.replace`/`pushState`.
//
// 1.3c-i ships the SEAM ONLY: a no-op hook so `ViewerShell` can wire it in its
// final position without behavior. Keeping it a hook (not an inline TODO) means
// 1.4 fills the body here and every deep link starts working with no shell edit.

/**
 * No-op URL codec stub (§5, lands 1.4). Mounted once inside `ViewerShell`
 * beneath the store + cesium providers. Does nothing in 1.3c-i.
 */
export function useUrlCodec(): void {
  // Intentionally empty — 1.4 implements the §5.2–5.6 read/write codec.
}
