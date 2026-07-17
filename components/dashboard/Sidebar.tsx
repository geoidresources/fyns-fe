"use client";

// The global app rail (globe/dashboard + viewer). Collapsed it is an icon-only
// strip; the hamburger toggles it EXPANDED, revealing each icon's label
// (Propeller-parity sections). The expanded/collapsed choice persists across
// route-group remounts (globe ⇄ viewer) via localStorage, read after mount so
// SSR and the first client render agree (no hydration mismatch).

import React, { useSyncExternalStore } from "react";
import { Download, Globe, Menu, Upload, UserRound, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { useAuthUser, userInitials } from "@/hooks/useAuth";

interface NavItem {
  icon: LucideIcon;
  label: string;
  href: string;
  /** When true for the current pathname, the row renders active. */
  isActive?: (pathname: string) => boolean;
}

// Main sections — all with real routes. Outputs → /files: every uploaded
// source asset + design, grouped by site/survey, downloadable (moved from the
// viewer's module rail, which only ever stubbed it).
const NAV_ITEMS: NavItem[] = [
  {
    icon: Globe,
    label: "Sites",
    href: "/globe",
    isActive: (p) => p === "/globe" || p.startsWith("/viewer/"),
  },
  { icon: Upload, label: "Upload", href: "/upload", isActive: (p) => p === "/upload" },
  { icon: Download, label: "Outputs", href: "/files", isActive: (p) => p === "/files" },
];

const STORAGE_KEY = "geoid:nav-expanded";
const NAV_EVENT = "geoid:nav-expanded-change";

// External-store plumbing (useSyncExternalStore): the expand state lives in
// localStorage so it survives route-group remounts (globe ⇄ viewer) and both
// rail instances stay in sync within a tab. getServerSnapshot returns false, so
// SSR + hydration agree (collapsed) and React re-reads storage after hydration —
// no mismatch, and no setState-in-effect.
function subscribeExpanded(cb: () => void): () => void {
  window.addEventListener("storage", cb);
  window.addEventListener(NAV_EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(NAV_EVENT, cb);
  };
}
function readExpanded(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}
function writeExpanded(next: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
  } catch {
    /* storage unavailable — no persistence, still toggles this render */
  }
  window.dispatchEvent(new Event(NAV_EVENT));
}

export function Sidebar() {
  const pathname = usePathname();
  const expanded = useSyncExternalStore(subscribeExpanded, readExpanded, () => false);
  const toggle = () => writeExpanded(!expanded);

  // Signed-in identity from the session (user-svc login response). Null on the
  // server + first hydration pass → falls back to the generic avatar/"Account"
  // until it resolves client-side.
  const user = useAuthUser();
  const initials = userInitials(user);
  const displayName = user?.name?.trim() || user?.email || "Account";
  const secondary = user?.name?.trim() && user?.email ? user.email : null;

  return (
    <nav
      aria-label="Primary"
      className={`z-20 flex h-full shrink-0 flex-col border-r border-[#1E2028] bg-[#12141A] py-4 transition-[width] duration-200 ease-out ${
        expanded ? "w-60" : "w-16"
      }`}
    >
      <button
        type="button"
        onClick={toggle}
        aria-label={expanded ? "Collapse navigation" : "Expand navigation"}
        aria-expanded={expanded}
        className={`mb-6 flex h-9 items-center text-[#C97A4E] transition-opacity hover:opacity-80 ${
          expanded ? "px-5" : "justify-center px-0"
        }`}
      >
        <Menu size={24} />
      </button>

      <div className="flex flex-col gap-1">
        {NAV_ITEMS.map((item) => (
          <NavRow key={item.label} item={item} pathname={pathname} expanded={expanded} />
        ))}
      </div>

      {/* Profile → /settings. Avatar shows the user's initials (generic icon
          until the session resolves); expanded reveals name + email. */}
      <div className="mt-auto px-3">
        <Link
          href="/settings"
          aria-label="Account settings"
          title={expanded ? undefined : displayName}
          className={`group flex items-center rounded-xl text-gray-400 transition-colors hover:text-gray-200 ${
            expanded ? "gap-3 px-2 py-2 hover:bg-white/[0.04]" : "justify-center p-1.5"
          }`}
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#2A2D35] text-[11px] font-semibold text-gray-200 transition-colors group-hover:bg-[#343741]">
            {initials || <UserRound size={16} />}
          </span>
          {expanded && (
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="truncate text-sm text-gray-200">{displayName}</span>
              {secondary && <span className="truncate text-[11px] text-gray-500">{secondary}</span>}
            </span>
          )}
        </Link>
      </div>
    </nav>
  );
}

function NavRow({
  item,
  pathname,
  expanded,
}: {
  item: NavItem;
  pathname: string;
  expanded: boolean;
}) {
  const Icon = item.icon;
  const active = item.isActive ? item.isActive(pathname) : false;
  return (
    <div className="px-3">
      <Link
        href={item.href}
        aria-label={item.label}
        aria-current={active ? "page" : undefined}
        title={expanded ? undefined : item.label}
        className={`group relative flex items-center rounded-xl transition-colors ${
          expanded ? "gap-3 px-3 py-2.5" : "justify-center p-2.5"
        } ${
          active
            ? "bg-[#C97A4E]/[0.08] text-[#C97A4E] ring-1 ring-inset ring-[#C97A4E]/40"
            : "text-gray-500 hover:bg-white/[0.04] hover:text-gray-300"
        }`}
      >
        <Icon size={20} className="shrink-0" />
        {expanded && (
          <span
            className={`whitespace-nowrap text-sm ${active ? "font-medium text-white" : ""}`}
          >
            {item.label}
          </span>
        )}
      </Link>
    </div>
  );
}
