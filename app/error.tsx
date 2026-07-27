"use client";

// Route-segment error boundary (App Router). Catches render/runtime errors in a
// dashboard/auth/viewer segment so a thrown error shows a recoverable screen
// instead of a blank page or Next's raw overlay in production.

import { useEffect } from "react";
import Link from "next/link";

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Route error:", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] w-full flex-col items-center justify-center gap-4 bg-[#0A0D14] px-6 text-center">
      <h1 className="text-2xl font-semibold text-gray-100">Something went wrong</h1>
      <p className="max-w-md text-sm text-gray-400">
        An unexpected error interrupted this page. You can try again, or head back to your sites.
      </p>
      {error?.digest && <p className="font-mono text-[11px] text-gray-600">ref: {error.digest}</p>}
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="h-11 rounded-xl bg-[#C97A4E] px-6 text-sm font-semibold text-[#0A0D14] transition-colors hover:bg-[#b06941]"
        >
          Try again
        </button>
        <Link
          href="/globe"
          className="h-11 rounded-xl border border-[#1E2028] bg-[#16181D] px-6 text-sm font-medium leading-[2.75rem] text-gray-300 transition-colors hover:bg-[#1E2028]"
        >
          Back to sites
        </Link>
      </div>
    </div>
  );
}
