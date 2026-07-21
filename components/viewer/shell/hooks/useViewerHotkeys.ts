"use client";

// Viewer hotkeys (enrichment plan §03, Phase 1): single-key mnemonics that make
// the toolbar/panels keyboard-native. Every binding routes into MACHINERY THAT
// ALREADY EXISTS — machine events, viewer actions, view settings — this hook
// adds no interaction logic of its own. The interaction-plane keys (Enter-to-
// commit, Delete, Tab-walk, Alt-suspend) live in useInteractionAdapter; here
// are the GLOBAL keys: tool arming, lenses, framing, the cheat sheet.
//
// Guards: never fires while typing (input/textarea/contenteditable), never on
// modifier chords (⌘/Ctrl/Alt reserved for the browser + Alt-suspend), never on
// key repeat. Lens keys map only to lenses the SURVEY actually has — a missing
// lens gets a toast, not a silent no-op.

import { useEffect } from "react";
import type { ActorRefFrom } from "xstate";
import type { StoreApi } from "zustand/vanilla";
import { toast } from "sonner";

import type { interactionMachine } from "@/lib/viewer/interaction/machine";
import type { TemplateId } from "@/lib/viewer/interaction/templates";
import type { ViewerShellState } from "@/lib/viewer/state/store";
import type { LayerControl } from "@/components/viewer/LayerPanel";
import type { ClaimedKeyEvent } from "./useInteractionAdapter";

type InteractionActor = ActorRefFrom<typeof interactionMachine>;

/** The subset of ViewerActions the hotkeys drive (kept narrow for testability). */
export interface HotkeyActions {
  startProbe: (toolKey?: string) => void;
  cancelDraw: () => void;
  editGeometry: () => void;
  handleColorMapChange: (value: string) => void;
  handleShadingChange: (value: string) => void;
  handleContourIntervalChange: (intervalM: number) => void;
  handleSunLightingChange: (enabled: boolean, hour: number) => void;
}

const DRAW_KEYS: Record<string, TemplateId> = {
  l: "line",
  a: "polygon",
  x: "section",
  g: "slope",
};

const PROBE_KEYS: Record<string, string> = {
  p: "palette:point",
  i: "palette:probe",
};

const RAMP_NAMES = ["viridis", "terrain", "plasma", "grayscale"];
const isContourRole = (role?: string | null) =>
  !!role && (role === "contours" || role.startsWith("contours_"));

/** First available elevation ramp, capitalized the way the Select stores it. */
function firstRamp(layers: LayerControl[]): string | null {
  for (const l of layers) {
    if (l.lensRamp && RAMP_NAMES.includes(l.lensRamp)) {
      return l.lensRamp.charAt(0).toUpperCase() + l.lensRamp.slice(1);
    }
  }
  return null;
}

function contourIntervals(layers: LayerControl[]): number[] {
  const seen = new Set<number>();
  for (const l of layers) {
    if (isContourRole(l.vectorRole) && l.intervalM && l.intervalM > 0) seen.add(l.intervalM);
  }
  return Array.from(seen).sort((a, b) => a - b);
}

export function useViewerHotkeys(
  actor: InteractionActor,
  store: StoreApi<ViewerShellState>,
  actions: HotkeyActions,
  /** Toggle the `?` shortcut cheat-sheet overlay (owned by ViewerCanvas). */
  onToggleSheet: () => void
): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;

      // The cheat sheet: works with Shift held (it IS shift+/ on most layouts).
      if (e.key === "?") {
        e.preventDefault();
        onToggleSheet();
        return;
      }

      // Everything below is a bare key — leave browser/OS chords alone.
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const s = store.getState();
      const machineState = actor.getSnapshot().value;
      const key = e.key.toLowerCase();

      // ---- tools ------------------------------------------------------
      // Toolbar-parity guards: a draft in progress blocks tool switches (the
      // machine would silently drop them — toast instead); an ARMED-but-empty
      // draw yields to a probe via ESC.
      const machineSnap = actor.getSnapshot();
      const busyDrafting =
        (machineSnap.value === "placing" && machineSnap.context.draft.length > 0) ||
        machineSnap.value === "calcReady";
      const armedTemplateId = machineSnap.context.template?.id ?? null;

      const drawTemplate = DRAW_KEYS[key];
      if (drawTemplate && !e.shiftKey) {
        e.preventDefault();
        if (busyDrafting && armedTemplateId !== drawTemplate) {
          toast.info("Finish the drawing (or press Esc) before switching tools");
          return;
        }
        if (s.probing) actions.cancelDraw(); // leave probe before arming a draw
        actor.send({ type: "TEMPLATE_PICKED", templateId: drawTemplate });
        return;
      }
      const probeKey = PROBE_KEYS[key];
      if (probeKey && !e.shiftKey) {
        e.preventDefault();
        // Re-press toggles the probe off (toolbar parity).
        if (s.probing && s.activeToolKey === probeKey) {
          actions.cancelDraw();
          return;
        }
        if (busyDrafting) {
          toast.info("Finish the drawing (or press Esc) first");
          return;
        }
        if (machineState === "placing") actor.send({ type: "ESC" }); // armed, no verts
        if (s.probing) actions.cancelDraw(); // switching probe kinds
        actions.startProbe(probeKey);
        return;
      }

      if (key === "s" && !e.shiftKey) {
        e.preventDefault();
        const next = !s.snapEnabled;
        s.setSnapEnabled(next);
        toast.info(next ? "Snapping on" : "Snapping off — hold Alt for one-off");
        return;
      }

      // ---- selection: frame / visibility / edit ------------------------
      const selId = s.selection?.kind === "measurement" ? s.selection.measurementIds[0] : null;
      if (key === "f" && !e.shiftKey) {
        if (!selId) return;
        e.preventDefault();
        s.selectMeasurement(selId, { fly: true });
        return;
      }
      if (key === "v" && !e.shiftKey) {
        if (!selId) return;
        e.preventDefault();
        s.setMeasurementVisible(selId, !(s.measurementVisibility[selId] ?? true));
        return;
      }
      if (e.key === "Enter") {
        // Idle + a selected measurement → straight into the edit plane. The
        // adapter owns Enter during editing/calcReady (commit); the CLAIM stamp
        // keeps one keypress from doing both when it runs after us in the same
        // dispatch (listener order is load-dependent).
        if ((e as ClaimedKeyEvent).__geoidEnterClaimed) return;
        if (machineState === "idle" && selId && !s.probing) {
          e.preventDefault();
          (e as ClaimedKeyEvent).__geoidEnterClaimed = true;
          actions.editGeometry();
        }
        return;
      }

      // ---- lenses (only what the survey actually has) -------------------
      if (key === "1") {
        const ramp = firstRamp(s.layerControls);
        if (!ramp) {
          toast.info("No elevation ramp in this survey");
          return;
        }
        e.preventDefault();
        const on = s.view.colorMap !== "None";
        actions.handleColorMapChange(on ? "None" : ramp);
        toast.info(on ? "Elevation ramp off" : `Lens: ${ramp} ramp`);
        return;
      }
      if (key === "2") {
        const has = s.layerControls.some((l) => l.lensRamp === "hillshade");
        if (!has) {
          toast.info("No hillshade layer in this survey");
          return;
        }
        e.preventDefault();
        const on = s.view.shading === "Hillshade";
        actions.handleShadingChange(on ? "None" : "Hillshade");
        toast.info(on ? "Hillshade off" : "Lens: hillshade");
        return;
      }
      if (key === "3") {
        const intervals = contourIntervals(s.layerControls);
        if (intervals.length === 0) {
          toast.info("No contour layers in this survey");
          return;
        }
        e.preventDefault();
        // Cycle: off → 0.5m → 1m → … → off (0 shows no interval = off).
        const current = s.view.contourIntervalM ?? 0;
        const idx = intervals.indexOf(current);
        const next = idx === -1 ? intervals[0] : idx + 1 < intervals.length ? intervals[idx + 1] : 0;
        actions.handleContourIntervalChange(next);
        toast.info(next === 0 ? "Contours off" : `Contours: ${next} m`);
        return;
      }
      if (key === "4") {
        e.preventDefault();
        const on = !s.view.sunLightingEnabled;
        actions.handleSunLightingChange(on, s.view.sunHour ?? 12);
        toast.info(on ? "Sun lighting on" : "Sun lighting off");
        return;
      }
      if (key === "0") {
        e.preventDefault();
        if (s.view.colorMap !== "None") actions.handleColorMapChange("None");
        if (s.view.shading !== "None") actions.handleShadingChange("None");
        if ((s.view.contourIntervalM ?? 0) !== 0) actions.handleContourIntervalChange(0);
        if (s.view.sunLightingEnabled) actions.handleSunLightingChange(false, s.view.sunHour ?? 12);
        toast.info("Lenses off");
        return;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [actor, store, actions, onToggleSheet]);
}
