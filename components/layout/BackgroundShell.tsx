import React from "react";
import Image from "next/image";

interface BackgroundShellProps {
  children: React.ReactNode;
}

export function BackgroundShell({ children }: BackgroundShellProps) {
  return (
    <div className="relative min-h-screen bg-[#0A0D14] overflow-hidden text-[#F3F4F6]">
      {/* Photorealistic Earth Background */}
      <div className="absolute top-0 right-0 w-full md:w-[70%] h-full z-0 opacity-40 md:opacity-60 pointer-events-none">
        <Image
          src="/earth-bg.png"
          alt="Earth from space"
          fill
          priority
          className="object-cover object-right mix-blend-lighten"
          quality={90}
        />
        {/* Gradient overlay to smoothly blend the image into the dark background */}
        <div className="absolute inset-0 bg-gradient-to-r from-[#0A0D14] via-[#0A0D14]/80 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0A0D14] via-transparent to-[#0A0D14]/30" />
      </div>

      {/* Atmospheric Glow/Lighting Layer */}
      <div className="absolute top-[-20%] right-[-10%] w-[70vw] h-[70vw] rounded-full bg-[#C97A4E]/5 blur-[120px] pointer-events-none z-0" />

      {/* Content Layer */}
      <div className="relative z-10 min-h-screen flex flex-col">
        {children}
      </div>
    </div>
  );
}
