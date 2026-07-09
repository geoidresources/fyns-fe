"use client";

import React from "react";
import Image from "next/image";
import { usePathname } from "next/navigation";

interface BackgroundShellProps {
  children: React.ReactNode;
}

export function BackgroundShell({ children }: BackgroundShellProps) {
  const pathname = usePathname();
  // Immersive Cesium routes own the full viewport — decorative earth imagery
  // bleeds through the transparent WebGL canvas and reads as static/noise.
  const isImmersiveMap =
    pathname === "/globe" || pathname.startsWith("/viewer/");

  // The earth image is part of the auth-page aesthetic only. Elsewhere it either
  // competes with real content or (on immersive maps) shows through the canvas.
  const showEarthDecor = pathname.startsWith("/sign-");

  return (
    // shrink-0 is load-bearing: body (app/layout.tsx) is a flex column with a
    // hard `height:100%` (globals.css), so a flex item with overflow-hidden and
    // no shrink-0 gets its automatic minimum size clamped to 0 by the flexbox
    // spec — flexbox then squashes this div to exactly one viewport tall and
    // its own overflow-hidden clips everything past the fold. Nothing ever
    // overflows <body>, so the page can't scroll at all. shrink-0 keeps this
    // div at its natural content height so overflow reaches <body> and scrolls.
    <div className="relative min-h-screen shrink-0 bg-black overflow-hidden text-[#F3F4F6]">
      {showEarthDecor && (
        <div className="absolute top-0 right-0 w-full md:w-[70%] h-full z-0 opacity-40 md:opacity-60 pointer-events-none">
          {/* Purely decorative — no `priority`, so it never preempts the LCP. */}
          <Image
            src="/earth-bg.png"
            alt=""
            aria-hidden
            fill
            className="object-cover object-right mix-blend-lighten"
          />
          {/* Gradient overlay to smoothly blend the image into the dark background */}
          <div className="absolute inset-0 bg-gradient-to-r from-black via-black/80 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-black/30" />
        </div>
      )}

      {/* Atmospheric Glow/Lighting Layer */}
      {!isImmersiveMap && (
      <div className="absolute top-[-20%] right-[-10%] w-[70vw] h-[70vw] rounded-full bg-[#C97A4E]/5 blur-[120px] pointer-events-none z-0" />
      )}

      {/* Content Layer */}
      <div className="relative z-10 min-h-screen flex flex-col">
        {children}
      </div>
    </div>
  );
}
