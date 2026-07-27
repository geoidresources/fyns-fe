// 404 page (App Router). Rendered for unmatched routes and explicit notFound()
// calls, so a bad URL shows a branded page instead of a bare Next default.

import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] w-full flex-col items-center justify-center gap-4 bg-[#0A0D14] px-6 text-center">
      <p className="font-mono text-sm text-[#C97A4E]">404</p>
      <h1 className="text-2xl font-semibold text-gray-100">Page not found</h1>
      <p className="max-w-md text-sm text-gray-400">
        The page you&apos;re looking for doesn&apos;t exist or may have moved.
      </p>
      <Link
        href="/globe"
        className="mt-2 h-11 rounded-xl bg-[#C97A4E] px-6 text-sm font-semibold leading-[2.75rem] text-[#0A0D14] transition-colors hover:bg-[#b06941]"
      >
        Back to sites
      </Link>
    </div>
  );
}
