import React from "react";
import { Logo } from "@/components/ui/Logo";

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
          <Logo href="/" />
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
