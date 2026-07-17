"use client";

// Reactive, hydration-safe reads of the signed-in identity that user-svc's
// login response persisted into the session (lib/auth.setSession). Backs the
// profile (Sidebar), the client badge (Topbar) and the settings page.
//
// useSyncExternalStore over the RAW stored STRING — a stable primitive — so the
// server snapshot (null) and the client's first hydration pass agree, avoiding
// a mismatch. Parsing happens in a useMemo keyed on that string, NOT inside the
// snapshot: a freshly JSON.parsed object is never reference-stable, and React
// would treat every render as a store change if it were the snapshot itself.

import { useMemo, useSyncExternalStore } from "react";
import {
  getClientRaw,
  getUserRaw,
  type AuthClient,
  type AuthUser,
} from "@/lib/auth";

function subscribe(cb: () => void): () => void {
  window.addEventListener("storage", cb); // fires on cross-tab session changes
  return () => window.removeEventListener("storage", cb);
}
const serverSnapshot = () => null;

function parse<T>(raw: string | null): T | null {
  try {
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function useAuthUser(): AuthUser | null {
  const raw = useSyncExternalStore(subscribe, getUserRaw, serverSnapshot);
  return useMemo(() => parse<AuthUser>(raw), [raw]);
}

export function useAuthClient(): AuthClient | null {
  const raw = useSyncExternalStore(subscribe, getClientRaw, serverSnapshot);
  return useMemo(() => parse<AuthClient>(raw), [raw]);
}

/** 1–2 letter avatar initials from a user's name (falling back to email). */
export function userInitials(user: AuthUser | null): string {
  const name = user?.name?.trim();
  if (name) {
    const parts = name.split(/\s+/);
    return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
  }
  const email = user?.email?.trim();
  return email ? email[0].toUpperCase() : "";
}
