# Interaction v2 — characterization checklist

Every behavior below exists today (2026-07-19, pre-v2) and must still pass at each
phase gate. Plan: https://claude.ai/code/artifact/69f1c6f8-751f-480f-afd0-809871ca9ed9
Flag: `NEXT_PUBLIC_INTERACTION_V2=1` mounts the machine-driven interaction layer;
unset/0 runs the legacy path untouched (until P3 removes the flag).

Legend: [C] = create plane (must pass under the flag from P1) · [E] = edit plane
(must pass under the flag from P2) · [G] = global/unchanged by v2 (must never break).

## Create plane
- [C1] Polygon tool: click-to-place vertices; polygon fill previews closed while placing.
- [C2] Line tool: click-to-place polyline; live segment label (distance) from last vertex to cursor; slope templates also show rise/grade.
- [C3] Every placed vertex renders an accent dot (CLAMP_TO_GROUND, depth-test off); consecutive-pair segment labels render for all modes.
- [C4] Vertex snapping: a placed/hovered vertex within ~13 px of ANY measurement's vertex (or this draft's earlier verts) magnetizes onto it; cyan snap halo shows the target. Snap pool is terrain-lifted.
- [C5] Origin close: with ≥3 vertices, hovering the FIRST vertex (≤15 px) shows the origin halo; clicking it closes the ring. Polygon → jumps to calc selection. Line → re-types the draft to polygon ("Shape closed — now a polygon"), locks placement, arms double-click.
- [C6] Right-click: locks vertex placement, opens calculation options (detail panel), keeps drawMode for the calc panel, unclips the toolbar tool.
- [C7] Double-click (after calc-ready): finish → draft-first CREATE (`draft: true`), optimistic list insert, visibility on, row selected (no fly), refresh, auto-compute for volume kinds.
- [C8] Kind resolution at finish: explicit template kind → panel calcType (validated for the geometry) → mode default. Saved kind always matches what the panel showed.
- [C9] Esc: discards the in-progress drawing ("Drawing discarded"), clears tool, closes detail.
- [C10] Re-clicking the armed tool cancels it (does not restart and discard silently).
- [C11] Undo/redo during placing: steps vertex placements back/forward (snapshot history).
- [C12] Dedupe: clicking <0.01 m from the previous vertex is ignored.
- [C13] Probe (Point/Elevation): click samples a point; probe marker renders; detail shows the sample.

## Edit plane
- [E1] Enter edit on a selected measurement (inspector "Edit shape" / vertex grab): original hidden, verts seeded (terrain-lifted), handles rendered, type PRESERVED (stockpile stays polygon).
- [E2] Drag a vertex handle: camera locks during drag, outline follows live, labels re-anchor on drop, live area/length readout updates.
- [E3] Delete an EDGE: ring opens at that edge (all vertices kept); a second edge-delete on the open ring SPLITS the chain (keeps longer part) — never resurrects the first-deleted edge.
- [E4] Delete a VERTEX: removes it, ring stays closed (v2 addition — no legacy equivalent).
- [E5] Add vertices into an open ring's gap by clicking terrain (legacy: resume-draw; v2: append-into-gap in editing) — draft is never wiped by switching intent mid-session.
- [E6] Add a vertex on an edge via midpoint ghost node (v2 addition).
- [E7] Hover identify: nearest vertex/edge highlights under the cursor while editing (replaces Point-identify tool).
- [E8] Commit (double-click / Enter): PATCH geometry in place (ring re-closed, type preserved) + selects row + recompute for volume kinds + "Geometry updated".
- [E9] Cancel (Esc / toggle-off): edit discarded, ORIGINAL geometry + visibility restored, no PATCH sent.
- [E10] Undo/redo during editing covers EVERY mutation (place, drag, edge/vertex delete, insert) via geometry snapshots.
- [E11] Redraw shape: draw a fresh outline that REPLACES the selected measurement's geometry on commit (snapping to old corners active).
- [E12] Vertex hit-testing works over elevated terrain (GPU pick of handles with projection fallback) — clicking a visible dot always selects it.
- [E13] Erasing a lone line's only segment deletes the LINE (draft) or the measurement (edit) with confirm toast.

## Global (untouched by v2)
- [G1] Measurement selection via scene click / WorkspaceTree row; inspector opens; eye toggles respected.
- [G2] Rendered (saved) measurements show polygon/polyline + per-vertex dots, clamped to ground.
- [G3] Folders: create/rename/delete, drag measurements between folders, depth-5 cap, Ungrouped pinned last.
- [G4] Draft rows: Save (promote, PATCH draft:false), Discard; estimates (instant PostGIS) show until worker doc lands.
- [G5] Compute: Run/Re-run per kind; per-kind results map; 409 in-flight gate respected; busy spinners.
- [G6] Export measurements; style tab (fill/stroke/label) PATCHes params.style.
- [G7] Module switching does NOT cancel an active draw (§4.1).
- [G8] Profile/client details in rails; auth flows.

## Verification recipe
Mock-viewer (no backend): memory `fyns-fe-checkpoint-render-recipe` — dummy cookie +
fetch stub + soft-nav; `viewer.resize()` after `resize_window`; assert against
`__mock.patches` / `__mock.computes` for commit payloads. GPU-pick paths need a real
browser; projection fallbacks + payload shapes verify headlessly.

## Test gates
`pnpm typecheck` · `pnpm lint` · `pnpm test` (node --test, includes
`lib/viewer/interaction/__tests__/machine.test.ts` from P1). Regression ledger
(plan §11) tests land BEFORE legacy deletion (P3).
