import React from "react";
import { Navbar } from "@/components/marketing/Navbar";

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col min-h-screen">
      <Navbar />
      <main className="flex-1">{children}</main>
      
      {/* Simple Footer */}
      <footer className="border-t border-white/5 py-8 mt-24">
        <div className="container mx-auto px-4 text-center text-sm text-[#6B7280]">
          © {new Date().getFullYear()} GEOID. All rights reserved.
        </div>
      </footer>
    </div>
  );
}
