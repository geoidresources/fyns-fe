"use client";

// Interaction v2 renderer (plan §2): draws the in-progress draft — outline,
// fill, live segment label, per-vertex dots + segment-length labels, origin +
// snap halos — purely from the machine's snapshot and the adapter's hover refs.
// Render-only: it never sends events and never mutates state.
//
// Perf model (matches legacy): the outline/label/halos are CallbackProperties
// that PULL from the actor snapshot + refs every frame — vertex placement and
// hover movement cause zero React re-renders. Dots/labels are discrete
// entities rebuilt only when the draft array identity changes (append / undo /
// redo). All point/label decorations clamp to ground (ledger #7).

import { useEffect } from "react";
import type { RefObject } from "react";
import {
  CallbackPositionProperty,
  CallbackProperty,
  Cartesian2,
  Cartesian3,
  ClassificationType,
  Color,
  Entity,
  HeightReference,
  HorizontalOrigin,
  PolygonHierarchy,
  VerticalOrigin,
  type Viewer as CesiumViewer,
} from "cesium";
import type { ActorRefFrom } from "xstate";

import { INTERACTION_V2 } from "@/lib/viewer/interaction/flag";
import type { interactionMachine } from "@/lib/viewer/interaction/machine";
import { computeDistanceMeters, computeGrade } from "@/lib/viewer/measure";
import { ACCENT } from "@/components/viewer/shell/sceneHelpers";
import type { AdapterRefs } from "./useInteractionAdapter";

type InteractionActor = ActorRefFrom<typeof interactionMachine>;

const LABEL_BG = Color.fromCssColorString("#18181B").withAlpha(0.9);

export function useDraftRenderer(
  viewerRef: RefObject<CesiumViewer | null>,
  viewerReady: boolean,
  actor: InteractionActor,
  refs: AdapterRefs
): void {
  useEffect(() => {
    if (!INTERACTION_V2 || !viewerReady) return;
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    const { hoverRef, nearOriginRef, snapPreviewRef } = refs;
    const draft = () => actor.getSnapshot().context.draft as Cartesian3[];
    const ringOpen = () => actor.getSnapshot().context.ringOpen;
    const isPolygon = () => actor.getSnapshot().context.primitive === "polygon";
    const isSlope = () => actor.getSnapshot().context.template?.drawOpts?.slope === true;

    let base: Entity[] = [];
    let dots: Entity[] = [];
    let segmentLabels: Entity[] = [];
    let lastDraft: Cartesian3[] | null = null;

    const removeAll = (list: Entity[]) => {
      if (viewer.isDestroyed()) return;
      for (const e of list) viewer.entities.remove(e);
    };

    const mountBase = () => {
      base.push(
        viewer.entities.add({
          // Anchors the live segment label at the cursor for EVERY mode —
          // polyline/polygon graphics ignore entity.position, so this is safe.
          position: new CallbackPositionProperty(() => {
            const pts = draft();
            return hoverRef.current ?? pts[pts.length - 1] ?? Cartesian3.ZERO;
          }, false),
          polyline: {
            positions: new CallbackProperty(() => {
              const pts = draft();
              const hover = hoverRef.current;
              const all = hover ? [...pts, hover] : pts;
              if (all.length < 2) return [];
              // An opened ring previews UN-closed (P2 erase parity).
              return isPolygon() && !ringOpen() ? [...all, all[0]] : all;
            }, false),
            width: 3,
            material: ACCENT,
            clampToGround: true,
          },
          polygon: {
            hierarchy: new CallbackProperty(() => {
              if (!isPolygon()) return new PolygonHierarchy([]);
              const pts = draft();
              const hover = hoverRef.current;
              return new PolygonHierarchy(hover ? [...pts, hover] : pts);
            }, false),
            // Fill implies closure — polygons only, and only while closed.
            show: new CallbackProperty(() => isPolygon() && !ringOpen(), false),
            material: ACCENT.withAlpha(0.2),
            classificationType: ClassificationType.BOTH,
          },
          // Live segment readout: distance from the last placed vertex to the
          // cursor (plus rise for slope templates).
          label: {
            show: new CallbackProperty(() => {
              const pts = draft();
              const hover = hoverRef.current;
              return (
                !!hover &&
                pts.length > 0 &&
                computeDistanceMeters([pts[pts.length - 1], hover]) > 0.01
              );
            }, false),
            text: new CallbackProperty(() => {
              const pts = draft();
              const hover = hoverRef.current;
              if (!hover || pts.length === 0) return "";
              const segment = [pts[pts.length - 1], hover];
              const distance = computeDistanceMeters(segment);
              const grade = isSlope() ? computeGrade(segment) : null;
              if (!grade) return `${distance.toFixed(2)} m`;
              const arrow = grade.riseMeters >= 0 ? "↑" : "↓";
              return `${distance.toFixed(2)} m\n${arrow} ${Math.abs(grade.riseMeters).toFixed(2)} m`;
            }, false),
            font: "16px sans-serif",
            fillColor: Color.WHITE,
            showBackground: true,
            backgroundColor: LABEL_BG,
            backgroundPadding: new Cartesian2(10, 7),
            pixelOffset: new Cartesian2(18, 16),
            horizontalOrigin: HorizontalOrigin.LEFT,
            verticalOrigin: VerticalOrigin.TOP,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        }),
        // Origin halo — invites the close-the-ring click (C5).
        viewer.entities.add({
          position: new CallbackPositionProperty(
            () => draft()[0] ?? Cartesian3.ZERO,
            false
          ),
          point: {
            pixelSize: 18,
            color: ACCENT.withAlpha(0.25),
            outlineColor: Color.WHITE,
            outlineWidth: 2,
            heightReference: HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            show: new CallbackProperty(() => nearOriginRef.current === true, false),
          },
        }),
        // Vertex snap halo — cyan, distinct from the origin cue (C4).
        viewer.entities.add({
          position: new CallbackPositionProperty(
            () => snapPreviewRef.current ?? Cartesian3.ZERO,
            false
          ),
          point: {
            pixelSize: 16,
            color: Color.CYAN.withAlpha(0.22),
            outlineColor: Color.CYAN,
            outlineWidth: 2,
            heightReference: HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            show: new CallbackProperty(() => snapPreviewRef.current != null, false),
          },
        })
      );
    };

    // Accent dot per placed vertex + a length label per consecutive pair —
    // rebuilt whole on draft change (undo/erase reshuffle pairs; C3).
    const rebuildDecorations = () => {
      removeAll(dots);
      removeAll(segmentLabels);
      dots = [];
      segmentLabels = [];
      const pts = draft();
      for (let i = 0; i < pts.length; i++) {
        dots.push(
          viewer.entities.add({
            position: pts[i],
            point: {
              pixelSize: 8,
              color: ACCENT,
              outlineColor: Color.WHITE,
              outlineWidth: 2,
              heightReference: HeightReference.CLAMP_TO_GROUND,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
          })
        );
        if (i > 0) {
          segmentLabels.push(
            viewer.entities.add({
              position: Cartesian3.midpoint(pts[i - 1], pts[i], new Cartesian3()),
              label: {
                text: `${computeDistanceMeters([pts[i - 1], pts[i]]).toFixed(2)} m`,
                font: "14px sans-serif",
                fillColor: Color.WHITE,
                showBackground: true,
                backgroundColor: LABEL_BG,
                backgroundPadding: new Cartesian2(8, 6),
                pixelOffset: new Cartesian2(0, -16),
                verticalOrigin: VerticalOrigin.BOTTOM,
                heightReference: HeightReference.CLAMP_TO_GROUND,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
              },
            })
          );
        }
      }
    };

    const teardown = () => {
      removeAll(base);
      removeAll(dots);
      removeAll(segmentLabels);
      base = [];
      dots = [];
      segmentLabels = [];
      lastDraft = null;
      if (!viewer.isDestroyed()) viewer.scene.requestRender();
    };

    const sub = actor.subscribe((snap) => {
      const active =
        snap.value === "placing" || snap.value === "calcReady" || snap.value === "committing";
      if (!active) {
        if (base.length || dots.length) teardown();
        return;
      }
      if (base.length === 0) mountBase();
      const d = snap.context.draft as Cartesian3[];
      if (d !== lastDraft) {
        lastDraft = d;
        rebuildDecorations();
        viewer.scene.requestRender();
      }
    });

    return () => {
      sub.unsubscribe();
      teardown();
    };
  }, [actor, refs, viewerRef, viewerReady]);
}
