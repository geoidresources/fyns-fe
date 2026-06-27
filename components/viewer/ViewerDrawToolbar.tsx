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
import type { DrawMode } from "@/components/viewer/MeasurementPanel";

// The floating in-canvas draw toolbar from the design — a top-center pill of
// drawing tools. The active tool shows an icon + label with an accent glow.
// Drawing primitives are wired to the live draw flow; the remaining actions are
// scaffolded with tooltips + a "coming soon" toast.

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
  idle?: boolean; // returns to the idle/select state
  divider?: boolean; // render a divider before this tool
}

const SZ = 18;

const TOOLS: ToolDef[] = [
  { id: "point", label: "Point", icon: <Crosshair size={SZ} />, idle: true },
  { id: "line", label: "Line", icon: <Minus size={SZ} />, draw: "polyline" },
  { id: "polygon", label: "Polygon", icon: <Pentagon size={SZ} />, draw: "polygon" },
  { id: "section", label: "Section", icon: <Scissors size={SZ} />, draw: "polyline" },
  { id: "area", label: "Area", icon: <Circle size={SZ} />, draw: "polygon" },
  { id: "slope", label: "Slope", icon: <TrendingUp size={SZ} />, draw: "polyline" },
  { id: "volume", label: "Volume", icon: <Box size={SZ} />, draw: "polygon", divider: true },
  { id: "elevation", label: "Elevation", icon: <Triangle size={SZ} /> },
  { id: "undo", label: "Undo", icon: <Undo2 size={SZ} /> },
  { id: "snap", label: "Snap to grid", icon: <Grid3x3 size={SZ} /> },
  { id: "more", label: "More", icon: <MoreHorizontal size={SZ} /> },
];

interface ViewerDrawToolbarProps {
  drawMode: DrawMode | null;
  onStartDraw: (mode: DrawMode) => void;
  onCancelDraw: () => void;
}

export function ViewerDrawToolbar({ drawMode, onStartDraw, onCancelDraw }: ViewerDrawToolbarProps) {
  const [tool, setTool] = useState<ToolId>("point");

  // While a draw is active the chosen tool stays lit; once it ends (drawMode
  // null) fall back to Point — derived, so no effect/state-sync is needed.
  const activeTool: ToolId = drawMode ? tool : "point";

  const handle = (t: ToolDef) => {
    if (t.idle) {
      setTool("point");
      onCancelDraw();
      return;
    }
    if (t.draw) {
      setTool(t.id);
      onStartDraw(t.draw);
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
