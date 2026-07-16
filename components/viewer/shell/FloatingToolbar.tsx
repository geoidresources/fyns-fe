"use client";

// Zone 3 — FloatingToolbar (viewer-shell RE-PIVOT 2026-07-16). The user pointed
// at the original MeasurePalette tool grid and asked for THOSE six geometry
// primitives in the floating toolbar, with the CALCULATION modules ("what to
// compute and how") living in the right panel instead. So the toolbar is now a
// pure GEOMETRY picker — Point / Line / Polygon / Section / Probe / Slope — and
// carries no template/calculation choice. A tool starts a draw (or probe) with a
// NEUTRAL kind; which calculation runs over that geometry is chosen later in the
// MeasureSidebar (§calc-panel). This decouples the shape from the computation,
// exactly as the retired MeasurePalette grid did (it called startDraw with
// label/slope/toolKey and no kind), just relocated to the toolbar the user liked.
//
// Store wiring (§3.5): startDraw/startProbe/cancelDraw via useViewerActions; the
// single lit button is the one whose `palette:<id>` key === activeToolKey; and
// re-clicking the live tool cancels it (re-running startDraw would discard the
// in-progress vertices). Undo removes the last vertex; Snap is a Phase-2 stub.

import React, { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AreaChart,
  Circle,
  Grid3x3,
  Minus,
  MousePointer,
  Pentagon,
  Scissors,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";

import type { DrawMode, DrawOptions } from "@/components/viewer/MeasurementPanel";
import { useViewerStore } from "@/lib/viewer/state/store";
import { useViewerActions } from "@/components/viewer/shell/viewerActions";

// The six geometry primitives, mirroring the retired MeasurePalette TOOLS grid
// the user asked to promote into the toolbar. `probe` tools sample a point;
// `draw` tools open a polyline/polygon draw. `opts` carries label/slope only —
// NO kind, so the calculation stays a right-panel choice.
type PaletteToolId = "point" | "line" | "polygon" | "section" | "probe" | "slope";

interface PaletteTool {
  id: PaletteToolId;
  icon: React.ComponentType<{ size?: number | string; className?: string }>;
  label: string;
  probe?: boolean;
  draw?: DrawMode;
  opts?: DrawOptions;
}

const TOOLS: PaletteTool[] = [
  { id: "point", icon: MousePointer, label: "Point", probe: true },
  { id: "line", icon: Minus, label: "Line", draw: "polyline", opts: { label: "Line" } },
  { id: "polygon", icon: Pentagon, label: "Polygon", draw: "polygon", opts: { label: "Polygon" } },
  { id: "section", icon: Scissors, label: "Section", draw: "polyline", opts: { label: "Section" } },
  { id: "probe", icon: Circle, label: "Probe", probe: true },
  { id: "slope", icon: AreaChart, label: "Slope", draw: "polyline", opts: { label: "Slope", slope: true } },
];

// Namespaced so the toolbar's keys never collide with the rail or other tool
// hosts in the shared activeToolKey (the retired grid used the same scheme).
const keyFor = (id: PaletteToolId) => `palette:${id}`;

/** Icon-only pill that pops its label out on hover — the floating feel the user
 * asked to keep (ported from ViewerDrawToolbar.tsx). */
function ToolPill({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <motion.button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      whileTap={{ scale: 0.94 }}
      layout
      transition={{ type: "spring", stiffness: 400, damping: 26 }}
      className={`flex h-8 items-center overflow-hidden rounded-2xl transition-colors ${
        active ? "" : hovered ? "bg-white/5" : ""
      }`}
    >
      <motion.span
        layout
        animate={{ scale: hovered ? 1.12 : 1 }}
        transition={{ type: "spring", stiffness: 400, damping: 17 }}
        className={`flex size-8 shrink-0 items-center justify-center rounded-2xl ${
          active
            ? "bg-[#C97A4E]/[0.15] text-[#C97A4E] shadow-[0_0_8px_0_rgba(194,112,62,0.2)]"
            : hovered
              ? "text-white"
              : "text-gray-300"
        }`}
      >
        {icon}
      </motion.span>
      <AnimatePresence initial={false}>
        {hovered && (
          <motion.span
            key="label"
            initial={{ width: 0, opacity: 0, scale: 0.8 }}
            animate={{ width: "auto", opacity: 1, scale: 1 }}
            exit={{ width: 0, opacity: 0, scale: 0.8 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            className={`whitespace-nowrap text-[11px] font-medium ${
              active ? "text-[#C97A4E]" : "text-[#f4f4f5]"
            }`}
          >
            <span className="pl-1 pr-2">{label}</span>
          </motion.span>
        )}
      </AnimatePresence>
    </motion.button>
  );
}

export function FloatingToolbar() {
  const activeToolKey = useViewerStore((s) => s.activeToolKey);
  const actions = useViewerActions();

  const launchTool = (t: PaletteTool) => {
    const key = keyFor(t.id);
    // Re-clicking the live tool cancels it (starting the same draw again would
    // discard the in-progress vertices) — ported from the MeasurePalette grid.
    if (activeToolKey === key) {
      actions.cancelDraw();
      return;
    }
    if (t.probe) {
      actions.startProbe(key);
      return;
    }
    if (t.draw) {
      actions.startDraw(t.draw, { ...t.opts, toolKey: key });
    }
  };

  return (
    <div className="pointer-events-auto absolute left-1/2 top-4 z-20 flex -translate-x-1/2 items-center gap-1 rounded-full border border-white/[0.06] bg-[#111114]/85 p-[7px] shadow-[0_4px_24px_0_rgba(0,0,0,0.5)] backdrop-blur-md">
      {TOOLS.map((t) => {
        const Icon = t.icon;
        return (
          <ToolPill
            key={t.id}
            label={t.label}
            icon={<Icon size={18} />}
            active={activeToolKey === keyFor(t.id)}
            onClick={() => launchTool(t)}
          />
        );
      })}

      <div className="mx-1 h-5 w-px bg-white/[0.08]" />

      <ToolPill
        label="Undo"
        icon={<Undo2 size={18} />}
        active={false}
        onClick={actions.undoLastVertex}
      />
      <ToolPill
        label="Snap"
        icon={<Grid3x3 size={18} />}
        active={false}
        onClick={() => toast.info("Snapping — coming in a later phase")}
      />
    </div>
  );
}
