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
import type { StoreApi } from "zustand/vanilla";

import type { TemplateId } from "@/lib/viewer/interaction/templates";
import type { ViewerShellState } from "@/lib/viewer/state/store";
import type { ClaimedKeyEvent } from "./useInteractionAdapter";
import {
  allLensesOff,
  cycleContours,
  launchDrawTemplate,
  launchProbe,
  toggleElevationRamp,
  toggleHillshade,
  toggleSnap,
  toggleSunLighting,
  type HotkeyActions,
  type InteractionActor,
} from "./toolLaunch";

export type { HotkeyActions } from "./toolLaunch";

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

export function useViewerHotkeys(
  actor: InteractionActor,
  store: StoreApi<ViewerShellState>,
  actions: HotkeyActions,
  /** Toggle the `?` shortcut cheat-sheet overlay (owned by ViewerCanvas). */
  onToggleSheet: () => void,
  /** Toggle the ⌘K command palette (owned by ViewerCanvas). */
  onTogglePalette: () => void
): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;

      // ⌘K / Ctrl+K: the command palette — a chord, so it works even while an
      // input has focus (standard palette behavior).
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onTogglePalette();
        return;
      }

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

      // ---- tools (shared toolbar-parity guards live in toolLaunch) ------
      const drawTemplate = DRAW_KEYS[key];
      if (drawTemplate && !e.shiftKey) {
        e.preventDefault();
        launchDrawTemplate(actor, store, actions, drawTemplate);
        return;
      }
      const probeKey = PROBE_KEYS[key];
      if (probeKey && !e.shiftKey) {
        e.preventDefault();
        launchProbe(actor, store, actions, probeKey);
        return;
      }

      if (key === "s" && !e.shiftKey) {
        e.preventDefault();
        toggleSnap(store);
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
        e.preventDefault();
        toggleElevationRamp(store, actions);
        return;
      }
      if (key === "2") {
        e.preventDefault();
        toggleHillshade(store, actions);
        return;
      }
      if (key === "3") {
        e.preventDefault();
        cycleContours(store, actions);
        return;
      }
      if (key === "4") {
        e.preventDefault();
        toggleSunLighting(store, actions);
        return;
      }
      if (key === "0") {
        e.preventDefault();
        allLensesOff(store, actions);
        return;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [actor, store, actions, onToggleSheet, onTogglePalette]);
}
