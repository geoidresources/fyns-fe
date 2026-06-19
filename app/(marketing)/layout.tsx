import React from "react";
import Image from "next/image";
import { Navbar } from "@/components/marketing/Navbar";

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-screen flex-col bg-[#0A0D14] font-sans text-[#F4F4F5]">
      {/* Global grid overlay */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          backgroundImage:
            "linear-gradient(rgba(194,112,62,0.03) 1px,transparent 1px),linear-gradient(90deg,rgba(194,112,62,0.03) 1px,transparent 1px)",
          backgroundSize: "60px 60px",
        }}
      />

      <Navbar />
      <main className="relative z-10 flex-1">{children}</main>

      <footer className="relative z-10 mx-auto w-full max-w-[1200px] border-t border-white/[0.06] px-12 py-10">
        <div className="flex flex-col items-center gap-6 md:flex-row md:justify-between md:gap-0">
          <div className="flex items-center gap-2.5">
            <Image
              src="/geoid-logo-cropped.png"
              alt="GEOID"
              width={88}
              height={22}
              className="h-[22px] w-auto object-contain"
            />
            <span className="text-[13px] text-[#71717A]">TerraMine</span>
          </div>
          <nav className="flex gap-6">
            {["Documentation", "API", "Changelog", "Contact"].map((label) => (
              <a
                key={label}
                href="#"
                className="text-[13px] text-[#71717A] no-underline transition-colors hover:text-[#A1A1AA]"
              >
                {label}
              </a>
            ))}
          </nav>
          <div className="text-[12px] text-[#71717A]">
            © 2026 GEOID Resources. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}
