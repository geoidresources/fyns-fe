import type { Metadata } from "next";
import { Inter, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-ibm-mono",
  weight: ["400", "500", "600"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Twyn - GEOID",
  description:
    "Create living 3D replicas of any structure. Navigate floor by floor. Measure wall to wall. Track change over time.",
};

import { BackgroundShell } from "@/components/layout/BackgroundShell";

import { Toaster } from "sonner";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${ibmPlexMono.variable} h-full antialiased`}
    >
      {/* Cesium loads on demand via lib/viewer/loadCesium.ts on routes that
          render a viewer — keep the ~5MB script out of every page's head. */}
      <body className="min-h-full flex flex-col font-sans">
        <BackgroundShell>
          {children}
        </BackgroundShell>
        <Toaster theme="dark" position="top-right" richColors />
      </body>
    </html>
  );
}
