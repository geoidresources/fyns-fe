"use client";

import React, { useState } from "react";
import { motion } from "framer-motion";
import {
  Bomb,
  Download,
  Droplet,
  FileBarChart,
  MousePointer2,
  Ruler,
  ShieldAlert,
  Sparkles,
  Spline,
  Tag,
  Upload,
  Waypoints,
} from "lucide-react";
import { toast } from "sonner";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { DrawMode, DrawOptions } from "@/components/viewer/MeasurementPanel";

// The 48px map-tools rail from the design — select + measurement/annotation
// tools, then export/import. Draw-shaped tools carry a preset (backend kind +
// target folder) into the live draw flow; Export downloads the survey's
// measurements as GeoJSON; the rest stay scaffolded with a "coming soon"
// toast, consistent with the +Add layer placeholder.

type ToolId =
  | "select"
  | "distance"
  | "section"
  | "route"
  | "hydro"
  | "alert"
  | "blast"
  | "detect"
  | "annotate"
  | "report"
  | "export"
  | "import";

interface ToolDef {
  id: ToolId;
  label: string;
  icon: React.ReactNode;
  draw?: DrawMode; // maps to a live draw mode
  opts?: DrawOptions; // preset carried into the draw (kind/folder/label)
  divider?: boolean; // render a divider above this tool
}

const SIZE = 18;

const TOOLS: ToolDef[] = [
  { id: "select", label: "Select", icon: <MousePointer2 size={SIZE} /> },
  { id: "distance", label: "Distance", icon: <Ruler size={SIZE} />, draw: "polyline", opts: { label: "Distance" } },
  { id: "section", label: "Cross-section", icon: <Spline size={SIZE} />, draw: "polyline", opts: { label: "Cross-section" } },
  { id: "route", label: "Route", icon: <Waypoints size={SIZE} />, draw: "polyline", opts: { label: "Route", folder: "Haul road analysis" } },
  { id: "hydro", label: "Hydrology", icon: <Droplet size={SIZE} />, draw: "polygon", opts: { label: "Hydrology", folder: "Hydro" } },
  { id: "alert", label: "Exclusion zone", icon: <ShieldAlert size={SIZE} />, draw: "polygon", opts: { label: "Exclusion zone", folder: "Blasting" } },
  { id: "blast", label: "Blast area", icon: <Bomb size={SIZE} />, draw: "polygon", opts: { label: "Blast area", folder: "Blasting" } },
  { id: "detect", label: "Auto-detect", icon: <Sparkles size={SIZE} /> },
  { id: "annotate", label: "Annotate", icon: <Tag size={SIZE} /> },
  { id: "report", label: "Report", icon: <FileBarChart size={SIZE} /> },
  { id: "export", label: "Export", icon: <Download size={SIZE} />, divider: true },
  { id: "import", label: "Import", icon: <Upload size={SIZE} /> },
];

interface ViewerToolRailProps {
  drawMode: DrawMode | null;
  onStartDraw: (mode: DrawMode, opts?: DrawOptions) => void;
  onCancelDraw: () => void;
  onExport: () => void;
}

export function ViewerToolRail({ drawMode, onStartDraw, onCancelDraw, onExport }: ViewerToolRailProps) {
  const [tool, setTool] = useState<ToolId>("select");

  // Highlight reflects the live draw state: while a draw is active, the chosen
  // draw tool stays lit; once it finishes/cancels (drawMode null), fall back to
  // Select — no effect/state-sync needed.
  const activeTool: ToolId = drawMode ? tool : "select";

  const handle = (t: ToolDef) => {
    if (t.id === "select") {
      setTool("select");
      onCancelDraw();
      return;
    }
    if (t.draw) {
      // Re-clicking the active draw tool cancels it.
      if (drawMode && activeTool === t.id) {
        setTool("select");
        onCancelDraw();
        return;
      }
      setTool(t.id);
      onStartDraw(t.draw, t.opts);
      return;
    }
    if (t.id === "export") {
      onExport();
      return;
    }
    toast.info(`${t.label} — coming soon`);
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex w-12 shrink-0 flex-col items-center gap-1.5 border-r border-white/[0.08] bg-[#111114] py-2 z-10">
        {TOOLS.map((t) => {
          const active = activeTool === t.id;
          return (
            <React.Fragment key={t.id}>
              {t.divider && <div className="my-0.5 h-px w-7 bg-white/[0.08]" />}
              <Tooltip>
                <TooltipTrigger asChild>
                  <motion.button
                    type="button"
                    aria-label={t.label}
                    aria-pressed={active}
                    onClick={() => handle(t)}
                    whileHover={{ scale: 1.15 }}
                    whileTap={{ scale: 0.9 }}
                    transition={{ type: "spring", stiffness: 400, damping: 17 }}
                    className={`flex size-9 items-center justify-center rounded-md border-l-2 transition-colors ${
                      active
                        ? "border-[#C97A4E] bg-[#C97A4E]/[0.12] text-[#C97A4E] shadow-[0_0_12px_0_rgba(194,112,62,0.25)]"
                        : "border-transparent text-gray-400 hover:bg-white/5 hover:text-gray-200"
                    }`}
                  >
                    {t.icon}
                  </motion.button>
                </TooltipTrigger>
                <TooltipContent side="right">{t.label}</TooltipContent>
              </Tooltip>
            </React.Fragment>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
