// Dedicated `(viewer)` route group (viewer-shell §1, D1 — ADOPTED). The
// dashboard `Topbar` is still NOT in this tree, but the dashboard `Sidebar`
// (the global app rail) IS kept here on the far left so the user can jump to
// sites / upload / files / settings without leaving the viewer — it sits just
// left of the viewer's own module rail (inside `ViewerShell`), which stays.
//
// `app/layout.tsx` still owns `<html>/<body>`, fonts and `<Toaster>`, so
// `(dashboard)` and `(viewer)` are NOT multiple root layouts — navigating
// /globe ⇄ /viewer/:id stays a soft client navigation, not a full reload (§1.2).
// The group parens are elided from the URL, so routes remain `/viewer/:surveyId`.

import React from "react";
import { Sidebar } from "@/components/dashboard/Sidebar";

export default function ViewerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#0A0D14]">
      <Sidebar />
      <div className="min-w-0 flex-1 overflow-hidden">{children}</div>
    </div>
  );
}
