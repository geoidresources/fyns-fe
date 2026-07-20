"use client";

// Scene picking (viewer-shell §2.3 hook `useScenePicking`, cut-line :1544-1609).
// RE-DERIVED from SurveyViewer's select-tool effect. The pick/classify branch
// logic is line-identical, but each branch's split-state writes
// (setSelectedMeasurement / setPickedFeature / setRightPanel) are swapped to the
// store's UNIFIED selection actions (§2.3 permitted edit (a) — a state-access
// swap): the store models selection as ids + feature (§3.3), so per branch
// `selectMeasurement` / `selectFeature` / `clearSelection` replace the three
// setters one-for-one. `selectMeasurement`/`selectFeature` already set
// `detailPanel:"inspect"`, matching the original
// setRightPanel("inspect") behavior.
/* eslint-disable react-hooks/exhaustive-deps */

import { useEffect, type RefObject } from "react";
import {
  Cesium3DTileFeature,
  Entity,
  JulianDate,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  defined,
  type Viewer as CesiumViewer,
} from "cesium";
import { normalizeSelectedFeature } from "@/lib/viewer/measure";
import type { Measurement } from "@/lib/api/assetSvc";
import type { DrawMode } from "@/components/viewer/MeasurementPanel";
import type { Selection } from "@/lib/viewer/state/store";

export function useScenePicking(deps: {
  viewerReady: boolean;
  drawMode: DrawMode | null;
  probing: boolean;
  measurements: Measurement[];
  /** Current selection kind — only a picked *feature* is dismissed on an
   * empty-space click (SurveyViewer guarded this on `pickedFeature`). */
  selectionKind: Selection["kind"] | null;
  viewerRef: RefObject<CesiumViewer | null>;
  selectMeasurement: (id: string, opts?: { fly?: boolean }) => void;
  selectFeature: (props: Record<string, unknown>) => void;
  clearSelection: () => void;
  /** Right-click on a measurement → select it + open the context menu at the
   * cursor (page coords). Delete/Edit/Redraw live there. */
  openContextMenu: (x: number, y: number, measurementId: string) => void;
  closeContextMenu: () => void;
}) {
  const {
    viewerReady,
    drawMode,
    probing,
    measurements,
    selectionKind,
    viewerRef,
    selectMeasurement,
    selectFeature,
    clearSelection,
    openContextMenu,
    closeContextMenu,
  } = deps;

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewerReady || !viewer || viewer.isDestroyed()) return;

    const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((movement: ScreenSpaceEventHandler.PositionedEvent) => {
      if (drawMode || probing) return; // the draw/probe handlers own clicks

      const picked = viewer.scene.pick(movement.position);
      if (!defined(picked)) {
        // Clicking empty space dismisses a picked-feature inspection (only a
        // feature — a selected measurement stays; matches the original's
        // `if (pickedFeature)` guard).
        if (selectionKind === "feature") clearSelection();
        return;
      }

      if (picked instanceof Cesium3DTileFeature) {
        const ids = picked.getPropertyIds();
        if (ids.length === 0) return; // untagged mesh surface — nothing to inspect
        const props: Record<string, unknown> = { _source: "3dtiles" };
        for (const id of ids) props[id] = picked.getProperty(id);
        selectFeature(normalizeSelectedFeature(props, { name: "3D Tiles feature" }));
        return;
      }

      if (picked.id instanceof Entity) {
        const entity = picked.id;
        const props = entity.properties?.getValue(JulianDate.now()) as
          | Record<string, unknown>
          | undefined;

        // Measurement overlays carry their measurement id in properties.
        const measurement =
          typeof props?.id === "string"
            ? measurements.find((m) => m.id === props.id)
            : undefined;
        if (measurement) {
          // A map pick does not fly (only a tree-row click frames the geometry).
          selectMeasurement(measurement.id, { fly: false });
          return;
        }

        if (props && Object.keys(props).length > 0) {
          selectFeature(
            normalizeSelectedFeature(props, {
              _source: "geojson",
              _entityId: entity.id,
              name: entity.name ?? "Region of interest",
            })
          );
        }
      }
    }, ScreenSpaceEventType.LEFT_CLICK);

    // Right-click a measurement → select it + open the context menu (Edit /
    // Redraw / Delete) at the cursor. Only outside a draw/probe session (those
    // own right-click for finish/erase). Misses close any open menu.
    handler.setInputAction((event: ScreenSpaceEventHandler.PositionedEvent) => {
      if (drawMode || probing) return;
      const picked = viewer.scene.pick(event.position);
      const entity = picked?.id instanceof Entity ? picked.id : null;
      const props = entity?.properties?.getValue(JulianDate.now()) as
        | Record<string, unknown>
        | undefined;
      const measurement =
        typeof props?.id === "string" ? measurements.find((m) => m.id === props.id) : undefined;
      if (!measurement) {
        closeContextMenu();
        return;
      }
      selectMeasurement(measurement.id, { fly: false });
      const rect = viewer.scene.canvas.getBoundingClientRect();
      openContextMenu(rect.left + event.position.x, rect.top + event.position.y, measurement.id);
    }, ScreenSpaceEventType.RIGHT_CLICK);

    return () => handler.destroy();
  }, [viewerReady, drawMode, probing, measurements, selectionKind]);
}
