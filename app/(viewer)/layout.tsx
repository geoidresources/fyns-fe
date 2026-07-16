// Dedicated `(viewer)` route group (viewer-shell §1, D1 — ADOPTED). Full-bleed
// server component: the viewer owns the whole viewport, so the dashboard
// `Sidebar`+`Topbar` (from `app/(dashboard)/layout.tsx`) are NOT in this tree.
// The module rail inside `ViewerShell` replaces them (§1.3).
//
// `app/layout.tsx` still owns `<html>/<body>`, fonts and `<Toaster>`, so
// `(dashboard)` and `(viewer)` are NOT multiple root layouts — navigating
// /globe ⇄ /viewer/:id stays a soft client navigation, not a full reload (§1.2).
// The group parens are elided from the URL, so routes remain `/viewer/:surveyId`.

import React from "react";

export default function ViewerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="h-screen w-screen overflow-hidden bg-[#0A0D14]">
      {children}
    </div>
  );
}
