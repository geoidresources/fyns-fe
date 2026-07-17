"use client";

// Zone 1 — ModuleRail (viewer-shell §2.1/§4.1, polished in 1.3c-ii). The 48px
// vertical rail that replaces the dashboard chrome on viewer routes. Top →
// bottom: Logo (→ /globe — the viewer's exit, replacing the old in-panel back
// arrow), divider, the modules (Measure + Survey live, the rest disabled with a
// phase tooltip, D7). Outputs moved to the globe rail (project/survey source
// data downloads, §"Files"); Help/Avatar removed — the globe rail's own
// profile button covers account access.
//
// Behavior (§4.1): clicking a live module sets `activeModule` and opens the
// tree if collapsed; clicking the ALREADY-active module toggles
// `treePanelOpen`. Module switching MUST NOT cancel an active draw — it only
// touches `activeModule`/`treePanelOpen`, never the draw state.

import React from "react";
import {
  DraftingCompass,
  Droplets,
  Image as ImageIcon,
  Layers,
  Ruler,
  Truck,
  Users,
  type LucideIcon,
} from "lucide-react";

import { Logo } from "@/components/ui/Logo";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useViewerStore } from "@/lib/viewer/state/store";
import type { ModuleKey } from "@/lib/viewer/state/store";

interface ModuleDef {
  key: ModuleKey;
  label: string;
  icon: LucideIcon;
  live: boolean;
}

// Order + live-set from D7: Measure + Survey functional in Phase 1, the rest
// scaffolded. Icons are lucide per §8 (no hugeicons/MUI in shell chrome).
const MODULES: ModuleDef[] = [
  { key: "measure", label: "Measure", icon: Ruler, live: true },
  { key: "survey", label: "Survey", icon: Layers, live: true },
  { key: "designs", label: "Designs", icon: DraftingCompass, live: false },
  { key: "media", label: "Media", icon: ImageIcon, live: false },
  { key: "hydro", label: "Hydro", icon: Droplets, live: false },
  { key: "crew", label: "Crew", icon: Users, live: false },
  { key: "machines", label: "Machines", icon: Truck, live: false },
];

export function ModuleRail() {
  const activeModule = useViewerStore((s) => s.activeModule);
  const treePanelOpen = useViewerStore((s) => s.treePanelOpen);
  const setActiveModule = useViewerStore((s) => s.setActiveModule);
  const setTreePanelOpen = useViewerStore((s) => s.setTreePanelOpen);

  const onSelect = (m: ModuleDef) => {
    if (!m.live) return;
    if (m.key === activeModule) {
      // Re-clicking the active module toggles the tree panel (§4.1).
      setTreePanelOpen(!treePanelOpen);
      return;
    }
    setActiveModule(m.key);
    if (!treePanelOpen) setTreePanelOpen(true);
  };

  return (
    <TooltipProvider delayDuration={300}>
      <nav
        aria-label="Viewer modules"
        className="flex h-full w-12 shrink-0 flex-col items-center border-r border-white/[0.08] bg-[#111114] py-3"
      >
        {/* Logo → /globe (the viewer's exit, §1.3). */}
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="flex w-9 items-center justify-center">
              <Logo href="/globe" className="w-8 justify-center" />
            </span>
          </TooltipTrigger>
          <TooltipContent side="right">Back to globe</TooltipContent>
        </Tooltip>

        <div className="my-3 h-px w-7 shrink-0 bg-white/[0.08]" />

        <div className="flex flex-col items-center gap-1">
          {MODULES.map((m) => {
            const Icon = m.icon;
            const active = m.key === activeModule;
            return (
              <Tooltip key={m.key}>
                <TooltipTrigger asChild>
                  {/* aria-disabled + guarded click (not the `disabled` attr) so
                      disabled modules still hover — the phase tooltip must fire. */}
                  <button
                    type="button"
                    aria-label={m.label}
                    aria-pressed={active}
                    aria-disabled={!m.live}
                    onClick={() => onSelect(m)}
                    className={`relative flex size-9 items-center justify-center rounded-[6px] transition-colors ${
                      active
                        ? "border-l-2 border-[#C97A4E] bg-[#C97A4E]/[0.12] text-[#C97A4E] shadow-[0_0_10px_0_rgba(201,122,78,0.15)]"
                        : m.live
                          ? "text-gray-400 hover:bg-white/[0.04] hover:text-gray-200"
                          : "cursor-not-allowed text-gray-600"
                    }`}
                  >
                    <Icon size={18} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  {m.live ? (
                    m.label
                  ) : (
                    <span className="flex flex-col">
                      <span>{m.label}</span>
                      <span className="text-gray-500">Coming in a later phase</span>
                    </span>
                  )}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </nav>
    </TooltipProvider>
  );
}
