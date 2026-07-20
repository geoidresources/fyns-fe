"use client";

// Selection-handle overlay (P2c-2b): when a single editable measurement is
// SELECTED and the interaction machine is idle, draw its vertices as grab
// handles ON TOP of the still-visible measurement. Grabbing one (adapter
// LEFT_DOWN) promotes into a live edit — EDIT_SHAPE seeded from the SAME lifted
// geometry these handles were drawn from, then HANDLE_GRAB — so selection →
// direct manipulation is one motion (teardown parity). The overlay clears the
// instant the machine leaves idle (the edit renderer's handles take over) or the
// selection changes. Flag-gated; render-only, never sends events.

import { useEffect } from "react";
import type { RefObject } from "react";
import {
  Cartesian3,
  Color,
  Entity,
  HeightReference,
  type Viewer as CesiumViewer,
} from "cesium";
import type { ActorRefFrom } from "xstate";
import type { StoreApi } from "zustand/vanilla";

import { INTERACTION_V2 } from "@/lib/viewer/interaction/flag";
import type { interactionMachine } from "@/lib/viewer/interaction/machine";
import type { Primitive } from "@/lib/viewer/interaction/types";
import { geometryPositions } from "@/lib/viewer/measure";
import { ACCENT } from "@/components/viewer/shell/sceneHelpers";
import type { ViewerShellState } from "@/lib/viewer/state/store";

type InteractionActor = ActorRefFrom<typeof interactionMachine>;

/** Seed the adapter uses to promote a handle-grab into an edit: the same lifted
 * geometry the overlay handles were drawn from, so the grabbed index lines up. */
export interface SelectionSeed {
  measurementId: string;
  geometry: Cartesian3[];
  primitive: Primitive;
}

export function useSelectionHandles(
  viewerRef: RefObject<CesiumViewer | null>,
  viewerReady: boolean,
  actor: InteractionActor,
  store: StoreApi<ViewerShellState>,
  /** ViewerCanvas's terrain lift — matches editGeometry's seed exactly. */
  liftToTerrain: (positions: Cartesian3[]) => Cartesian3[],
  /** Populated with the overlay handle entities (vertex order) so the adapter
   * can pick one → its index. Empty when no overlay is shown. */
  selectionHandlesRef: RefObject<Entity[]>,
  /** The edit seed for the currently-overlaid measurement, else null. */
  selectionSeedRef: RefObject<SelectionSeed | null>
): void {
  useEffect(() => {
    if (!INTERACTION_V2 || !viewerReady) return;
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    let handles: Entity[] = [];
    let lastKey = ""; // measurementId + geometry identity — rebuild only on change

    const clear = () => {
      if (!viewer.isDestroyed()) for (const e of handles) viewer.entities.remove(e);
      handles = [];
      selectionHandlesRef.current = [];
      selectionSeedRef.current = null;
      lastKey = "";
    };

    const rebuild = () => {
      const s = store.getState();
      const machineIdle = actor.getSnapshot().value === "idle";
      const selId =
        s.selection?.kind === "measurement" ? s.selection.measurementIds[0] : null;
      const m = selId ? s.measurements.find((x) => x.id === selId) : null;
      const geomType = m?.geometry?.type;
      const editable = geomType === "Polygon" || geomType === "LineString";

      // Only overlay when the machine is idle (else the edit/draw renderer owns
      // the handles) and exactly one editable measurement is selected.
      if (!machineIdle || !m || !editable || s.measurementVisibility?.[m.id] === false) {
        if (handles.length) clear();
        return;
      }

      const key = `${m.id}:${JSON.stringify(m.geometry)}`;
      if (key === lastKey) return; // unchanged — keep the entities

      // Rebuild: same lifted geometry the seed will carry, so grab indices align.
      const lifted = liftToTerrain(geometryPositions(m.geometry!));
      if (!viewer.isDestroyed()) for (const e of handles) viewer.entities.remove(e);
      handles = lifted.map((pos) =>
        viewer.entities.add({
          position: pos,
          point: {
            pixelSize: 10,
            color: Color.WHITE,
            outlineColor: ACCENT,
            outlineWidth: 2,
            heightReference: HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        })
      );
      selectionHandlesRef.current = handles;
      selectionSeedRef.current = {
        measurementId: m.id,
        geometry: lifted,
        primitive: geomType === "Polygon" ? "polygon" : "polyline",
      };
      lastKey = key;
      if (!viewer.isDestroyed()) viewer.scene.requestRender();
    };

    rebuild();
    const unsubStore = store.subscribe(rebuild);
    const sub = actor.subscribe(rebuild);

    return () => {
      unsubStore();
      sub.unsubscribe();
      clear();
      if (!viewer.isDestroyed()) viewer.scene.requestRender();
    };
  }, [actor, store, viewerRef, viewerReady, liftToTerrain, selectionHandlesRef, selectionSeedRef]);
}
