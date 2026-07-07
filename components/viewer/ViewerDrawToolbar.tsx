"use client";

import React, { useState } from "react";
import { motion } from "framer-motion";
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { DrawMode, DrawOptions } from "@/components/viewer/MeasurementPanel";

// The floating in-canvas draw toolbar from the design — a top-center pill of
// drawing tools. Point/Elevation sample the surface (probe), the drawing
// primitives carry presets into the live draw flow, Undo removes the last
// placed vertex; the remaining actions stay scaffolded with a toast.

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
  drawMode: DrawMode | null;
  probing: boolean;
  onStartDraw: (mode: DrawMode, opts?: DrawOptions) => void;
  onStartProbe: () => void;
  onCancelDraw: () => void;
  onUndo: () => void;
}

export function ViewerDrawToolbar({
  drawMode,
  probing,
  onStartDraw,
  onStartProbe,
  onCancelDraw,
  onUndo,
}: ViewerDrawToolbarProps) {
  const [tool, setTool] = useState<ToolId>("point");

  // While a draw/probe is active the chosen tool stays lit; once it ends fall
  // back to Point — derived, so no effect/state-sync is needed.
  const activeTool: ToolId = drawMode || probing ? tool : "point";

  const handle = (t: ToolDef) => {
    if (t.probe) {
      // Re-clicking the active probe tool ends it.
      if (probing && activeTool === t.id) {
        setTool("point");
        onCancelDraw();
        return;
      }
      setTool(t.id);
      onStartProbe();
      return;
    }
    if (t.draw) {
      if (drawMode && activeTool === t.id) {
        setTool("point");
        onCancelDraw();
        return;
      }
      setTool(t.id);
      onStartDraw(t.draw, t.opts);
      return;
    }
    if (t.id === "undo") {
      onUndo();
      return;
    }
    toast.info(`${t.label} — coming soon`);
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div className="pointer-events-auto absolute left-1/2 top-4 z-20 flex -translate-x-1/2 items-center gap-1 rounded-full border border-white/[0.06] bg-[#111114]/85 p-[7px] shadow-[0_4px_24px_0_rgba(0,0,0,0.5)] backdrop-blur-md">
        {TOOLS.map((t) => {
          const active = activeTool === t.id;
          return (
            <React.Fragment key={t.id}>
              {t.divider && <div className="mx-1 h-5 w-px bg-white/[0.08]" />}
              {active ? (
                <motion.button
                  type="button"
                  aria-label={t.label}
                  aria-pressed
                  onClick={() => handle(t)}
                  whileHover={{ scale: 1.06 }}
                  whileTap={{ scale: 0.97 }}
                  transition={{ type: "spring", stiffness: 400, damping: 17 }}
                  className="flex items-center gap-1 rounded-2xl pr-2"
                >
                  <span className="flex size-8 items-center justify-center rounded-2xl bg-[#C97A4E]/[0.15] text-[#C97A4E] shadow-[0_0_8px_0_rgba(194,112,62,0.2)]">
                    {t.icon}
                  </span>
                  <span className="text-[11px] font-medium text-[#f4f4f5]">{t.label}</span>
                </motion.button>
              ) : (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <motion.button
                      type="button"
                      aria-label={t.label}
                      onClick={() => handle(t)}
                      whileHover={{ scale: 1.15 }}
                      whileTap={{ scale: 0.9 }}
                      transition={{ type: "spring", stiffness: 400, damping: 17 }}
                      className="flex size-8 items-center justify-center rounded-2xl text-gray-300 transition-colors hover:bg-white/5 hover:text-white"
                    >
                      {t.icon}
                    </motion.button>
                  </TooltipTrigger>
                  <TooltipContent>{t.label}</TooltipContent>
                </Tooltip>
              )}
            </React.Fragment>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
