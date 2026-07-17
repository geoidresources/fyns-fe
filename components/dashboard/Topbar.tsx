"use client";

import Image from "next/image";
import { Building2 } from "lucide-react";

import { useAuthClient } from "@/hooks/useAuth";

// Branding strip for dashboard pages (globe/upload/files/settings): the GEOID
// logo on the left and the signed-in CLIENT/organization name on the right —
// informative only (no action), sourced from the user-svc login session.
// (Search/notifications stubs and the profile dropdown were removed; Sign Out
// lives on /settings, reached via the Sidebar's Account item.)

export function Topbar() {
  const client = useAuthClient();
  const clientName = client?.company_name?.trim() || client?.name?.trim();

  return (
    <div className="relative z-50 flex h-16 shrink-0 items-center justify-between border-b border-[#1E2028] bg-[#0A0D14] px-6">
      <Image
        src="/geoid-logo-cropped.png"
        alt="Geoid"
        width={80}
        height={20}
        className="h-auto w-auto object-contain"
      />

      {clientName && (
        <span
          title={clientName}
          className="flex min-w-0 items-center gap-2 text-sm text-gray-400"
        >
          <Building2 size={15} className="shrink-0 text-gray-500" />
          <span className="truncate">{clientName}</span>
        </span>
      )}
    </div>
  );
}
