"use client";

import React, { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Box,
  Circle,
  Crosshair,
  Grid3x3,
  Minus,
  MoreHorizontal,
  Pentagon,
  Scissors,
  Triangle,
  TrendingUp,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";
import type { DrawMode, DrawOptions } from "@/components/viewer/MeasurementPanel";

// The floating in-canvas draw toolbar from the design — a top-center pill of
// drawing tools. Point/Elevation sample the surface (probe), the drawing
// primitives carry presets into the live draw flow, Undo removes the last
// placed vertex; the remaining actions stay scaffolded with a toast.
// Every tool collapses to its icon at rest and pops out its label on hover.

type ToolId =
  | "point"
  | "line"
  | "polygon"
  | "section"
  | "area"
  | "slope"
  | "volume"
  | "elevation"
  | "undo"
  | "snap"
  | "more";

interface ToolDef {
  id: ToolId;
  label: string;
  icon: React.ReactNode;
  draw?: DrawMode; // maps to a live draw mode
  opts?: DrawOptions; // preset carried into the draw
  probe?: boolean; // samples a surface point instead of drawing
  divider?: boolean; // render a divider before this tool
}

const SZ = 18;

const TOOLS: ToolDef[] = [
  { id: "point", label: "Point", icon: <Crosshair size={SZ} />, probe: true },
  { id: "line", label: "Line", icon: <Minus size={SZ} />, draw: "polyline", opts: { label: "Line" } },
  { id: "polygon", label: "Polygon", icon: <Pentagon size={SZ} />, draw: "polygon", opts: { label: "Polygon" } },
  { id: "section", label: "Section", icon: <Scissors size={SZ} />, draw: "polyline", opts: { label: "Section" } },
  { id: "area", label: "Area", icon: <Circle size={SZ} />, draw: "polygon", opts: { label: "Area" } },
  { id: "slope", label: "Slope", icon: <TrendingUp size={SZ} />, draw: "polyline", opts: { label: "Slope", slope: true } },
  { id: "volume", label: "Volume", icon: <Box size={SZ} />, draw: "polygon", opts: { label: "Volume" }, divider: true },
  { id: "elevation", label: "Elevation", icon: <Triangle size={SZ} />, probe: true },
  { id: "undo", label: "Undo", icon: <Undo2 size={SZ} /> },
  { id: "snap", label: "Snap to grid", icon: <Grid3x3 size={SZ} /> },
  { id: "more", label: "More", icon: <MoreHorizontal size={SZ} /> },
];

interface ViewerDrawToolbarProps {
  activeToolKey: string | null;
  onStartDraw: (mode: DrawMode, opts?: DrawOptions) => void;
  onStartProbe: (toolKey?: string) => void;
  onCancelDraw: () => void;
  onUndo: () => void;
}

// Namespaced so this toolbar's buttons never collide with the left rail or the
// measure palette in the shared activeToolKey.
const keyFor = (id: ToolId) => `draw:${id}`;

/** Icon-only pill that pops its label out on hover and collapses back on leave. */
function ToolPill({
  tool,
  active,
  onClick,
}: {
  tool: ToolDef;
  active: boolean;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <motion.button
      type="button"
      aria-label={tool.label}
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
        {tool.icon}
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
            <span className="pl-1 pr-2">{tool.label}</span>
          </motion.span>
        )}
      </AnimatePresence>
    </motion.button>
  );
}

export function ViewerDrawToolbar({
  activeToolKey,
  onStartDraw,
  onStartProbe,
  onCancelDraw,
  onUndo,
}: ViewerDrawToolbarProps) {
  const handle = (t: ToolDef) => {
    if (t.probe) {
      // Re-clicking the active probe tool ends it.
      if (activeToolKey === keyFor(t.id)) {
        onCancelDraw();
        return;
      }
      onStartProbe(keyFor(t.id));
      return;
    }
    if (t.draw) {
      // Re-clicking the active draw tool cancels it.
      if (activeToolKey === keyFor(t.id)) {
        onCancelDraw();
        return;
      }
      onStartDraw(t.draw, { ...t.opts, toolKey: keyFor(t.id) });
      return;
    }
    if (t.id === "undo") {
      onUndo();
      return;
    }
    toast.info(`${t.label} — coming soon`);
  };

  return (
    <div className="pointer-events-auto absolute left-1/2 top-4 z-20 flex -translate-x-1/2 items-center gap-1 rounded-full border border-white/[0.06] bg-[#111114]/85 p-[7px] shadow-[0_4px_24px_0_rgba(0,0,0,0.5)] backdrop-blur-md">
      {TOOLS.map((t) => (
        <React.Fragment key={t.id}>
          {t.divider && <div className="mx-1 h-5 w-px bg-white/[0.08]" />}
          <ToolPill tool={t} active={activeToolKey === keyFor(t.id)} onClick={() => handle(t)} />
        </React.Fragment>
      ))}
    </div>
  );
}
