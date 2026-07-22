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
  Columns2,
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

import { useViewerStore } from "@/lib/viewer/state/store";
import { useViewerActions } from "@/components/viewer/shell/viewerActions";
import { useInteractionActor } from "@/components/viewer/shell/interactionContext";
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
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatSurveyDate } from "@/lib/utils";
import { nextCompareSeed } from "@/lib/viewer/compare";
import { useCompareSurveys } from "@/components/viewer/shell/hooks/useCompareSurveys";

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
  // Interaction v2 is the only interactive path now (P3 scoped-delete): the
  // legacy toolbar/draw/edit are gone. Probe/point still ride the legacy
  // startProbe from inside FloatingToolbarV2 until they migrate to the machine.
  return <FloatingToolbarV2 />;
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
  const snapEnabled = useViewerStore((s) => s.snapEnabled);
  const setSnapEnabled = useViewerStore((s) => s.setSnapEnabled);
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
        label={snapEnabled ? "Snap on" : "Snap off"}
        icon={<Grid3x3 size={18} />}
        active={snapEnabled}
        onClick={() => {
          const next = !snapEnabled;
          setSnapEnabled(next);
          toast.info(next ? "Snapping on" : "Snapping off — hold Alt for one-off");
        }}
      />

      {/* Compare — its OWN section on the RIGHT (renders its leading divider so
          a single-epoch project leaves no dangling separator). Independent of
          the draw/probe tools; shares the compare store slice with the bottom
          SurveyCompare control, so the two stay in sync automatically. */}
      <CompareSplitButton />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compare split-button (Compare Mode, Task 1): a main toggle (seed-on-activate,
// mirroring SurveyCompare.activate via the shared nextCompareSeed) + a chevron
// dropdown of A ▸ B epoch pickers. Purely additive — its own toolbar section.

function CompareSplitButton() {
  const surveyId = useViewerStore((s) => s.surveyId);
  const projectId = useViewerStore((s) => s.manifest?.survey.project_id ?? null);
  const compareActive = useViewerStore((s) => s.compareActive);
  const compareA = useViewerStore((s) => s.compareA);
  const compareB = useViewerStore((s) => s.compareB);
  const setCompareActive = useViewerStore((s) => s.setCompareActive);
  const setCompareA = useViewerStore((s) => s.setCompareA);
  const setCompareB = useViewerStore((s) => s.setCompareB);

  const { surveys } = useCompareSurveys(projectId);

  // Compare needs >=2 epochs; a single-survey project has nothing to compare
  // (return null AFTER all hooks — no dangling divider either, it's ours).
  if (!surveys || surveys.length < 2) return null;

  const toggle = () => {
    if (compareActive) {
      setCompareActive(false);
      return;
    }
    // Same seeding as SurveyCompare.activate (B ??= current, A ??= prev epoch).
    const { a, b } = nextCompareSeed({ surveyId, surveys, compareA, compareB });
    setCompareB(b);
    setCompareA(a);
    setCompareActive(true);
  };

  return (
    <>
      <div className="mx-1 h-5 w-px bg-white/[0.08]" />
      <div className="flex items-center">
        <ToolPill
          label="Compare"
          icon={<Columns2 size={18} />}
          active={compareActive}
          onClick={toggle}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Choose compare surveys"
              className="flex h-8 w-6 items-center justify-center rounded-full text-gray-500 outline-none transition-colors hover:text-white focus-visible:ring-2 focus-visible:ring-[#C97A4E]"
            >
              <ChevronDown size={12} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            sideOffset={10}
            className="min-w-[12rem] border-white/[0.08] bg-[#141417] text-[13px] text-gray-200"
          >
            <DropdownMenuLabel>Before (A)</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={compareA ?? undefined} onValueChange={setCompareA}>
              {surveys.map((s) => (
                <DropdownMenuRadioItem key={`a-${s.id}`} value={s.id}>
                  {formatSurveyDate(s.survey_date)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>After (B)</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={compareB ?? undefined} onValueChange={setCompareB}>
              {surveys.map((s) => (
                <DropdownMenuRadioItem key={`b-${s.id}`} value={s.id}>
                  {formatSurveyDate(s.survey_date)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  );
}
