"use client";

// Right-click context menu for a measurement in the 3D scene (P2c-2). Opened by
// useScenePicking's RIGHT_CLICK (which also selects the target), positioned at
// the cursor. Edit / Redraw act on the current selection (just set); Delete
// targets the stored id. Closes on action, Esc, or a click-away.

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { PenLine, Spline, Trash2 } from "lucide-react";

import { useViewerStore } from "@/lib/viewer/state/store";
import { useViewerActions } from "@/components/viewer/shell/viewerActions";

const MENU_WIDTH = 168;

function MenuItem({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors ${
        danger
          ? "text-red-400 hover:bg-red-500/[0.1]"
          : "text-gray-200 hover:bg-white/[0.06]"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

export function MeasurementContextMenu() {
  const contextMenu = useViewerStore((s) => s.contextMenu);
  const measurements = useViewerStore((s) => s.measurements);
  const closeContextMenu = useViewerStore((s) => s.closeContextMenu);
  const selectMeasurement = useViewerStore((s) => s.selectMeasurement);
  const actions = useViewerActions();

  useEffect(() => {
    if (!contextMenu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeContextMenu();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [contextMenu, closeContextMenu]);

  if (!contextMenu) return null;
  const measurement = measurements.find((m) => m.id === contextMenu.measurementId);
  if (!measurement) return null;

  const geomType = measurement.geometry?.type;
  const editable = geomType === "Polygon" || geomType === "LineString";

  // Keep the menu on-screen: flip left if it would overflow the right edge.
  const maxLeft = typeof window !== "undefined" ? window.innerWidth - MENU_WIDTH - 8 : contextMenu.x;
  const left = Math.min(contextMenu.x, Math.max(8, maxLeft));

  // Selection-dependent actions (Edit / Redraw read the current selection); make
  // the menu self-consistent by re-selecting its target first, regardless of how
  // it was opened.
  const run = (fn: () => void) => {
    closeContextMenu();
    selectMeasurement(measurement.id, { fly: false });
    fn();
  };

  if (typeof document === "undefined") return null;

  // Portaled to <body> so `position: fixed` is viewport-relative (the shell's
  // framer-motion ancestors set `transform`, which would otherwise capture it).
  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[60]"
        onPointerDown={closeContextMenu}
        onContextMenu={(e) => {
          e.preventDefault();
          closeContextMenu();
        }}
      />
      <div
        role="menu"
        aria-label={`Actions for ${measurement.name}`}
        className="fixed z-[61] rounded-lg border border-white/[0.08] bg-[#18181b]/95 p-1 shadow-[0_8px_30px_rgba(0,0,0,0.5)] backdrop-blur-md"
        style={{ left, top: contextMenu.y, width: MENU_WIDTH }}
      >
        {editable && (
          <MenuItem
            icon={<Spline size={14} />}
            label="Edit shape"
            onClick={() => run(actions.editGeometry)}
          />
        )}
        {editable && (
          <MenuItem
            icon={<PenLine size={14} />}
            label="Redraw"
            onClick={() => run(actions.redrawGeometry)}
          />
        )}
        <MenuItem
          icon={<Trash2 size={14} />}
          label="Delete"
          danger
          onClick={() => run(() => actions.removeMeasurement(measurement.id))}
        />
      </div>
    </>,
    document.body
  );
}
