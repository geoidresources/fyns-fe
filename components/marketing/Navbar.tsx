import React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Globe } from "lucide-react";
import { Logo } from "@/components/ui/Logo";

export function Navbar() {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-white/5 bg-[#0A0D14]/80 backdrop-blur-md">
      <div className="container mx-auto px-4 md:px-8 h-20 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Logo href="/" />
        </div>

        <nav className="hidden md:flex items-center gap-8 text-sm text-[#9CA3AF]">
          <Link href="#" className="hover:text-white transition-colors">Solution</Link>
          <Link href="#" className="hover:text-white transition-colors">Platform</Link>
          <Link href="#" className="hover:text-white transition-colors">Modules</Link>
          <Link href="#" className="hover:text-white transition-colors">Roadmap</Link>
          <Link href="#" className="hover:text-white transition-colors">Contact</Link>
        </nav>

        <div className="flex items-center gap-4">
          <Button variant="ghost" className="hidden sm:inline-flex">Request demo</Button>
          <Link href="/sign-in">
            <Button variant="secondary">Sign in</Button>
          </Link>
        </div>
      </div>
    </header>
  );
}
