"use client";

// Keyboard cheat sheet (enrichment §03) — opened with `?`, closed with Esc /
// click-away / `?` again. Portaled to <body> (the shell's framer ancestors set
// `transform`, which captures position:fixed — same lesson as the context
// menu). Also hosts the layer-3 "Drawing assistance" preference: a DEFAULTS
// switch (snap default + auto-compute), never a behavior fork.

import { useEffect } from "react";
import { createPortal } from "react-dom";

import { useViewerStore } from "@/lib/viewer/state/store";

function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-block rounded-md border border-white/[0.14] border-b-2 bg-[#26262b] px-1.5 py-0.5 font-mono text-[11px] font-semibold leading-tight text-gray-200">
      {children}
    </kbd>
  );
}

function Row({ keys, children }: { keys: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3 py-1">
      <span className="flex w-[102px] flex-none flex-wrap gap-1">{keys}</span>
      <span className="text-[12.5px] text-gray-400">{children}</span>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[#C97A4E]">
        {title}
      </p>
      {children}
    </div>
  );
}

export function ShortcutSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const assistance = useViewerStore((s) => s.drawingAssistance);
  const setDrawingAssistance = useViewerStore((s) => s.setDrawingAssistance);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        // Front-most surface owns Esc: never let it fall through to the
        // viewer's cancel-draw listener (capture + immediate stop).
        e.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <>
      <div className="fixed inset-0 z-[70] bg-black/50" onPointerDown={onClose} />
      <div
        role="dialog"
        aria-label="Keyboard shortcuts"
        className="fixed left-1/2 top-1/2 z-[71] w-[min(680px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/[0.08] bg-[#141417]/95 p-6 shadow-[0_16px_60px_rgba(0,0,0,0.6)] backdrop-blur-md"
      >
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-[15px] font-semibold text-gray-100">Keyboard shortcuts</h2>
          <span className="font-mono text-[10px] uppercase tracking-widest text-gray-500">
            Esc closes
          </span>
        </div>

        <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
          <Group title="Tools">
            <Row keys={<><Key>P</Key><Key>I</Key></>}>Point · elevation probe</Row>
            <Row keys={<><Key>L</Key><Key>A</Key></>}>Line · Area (polygon)</Row>
            <Row keys={<><Key>X</Key><Key>G</Key></>}>Cross-section · Grade</Row>
            <Row keys={<Key>Esc</Key>}>Discard / back to cursor</Row>
          </Group>

          <Group title="Drawing & editing">
            <Row keys={<Key>Enter</Key>}>Finish — or edit the selected shape</Row>
            <Row keys={<><Key>S</Key> <Key>Alt</Key></>}>Snap toggle · hold to suspend</Row>
            <Row keys={<><Key>Tab</Key><Key>←</Key><Key>→</Key></>}>Walk vertices while editing</Row>
            <Row keys={<><Key>Del</Key></>}>Remove the selected vertex</Row>
          </Group>

          <Group title="Lenses">
            <Row keys={<><Key>1</Key><Key>2</Key></>}>Elevation ramp · hillshade</Row>
            <Row keys={<><Key>3</Key><Key>4</Key></>}>Contours (cycles interval) · sun</Row>
            <Row keys={<Key>0</Key>}>All lenses off</Row>
          </Group>

          <Group title="Scene">
            <Row keys={<Key>F</Key>}>Frame the selected measurement</Row>
            <Row keys={<Key>V</Key>}>Show / hide the selection</Row>
            <Row keys={<Key>?</Key>}>This sheet</Row>
          </Group>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.07] bg-[#19191d] px-4 py-3">
          <div>
            <p className="text-[12.5px] font-medium text-gray-200">Drawing assistance</p>
            <p className="text-[11px] text-gray-500">
              Defaults only — gestures never change. Assisted: snap on, compute on finish.
              Precise: snap off, you run compute.
            </p>
          </div>
          <div className="flex overflow-hidden rounded-lg border border-white/[0.1]">
            {(["assisted", "precise"] as const).map((level) => (
              <button
                key={level}
                type="button"
                aria-pressed={assistance === level}
                onClick={() => setDrawingAssistance(level)}
                className={`px-3 py-1.5 text-[12px] font-medium capitalize transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#C97A4E] ${
                  assistance === level
                    ? "bg-[#C97A4E] text-[#141417]"
                    : "bg-transparent text-gray-400 hover:bg-white/[0.05]"
                }`}
              >
                {level}
              </button>
            ))}
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}
