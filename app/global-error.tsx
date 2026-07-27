"use client";

// Root error boundary — catches errors thrown in the ROOT layout itself (which a
// segment error.tsx cannot). It REPLACES the root layout when it renders, so it
// must supply its own <html>/<body>. Kept dependency-free and self-styled so it
// works even if the app shell is what failed.

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Global error:", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "1rem",
          background: "#0A0D14",
          color: "#E5E7EB",
          fontFamily: "system-ui, sans-serif",
          textAlign: "center",
          padding: "1.5rem",
        }}
      >
        <h1 style={{ fontSize: "1.5rem", fontWeight: 600, margin: 0 }}>Something went wrong</h1>
        <p style={{ maxWidth: "28rem", fontSize: "0.875rem", color: "#9CA3AF" }}>
          The application hit an unexpected error. Reloading usually fixes it.
        </p>
        {error?.digest && (
          <p style={{ fontFamily: "monospace", fontSize: "0.6875rem", color: "#4B5563" }}>ref: {error.digest}</p>
        )}
        <button
          type="button"
          onClick={reset}
          style={{
            height: "2.75rem",
            borderRadius: "0.75rem",
            border: "none",
            background: "#C97A4E",
            color: "#0A0D14",
            padding: "0 1.5rem",
            fontSize: "0.875rem",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Reload
        </button>
      </body>
    </html>
  );
}
