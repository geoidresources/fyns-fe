"use client";

// ⌘K command palette (enrichment Phase 2) — fuzzy jump to any tool, lens,
// measurement, or preference. Every item runs through EXISTING machinery
// (toolLaunch guards, machine events, store actions) so palette semantics can
// never drift from the toolbar/hotkeys. Portaled to <body> (framer ancestors
// set `transform`, which captures position:fixed — the context-menu lesson).
//
// Keyboard: ⌘K/Ctrl+K toggles (registered in useViewerHotkeys), ↑/↓ move,
// Enter runs, Esc closes. The list re-ranks per keystroke via the pure scorer
// in lib/viewer/palette.ts.

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { StoreApi } from "zustand/vanilla";
import { useStore } from "zustand";

import { rankEntries } from "@/lib/viewer/palette";
import type { ViewerShellState } from "@/lib/viewer/state/store";
import { useViewerStore } from "@/lib/viewer/state/store";
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
} from "@/components/viewer/shell/hooks/toolLaunch";

interface PaletteItem {
  id: string;
  label: string;
  keywords?: string;
  section: "Tools" | "View" | "Measurements" | "Selection" | "Preferences" | "Help";
  /** Bound hotkey shown right-aligned (documentation, not the trigger). */
  hint?: string;
  run: () => void;
}

export function CommandPalette({
  open,
  onClose,
  actor,
  store,
  actions,
  onShowSheet,
}: {
  open: boolean;
  onClose: () => void;
  actor: InteractionActor;
  store: StoreApi<ViewerShellState>;
  actions: HotkeyActions & { redrawGeometry: () => void };
  onShowSheet: () => void;
}) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const measurements = useViewerStore((s) => s.measurements);
  const selection = useViewerStore((s) => s.selection);
  const assistance = useViewerStore((s) => s.drawingAssistance);
  // Store-api reads inside run() callbacks stay fresh; useStore above is only
  // for list/label reactivity while the palette is open.
  useStore(store, (s) => s.snapEnabled);

  // Reset per open so it always starts blank — adjusted during render (the
  // repo's FeatureInspector pattern; an effect-setState would cascade renders).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setQuery("");
      setCursor(0);
    }
  }
  // Focus is a DOM side effect, so it stays in an effect.
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [open]);

  const items = useMemo<PaletteItem[]>(() => {
    if (!open) return [];
    const s = store.getState();
    const selId = selection?.kind === "measurement" ? selection.measurementIds[0] : null;
    const list: PaletteItem[] = [
      // ---- tools ----
      { id: "tool-point", label: "Point (elevation)", keywords: "probe sample tool", section: "Tools", hint: "P", run: () => launchProbe(actor, store, actions, "palette:point") },
      { id: "tool-probe", label: "Probe", keywords: "identify sample tool", section: "Tools", hint: "I", run: () => launchProbe(actor, store, actions, "palette:probe") },
      { id: "tool-line", label: "Line", keywords: "distance draw tool", section: "Tools", hint: "L", run: () => launchDrawTemplate(actor, store, actions, "line") },
      { id: "tool-area", label: "Area (polygon)", keywords: "volume stockpile draw tool", section: "Tools", hint: "A", run: () => launchDrawTemplate(actor, store, actions, "polygon") },
      { id: "tool-section", label: "Cross-section", keywords: "profile draw tool", section: "Tools", hint: "X", run: () => launchDrawTemplate(actor, store, actions, "section") },
      { id: "tool-slope", label: "Grade / slope", keywords: "gradient draw tool", section: "Tools", hint: "G", run: () => launchDrawTemplate(actor, store, actions, "slope") },
      { id: "tool-snap", label: s.snapEnabled ? "Turn snapping off" : "Turn snapping on", keywords: "snap magnet vertices", section: "Tools", hint: "S", run: () => toggleSnap(store) },
      // ---- view lenses ----
      { id: "lens-ramp", label: "Toggle elevation ramp", keywords: "colormap terrain viridis lens height", section: "View", hint: "1", run: () => toggleElevationRamp(store, actions) },
      { id: "lens-hillshade", label: "Toggle hillshade", keywords: "shading relief lens", section: "View", hint: "2", run: () => toggleHillshade(store, actions) },
      { id: "lens-contours", label: "Cycle contour interval", keywords: "isolines lens", section: "View", hint: "3", run: () => cycleContours(store, actions) },
      { id: "lens-sun", label: "Toggle sun lighting", keywords: "shadows daylight lens", section: "View", hint: "4", run: () => toggleSunLighting(store, actions) },
      { id: "lens-off", label: "All lenses off", keywords: "reset view ortho", section: "View", hint: "0", run: () => allLensesOff(store, actions) },
      // ---- preferences / help ----
      { id: "pref-assist", label: assistance === "assisted" ? "Switch to Precise drawing" : "Switch to Assisted drawing", keywords: "assistance mode defaults auto compute", section: "Preferences", run: () => s.setDrawingAssistance(assistance === "assisted" ? "precise" : "assisted") },
      { id: "help-keys", label: "Keyboard shortcuts", keywords: "help cheat sheet keys", section: "Help", hint: "?", run: () => onShowSheet() },
    ];
    // ---- selection actions (only when a measurement is selected) ----
    if (selId) {
      list.push(
        { id: "sel-edit", label: "Edit shape", keywords: "reshape vertices selected", section: "Selection", hint: "↵", run: () => actions.editGeometry() },
        { id: "sel-redraw", label: "Redraw shape", keywords: "trace replace selected", section: "Selection", run: () => actions.redrawGeometry() },
        { id: "sel-frame", label: "Frame selection", keywords: "fly zoom focus", section: "Selection", hint: "F", run: () => s.selectMeasurement(selId, { fly: true }) },
        { id: "sel-vis", label: "Show / hide selection", keywords: "visibility toggle", section: "Selection", hint: "V", run: () => s.setMeasurementVisible(selId, !(s.measurementVisibility[selId] ?? true)) }
      );
    }
    // ---- measurements (select + frame) ----
    for (const m of measurements) {
      list.push({
        id: `m-${m.id}`,
        label: m.name,
        keywords: `measurement ${m.kind}`,
        section: "Measurements",
        run: () => s.selectMeasurement(m.id, { fly: true }),
      });
    }
    return list;
  }, [open, store, actor, actions, measurements, selection, assistance, onShowSheet]);

  const ranked = useMemo(() => rankEntries(items, query), [items, query]);
  const clampedCursor = Math.min(cursor, Math.max(0, ranked.length - 1));

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        // stopImmediatePropagation: capture-phase beats the viewer's bubble-
        // phase Esc (cancel draw) for real key presses, and immediate-stop also
        // covers same-node listener ordering — Esc here ONLY closes the palette.
        e.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  const runItem = (item: PaletteItem) => {
    onClose();
    item.run();
  };

  return createPortal(
    <>
      <div className="fixed inset-0 z-[80] bg-black/50" onPointerDown={onClose} />
      <div
        role="dialog"
        aria-label="Command palette"
        className="fixed left-1/2 top-[18%] z-[81] w-[min(560px,calc(100vw-32px))] -translate-x-1/2 overflow-hidden rounded-2xl border border-white/[0.08] bg-[#141417]/95 shadow-[0_16px_60px_rgba(0,0,0,0.6)] backdrop-blur-md"
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setCursor(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setCursor((c) => Math.min(c + 1, ranked.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setCursor((c) => Math.max(c - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              const item = ranked[clampedCursor];
              if (item) runItem(item as PaletteItem);
            }
          }}
          placeholder="Jump to a tool, lens, or measurement…"
          aria-label="Search commands"
          className="w-full border-b border-white/[0.07] bg-transparent px-4 py-3.5 text-[14px] text-gray-100 placeholder:text-gray-500 focus:outline-none"
        />
        <div role="listbox" aria-label="Commands" className="max-h-[46vh] overflow-y-auto p-1.5">
          {ranked.length === 0 && (
            <p className="px-3 py-6 text-center text-[12.5px] text-gray-500">
              Nothing matches “{query}”
            </p>
          )}
          {ranked.map((item, i) => {
            const it = item as PaletteItem;
            const prev = i > 0 ? (ranked[i - 1] as PaletteItem) : null;
            const showHeader = query.trim() === "" && it.section !== prev?.section;
            return (
              <div key={it.id}>
                {showHeader && (
                  <p className="px-2.5 pb-1 pt-2.5 font-mono text-[9.5px] uppercase tracking-[0.14em] text-[#C97A4E]">
                    {it.section}
                  </p>
                )}
                <button
                  type="button"
                  role="option"
                  aria-selected={i === clampedCursor}
                  onClick={() => runItem(it)}
                  onMouseEnter={() => setCursor(i)}
                  className={`flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors ${
                    i === clampedCursor ? "bg-[#C97A4E]/15 text-gray-100" : "text-gray-300"
                  }`}
                >
                  <span className="truncate">{it.label}</span>
                  {it.hint && (
                    <kbd className="rounded-md border border-white/[0.12] bg-[#26262b] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-gray-400">
                      {it.hint}
                    </kbd>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </>,
    document.body
  );
}
