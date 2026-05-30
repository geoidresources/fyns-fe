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

export function ContactSalesModal({ isOpen, onClose }: ContactSalesModalProps) {
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

              <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); onClose(); }}>
                <div className="flex gap-4">
                  <div className="flex-1">
                    <label className="text-sm font-medium text-[#9CA3AF] mb-1 block">First Name</label>
                    <Input placeholder="Jane" required />
                  </div>
                  <div className="flex-1">
                    <label className="text-sm font-medium text-[#9CA3AF] mb-1 block">Last Name</label>
                    <Input placeholder="Doe" required />
                  </div>
                </div>
                
                <div>
                  <label className="text-sm font-medium text-[#9CA3AF] mb-1 block">Work Email</label>
                  <Input type="email" placeholder="jane@company.com" required />
                </div>

                <div>
                  <label className="text-sm font-medium text-[#9CA3AF] mb-1 block">Company Name</label>
                  <Input placeholder="Acme Mining Co." required />
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
