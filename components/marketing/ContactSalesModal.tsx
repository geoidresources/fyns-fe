"use client";

import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface ContactSalesModalProps {
  isOpen: boolean;
  onClose: () => void;
}

// TODO(confirm): verify this is the correct inbound sales address before ship.
// There is no backend endpoint for this form, so submissions open the user's
// mail client addressed here rather than being silently discarded.
const SALES_EMAIL = "sales@geoidresources.com";

export function ContactSalesModal({ isOpen, onClose }: ContactSalesModalProps) {
  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const firstName = String(fd.get("firstName") || "").trim();
    const lastName = String(fd.get("lastName") || "").trim();
    const email = String(fd.get("email") || "").trim();
    const company = String(fd.get("company") || "").trim();
    const subject = `Demo request — ${company || "New lead"}`;
    const body = [
      `Name: ${firstName} ${lastName}`.trim(),
      `Email: ${email}`,
      `Company: ${company}`,
      "",
      "I'd like to schedule a demo of GEOID TerraMine.",
    ].join("\n");
    window.location.href = `mailto:${SALES_EMAIL}?subject=${encodeURIComponent(
      subject
    )}&body=${encodeURIComponent(body)}`;
    onClose();
  };

  // Prevent scrolling when modal is open
  React.useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "unset";
    }
    return () => {
      document.body.style.overflow = "unset";
    };
  }, [isOpen]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm"
          />
          <div className="fixed inset-0 z-[101] flex items-center justify-center p-4 pointer-events-none">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="w-full max-w-lg bg-[#12141A] border border-white/10 rounded-2xl p-6 md:p-8 shadow-2xl pointer-events-auto relative"
            >
              <button
                onClick={onClose}
                className="absolute top-4 right-4 text-[#9CA3AF] hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>

              <h2 className="text-2xl font-bold text-white mb-2">Contact Sales</h2>
              <p className="text-[#9CA3AF] mb-6">
                Fill out the form below and our team will get back to you shortly to schedule a demo.
              </p>

              <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
                <div className="flex gap-4">
                  <div className="flex-1">
                    <label className="text-sm font-medium text-[#9CA3AF] mb-1 block">First Name</label>
                    <Input name="firstName" placeholder="Jane" autoComplete="given-name" required />
                  </div>
                  <div className="flex-1">
                    <label className="text-sm font-medium text-[#9CA3AF] mb-1 block">Last Name</label>
                    <Input name="lastName" placeholder="Doe" autoComplete="family-name" required />
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium text-[#9CA3AF] mb-1 block">Work Email</label>
                  <Input name="email" type="email" placeholder="jane@company.com" autoComplete="email" required />
                </div>

                <div>
                  <label className="text-sm font-medium text-[#9CA3AF] mb-1 block">Company Name</label>
                  <Input name="company" placeholder="Acme Mining Co." autoComplete="organization" required />
                </div>

                <Button type="submit" size="lg" className="w-full mt-4">
                  Request Demo
                </Button>
              </form>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
