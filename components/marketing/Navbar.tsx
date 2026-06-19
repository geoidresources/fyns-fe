"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ContactSalesModal } from "./ContactSalesModal";

export function Navbar() {
  const [isContactModalOpen, setIsContactModalOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <>
      <nav
        className="fixed top-0 left-0 right-0 z-[100] h-16 flex items-center justify-between px-8 transition-[background,backdrop-filter,border-color] duration-300"
        style={{
          background: scrolled ? "rgba(10,13,20,0.9)" : "transparent",
          backdropFilter: scrolled ? "blur(16px)" : "none",
          borderBottom: scrolled
            ? "0.5px solid rgba(194,112,62,0.08)"
            : "0.5px solid transparent",
        }}
      >
        <Link href="/" className="flex items-center gap-3">
          <Image
            src="/geoid-logo-cropped.png"
            alt="GEOID"
            width={110}
            height={28}
            priority
            className="h-7 w-auto object-contain"
          />
          <span className="text-[15px] text-[#71717A]">/</span>
          <span className="text-[15px] text-[#71717A]">Digital Twyn</span>
        </Link>

        <div className="flex items-center gap-5">
          <Link
            href="/sign-in"
            className="text-[13px] text-[#71717A] no-underline transition-colors hover:text-[#A1A1AA]"
          >
            Sign in
          </Link>
          <button
            type="button"
            onClick={() => setIsContactModalOpen(true)}
            className="rounded-full border-[0.5px] border-white/15 px-5 py-2 text-[13px] text-[#F4F4F5] transition-[border-color,background] hover:border-white/30 hover:bg-white/5"
          >
            Request demo
          </button>
        </div>
      </nav>
      <ContactSalesModal
        isOpen={isContactModalOpen}
        onClose={() => setIsContactModalOpen(false)}
      />
    </>
  );
}
