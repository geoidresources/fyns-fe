"use client";

// Zone 3 — FloatingToolbar (viewer-shell RE-PIVOT 2026-07-16). The user pointed
// at the original MeasurePalette tool grid and asked for THOSE six geometry
// primitives in the floating toolbar, with the CALCULATION modules ("what to
// compute and how") living in the right panel instead. So the toolbar is now a
// pure GEOMETRY picker — Point / Line / Polygon / Section / Probe / Slope — and
// carries no template/calculation choice. A tool starts a draw (or probe) with a
// NEUTRAL kind; which calculation runs over that geometry is chosen later in the
// DetailPanel (§calc-panel). This decouples the shape from the computation,
// exactly as the retired MeasurePalette grid did (it called startDraw with
// label/slope/toolKey and no kind), just relocated to the toolbar the user liked.
//
// Store wiring (§3.5): startDraw/startProbe/cancelDraw via useViewerActions; the
// single lit button is the one whose `palette:<id>` key === activeToolKey; and
// re-clicking the live tool cancels it (re-running startDraw would discard the
// in-progress vertices). Eraser is a pick mode — click a segment to delete it.
// Undo/Redo step through vertices, and Snap is a Phase-2 stub.

import React, { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AreaChart,
  Check,
  ChevronDown,
  Circle,
  Grid3x3,
  Minus,
  MousePointer,
  Pentagon,
  Redo2,
  Scissors,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";
import { useSelector } from "@xstate/react";

import type { DrawMode, DrawOptions } from "@/components/viewer/MeasurementPanel";
import { useViewerStore } from "@/lib/viewer/state/store";
import { useViewerActions } from "@/components/viewer/shell/viewerActions";
import { useInteractionActor } from "@/components/viewer/shell/interactionContext";
import { INTERACTION_V2 } from "@/lib/viewer/interaction/flag";
import {
  templatesFor,
  toolKeyFor,
  type MeasureTemplate,
  type TemplateGroup,
} from "@/lib/viewer/interaction/templates";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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
      className={`flex h-8 items-center overflow-hidden rounded-2xl outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#C97A4E] focus-visible:ring-offset-1 focus-visible:ring-offset-[#111114] ${
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
  // Interaction v2 seam (plan §P1): the flag is a build-time constant, so this
  // branch is stable for the whole session — no conditional-hook hazard.
  return INTERACTION_V2 ? <FloatingToolbarV2 /> : <FloatingToolbarLegacy />;
}

function FloatingToolbarLegacy() {
  const activeToolKey = useViewerStore((s) => s.activeToolKey);
  const drawMode = useViewerStore((s) => s.drawMode);
  const selection = useViewerStore((s) => s.selection);
  const actions = useViewerActions();

  const selectedMeasurementId =
    selection?.kind === "measurement" ? selection.measurementIds[0] : null;

  const launchTool = (t: PaletteTool) => {
    const key = keyFor(t.id);
    // Point tool DURING a live draw/edit session = identify+select a vertex/edge
    // (pointSelect handles its own on/off). Only outside a session does Point
    // fall through to the elevation probe below. Handled before the generic
    // toggle so re-clicking Point doesn't cancel the whole draw.
    if (t.id === "point" && drawMode) {
      actions.pointSelect();
      return;
    }
    // Re-clicking the live tool cancels it (starting the same draw again would
    // discard the in-progress vertices) — ported from the MeasurePalette grid.
    if (activeToolKey === key) {
      actions.cancelDraw();
      return;
    }
    // A draw tool clicked DURING an active session (e.g. after erasing an edge,
    // to add vertices into the gap) means "let me place vertices on THIS draft"
    // — NOT "throw it away and start over". startDraw would cleanupDraw the
    // in-progress geometry (the vanishing-drawing bug); resume placement on it.
    if (t.draw && drawMode) {
      actions.resumeVertexDraw(key);
      return;
    }
    // Line-tool-on-selection = EDIT that shape's vertices (the user's "the tool
    // triggered should be a line by default"). With a measurement selected and
    // nothing being drawn, Line drops into the drag-a-vertex editor instead of
    // starting a fresh line; the shape's type is preserved (a stockpile stays a
    // polygon). Without a selection it draws a new line as before.
    if (t.id === "line" && selectedMeasurementId && !drawMode) {
      actions.editGeometry();
      return;
    }
    // Polygon-tool-on-selection = REDRAW that shape: draw a fresh outline
    // (snapping onto existing corners) that replaces it on save. Without a
    // selection it draws a new polygon as before.
    if (t.id === "polygon" && selectedMeasurementId && !drawMode) {
      actions.redrawGeometry();
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

      {/* Eraser: vertex-to-vertex edge delete (click a vertex, then an adjacent
          one — a dotted line previews the edge). Works on an in-progress draw
          or a selected measurement (actions.eraseDraft). */}
      <ToolPill
        label="Eraser"
        icon={<Scissors size={18} />}
        active={activeToolKey === "palette:eraser"}
        onClick={actions.eraseDraft}
      />
      <ToolPill
        label="Undo"
        icon={<Undo2 size={18} />}
        active={false}
        onClick={actions.undoLastVertex}
      />
      <ToolPill
        label="Redo"
        icon={<Redo2 size={18} />}
        active={false}
        onClick={actions.redoLastVertex}
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

// ---------------------------------------------------------------------------
// Interaction v2 toolbar (plan §4): a pure CREATE-plane surface — three
// primitive buttons whose dropdowns list that group's templates (Propeller
// pattern), plus machine-driven Undo/Redo. No edit overloads: editing enters
// through the selected object (P2), never through these tools.

const GROUP_META: Record<TemplateGroup, { label: string; icon: React.ComponentType<{ size?: number | string }> }> = {
  point: { label: "Point", icon: MousePointer },
  line: { label: "Line", icon: Minus },
  polygon: { label: "Polygon", icon: Pentagon },
};

const TEMPLATE_ICONS: Partial<Record<string, React.ComponentType<{ size?: number | string }>>> = {
  point: MousePointer,
  probe: Circle,
  line: Minus,
  section: Scissors,
  slope: AreaChart,
  polygon: Pentagon,
};

function FloatingToolbarV2() {
  const actor = useInteractionActor();
  const actions = useViewerActions();
  // Store mirror keeps probe lit-state consistent with legacy panels.
  const activeToolKey = useViewerStore((s) => s.activeToolKey);
  const probing = useViewerStore((s) => s.probing);
  const machineState = useSelector(actor, (s) => s.value);
  const armedTemplateId = useSelector(actor, (s) => s.context.template?.id ?? null);
  const draftLen = useSelector(actor, (s) => s.context.draft.length);

  const busyDrafting =
    (machineState === "placing" && draftLen > 0) || machineState === "calcReady";

  const launchTemplate = (t: MeasureTemplate) => {
    if (t.probe) {
      // Probe rides the LEGACY path (plan: machine gains probing in P2).
      const key = toolKeyFor(t.id);
      if (activeToolKey === key) {
        actions.cancelDraw();
        return;
      }
      if (busyDrafting) {
        toast.info("Finish the drawing (or press Esc) first");
        return;
      }
      if (machineState === "placing") actor.send({ type: "ESC" }); // armed, no verts
      actions.startProbe(key);
      return;
    }
    // Draw templates: the machine decides — same template toggles off, a
    // mid-draft switch is blocked (ledger #1), everything else arms.
    if (busyDrafting && armedTemplateId !== t.id) {
      toast.info("Finish the drawing (or press Esc) before switching tools");
      return;
    }
    if (probing) actions.cancelDraw(); // leave probe before arming a draw
    actor.send({ type: "TEMPLATE_PICKED", templateId: t.id });
  };

  return (
    <div
      role="toolbar"
      aria-label="Measurement tools"
      aria-orientation="horizontal"
      className="pointer-events-auto absolute left-1/2 top-4 z-20 flex -translate-x-1/2 items-center gap-1 rounded-full border border-white/[0.06] bg-[#111114]/85 p-[7px] shadow-[0_4px_24px_0_rgba(0,0,0,0.5)] backdrop-blur-md"
    >
      {(Object.keys(GROUP_META) as TemplateGroup[]).map((group) => {
        const meta = GROUP_META[group];
        const groupTemplates = templatesFor(group);
        const armed = groupTemplates.find(
          (t) =>
            (t.probe && activeToolKey === toolKeyFor(t.id)) ||
            (!t.probe && armedTemplateId === t.id)
        );
        const defaultTemplate = groupTemplates[0];
        const Icon = armed ? TEMPLATE_ICONS[armed.id] ?? meta.icon : meta.icon;
        return (
          <div key={group} className="flex items-center">
            <ToolPill
              label={armed?.label ?? meta.label}
              icon={<Icon size={18} />}
              active={!!armed}
              onClick={() => launchTemplate(armed ?? defaultTemplate)}
            />
            {groupTemplates.length > 1 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label={`${meta.label} templates`}
                    className="flex h-8 w-6 items-center justify-center rounded-full text-gray-500 outline-none transition-colors hover:text-white focus-visible:ring-2 focus-visible:ring-[#C97A4E]"
                  >
                    <ChevronDown size={12} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  sideOffset={10}
                  className="min-w-[9rem] border-white/[0.08] bg-[#141417] text-[13px] text-gray-200"
                >
                  {groupTemplates.map((t) => {
                    const ItemIcon = TEMPLATE_ICONS[t.id] ?? meta.icon;
                    const isArmed = armed?.id === t.id;
                    return (
                      <DropdownMenuItem
                        key={t.id}
                        role="menuitemradio"
                        aria-checked={isArmed}
                        onSelect={() => launchTemplate(t)}
                        className={isArmed ? "text-[#C97A4E]" : undefined}
                      >
                        <ItemIcon size={14} />
                        <span className="pl-2">{t.label}</span>
                        {isArmed && <Check size={13} className="ml-auto" />}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        );
      })}

      <div className="mx-1 h-5 w-px bg-white/[0.08]" />

      <ToolPill
        label="Undo"
        icon={<Undo2 size={18} />}
        active={false}
        onClick={() => actor.send({ type: "UNDO" })}
      />
      <ToolPill
        label="Redo"
        icon={<Redo2 size={18} />}
        active={false}
        onClick={() => actor.send({ type: "REDO" })}
      />
      <ToolPill
        label="Snap"
        icon={<Grid3x3 size={18} />}
        active={false}
        onClick={() => toast.info("Snapping is on while drawing — a toggle comes with P2")}
      />
    </div>
  );
}
