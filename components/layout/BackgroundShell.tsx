"use client";

import React from "react";
import Image from "next/image";
import { usePathname } from "next/navigation";

interface BackgroundShellProps {
  children: React.ReactNode;
}

export function BackgroundShell({ children }: BackgroundShellProps) {
  const pathname = usePathname();
  const isMainLandingPage = pathname === "/";

  return (
    <div className="relative min-h-screen bg-black overflow-hidden text-[#F3F4F6]">
      {/* Photorealistic Earth Background - hidden on main landing page */}
      {!isMainLandingPage && (
        <div className="absolute top-0 right-0 w-full md:w-[70%] h-full z-0 opacity-40 md:opacity-60 pointer-events-none">
          <Image
            src="/earth-bg.png"
            alt="Earth from space"
            fill
            priority
            className="object-cover object-right mix-blend-lighten"
          />
          {/* Gradient overlay to smoothly blend the image into the dark background */}
          <div className="absolute inset-0 bg-gradient-to-r from-black via-black/80 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-black/30" />
        </div>
      )}

      {/* Atmospheric Glow/Lighting Layer */}
      <div className="absolute top-[-20%] right-[-10%] w-[70vw] h-[70vw] rounded-full bg-[#C97A4E]/5 blur-[120px] pointer-events-none z-0" />

      {/* Content Layer */}
      <div className="relative z-10 min-h-screen flex flex-col">
        {children}
      </div>
    </div>
  );
}
