"use client";

// Shared tool/lens launchers — the SINGLE source of the toolbar-parity guards,
// consumed by BOTH the hotkeys hook and the ⌘K command palette so their
// semantics can never drift: a busy draft blocks tool switches (toast, the
// machine would drop it silently), an armed-but-empty draw yields to a probe
// via ESC, probes re-toggle off, and lens toggles map only to layers the
// survey actually has.

import type { ActorRefFrom } from "xstate";
import type { StoreApi } from "zustand/vanilla";
import { toast } from "sonner";

import type { interactionMachine } from "@/lib/viewer/interaction/machine";
import type { TemplateId } from "@/lib/viewer/interaction/templates";
import type { ViewerShellState } from "@/lib/viewer/state/store";
import type { LayerControl } from "@/components/viewer/LayerPanel";

export type InteractionActor = ActorRefFrom<typeof interactionMachine>;

/** The subset of ViewerActions the keyboard surfaces drive (kept narrow). */
export interface HotkeyActions {
  startProbe: (toolKey?: string) => void;
  cancelDraw: () => void;
  editGeometry: () => void;
  handleColorMapChange: (value: string) => void;
  handleShadingChange: (value: string) => void;
  handleContourIntervalChange: (intervalM: number) => void;
  handleSunLightingChange: (enabled: boolean, hour: number) => void;
}

const RAMP_NAMES = ["viridis", "terrain", "plasma", "grayscale"];
const isContourRole = (role?: string | null) =>
  !!role && (role === "contours" || role.startsWith("contours_"));

/** First available elevation ramp, capitalized the way the Select stores it. */
export function firstRamp(layers: LayerControl[]): string | null {
  for (const l of layers) {
    if (l.lensRamp && RAMP_NAMES.includes(l.lensRamp)) {
      return l.lensRamp.charAt(0).toUpperCase() + l.lensRamp.slice(1);
    }
  }
  return null;
}

export function contourIntervals(layers: LayerControl[]): number[] {
  const seen = new Set<number>();
  for (const l of layers) {
    if (isContourRole(l.vectorRole) && l.intervalM && l.intervalM > 0) seen.add(l.intervalM);
  }
  return Array.from(seen).sort((a, b) => a - b);
}

const busyDrafting = (actor: InteractionActor): boolean => {
  const snap = actor.getSnapshot();
  return (
    (snap.value === "placing" && snap.context.draft.length > 0) || snap.value === "calcReady"
  );
};

/** Arm a draw template (machine decides toggles/switches). Returns false when
 * blocked by a busy draft — the caller already toasted-for by this helper. */
export function launchDrawTemplate(
  actor: InteractionActor,
  store: StoreApi<ViewerShellState>,
  actions: HotkeyActions,
  templateId: TemplateId
): boolean {
  const armedTemplateId = actor.getSnapshot().context.template?.id ?? null;
  if (busyDrafting(actor) && armedTemplateId !== templateId) {
    toast.info("Finish the drawing (or press Esc) before switching tools");
    return false;
  }
  if (store.getState().probing) actions.cancelDraw(); // leave probe before arming
  actor.send({ type: "TEMPLATE_PICKED", templateId });
  return true;
}

/** Start (or re-toggle off) a probe/point tool. Yields the armed-empty draw
 * via ESC first; blocked with a toast when a real draft is in progress. */
export function launchProbe(
  actor: InteractionActor,
  store: StoreApi<ViewerShellState>,
  actions: HotkeyActions,
  toolKey: string
): boolean {
  const s = store.getState();
  if (s.probing && s.activeToolKey === toolKey) {
    actions.cancelDraw(); // re-press toggles off (toolbar parity)
    return true;
  }
  if (busyDrafting(actor)) {
    toast.info("Finish the drawing (or press Esc) first");
    return false;
  }
  if (actor.getSnapshot().value === "placing") actor.send({ type: "ESC" }); // armed, no verts
  if (s.probing) actions.cancelDraw(); // switching probe kinds
  actions.startProbe(toolKey);
  return true;
}

// ---- lenses (each returns false when the survey lacks the layer) -----------

export function toggleElevationRamp(
  store: StoreApi<ViewerShellState>,
  actions: HotkeyActions
): boolean {
  const s = store.getState();
  const ramp = firstRamp(s.layerControls);
  if (!ramp) {
    toast.info("No elevation ramp in this survey");
    return false;
  }
  const on = s.view.colorMap !== "None";
  actions.handleColorMapChange(on ? "None" : ramp);
  toast.info(on ? "Elevation ramp off" : `Lens: ${ramp} ramp`);
  return true;
}

export function toggleHillshade(
  store: StoreApi<ViewerShellState>,
  actions: HotkeyActions
): boolean {
  const s = store.getState();
  if (!s.layerControls.some((l) => l.lensRamp === "hillshade")) {
    toast.info("No hillshade layer in this survey");
    return false;
  }
  const on = s.view.shading === "Hillshade";
  actions.handleShadingChange(on ? "None" : "Hillshade");
  toast.info(on ? "Hillshade off" : "Lens: hillshade");
  return true;
}

/** Cycle contours: off → smallest interval → … → largest → off (0 = off). */
export function cycleContours(
  store: StoreApi<ViewerShellState>,
  actions: HotkeyActions
): boolean {
  const s = store.getState();
  const intervals = contourIntervals(s.layerControls);
  if (intervals.length === 0) {
    toast.info("No contour layers in this survey");
    return false;
  }
  const current = s.view.contourIntervalM ?? 0;
  const idx = intervals.indexOf(current);
  const next = idx === -1 ? intervals[0] : idx + 1 < intervals.length ? intervals[idx + 1] : 0;
  actions.handleContourIntervalChange(next);
  toast.info(next === 0 ? "Contours off" : `Contours: ${next} m`);
  return true;
}

export function toggleSunLighting(
  store: StoreApi<ViewerShellState>,
  actions: HotkeyActions
): void {
  const s = store.getState();
  const on = !s.view.sunLightingEnabled;
  actions.handleSunLightingChange(on, s.view.sunHour ?? 12);
  toast.info(on ? "Sun lighting on" : "Sun lighting off");
}

export function allLensesOff(
  store: StoreApi<ViewerShellState>,
  actions: HotkeyActions
): void {
  const s = store.getState();
  if (s.view.colorMap !== "None") actions.handleColorMapChange("None");
  if (s.view.shading !== "None") actions.handleShadingChange("None");
  if ((s.view.contourIntervalM ?? 0) !== 0) actions.handleContourIntervalChange(0);
  if (s.view.sunLightingEnabled) actions.handleSunLightingChange(false, s.view.sunHour ?? 12);
  toast.info("Lenses off");
}

export function toggleSnap(store: StoreApi<ViewerShellState>): void {
  const s = store.getState();
  const next = !s.snapEnabled;
  s.setSnapEnabled(next);
  toast.info(next ? "Snapping on" : "Snapping off — hold Alt for one-off");
}
