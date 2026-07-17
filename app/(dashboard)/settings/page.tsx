"use client";

// Settings — minimal account page: the signed-in user's identity (already
// held locally from sign-in, no extra fetch) + Sign Out, which used to live
// only in the Topbar's profile dropdown. That dropdown is gone now that the
// Sidebar's "Account" item (globe + viewer rail) routes here instead.

import React from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";

import { clearSession } from "@/lib/auth";
import { useAuthClient, useAuthUser } from "@/hooks/useAuth";

export default function SettingsPage() {
  const router = useRouter();
  const user = useAuthUser();
  const client = useAuthClient();

  const handleSignOut = () => {
    clearSession();
    router.push("/sign-in");
  };

  return (
    <div className="h-full w-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-10 pb-24">
        <h1 className="mb-8 text-4xl font-bold text-gray-100">Settings</h1>

        <section className="mb-6 overflow-hidden rounded-xl border border-[#1E2028] bg-[#0F1116]">
          <div className="border-b border-[#1E2028] px-5 py-3">
            <h2 className="text-sm font-semibold text-gray-300">Account</h2>
          </div>
          <div className="flex flex-col divide-y divide-[#1E2028]">
            <Field label="Name" value={user?.name} />
            <Field label="Email" value={user?.email} />
            <Field label="Company" value={client?.company_name || client?.name} />
          </div>
        </section>

        <button
          type="button"
          onClick={handleSignOut}
          className="flex items-center gap-2 rounded-xl border border-[#1E2028] bg-[#0F1116] px-5 py-2.5 text-sm font-medium text-gray-300 transition-colors hover:border-red-500/30 hover:text-red-400"
        >
          <LogOut size={15} />
          Sign Out
        </button>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex items-center justify-between px-5 py-3">
      <span className="text-sm text-gray-500">{label}</span>
      <span className="text-sm text-gray-200">{value || "—"}</span>
    </div>
  );
}
