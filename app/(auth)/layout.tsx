import React from "react";
import Link from "next/link";
import { Globe } from "lucide-react";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      {/* Form Container (Left Side) */}
      <div className="w-full lg:w-1/2 flex flex-col justify-center px-8 md:px-24 py-12 z-10">
        
        {/* Brand Logo */}
        <div className="mb-12">
          <Link href="/" className="inline-flex items-center gap-3">
            <div className="w-10 h-10 rounded-md bg-[#C97A4E] flex items-center justify-center text-black">
              <Globe className="w-6 h-6" />
            </div>
            <span className="text-2xl font-medium text-white tracking-tight">TerraMine</span>
          </Link>
        </div>
        
        <main className="w-full max-w-md">
          {children}
        </main>
      </div>
      
      {/* Empty space for the right side to let the BackgroundShell's Earth shine through */}
      <div className="hidden lg:block lg:w-1/2" />
    </div>
  );
}
