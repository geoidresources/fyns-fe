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
      <head>
        <link rel="stylesheet" href="/cesium/Widgets/widgets.css" />
        <script src="/cesium/Cesium.js" />
        <script dangerouslySetInnerHTML={{ __html: `window.CESIUM_BASE_URL = "/cesium/";` }} />
      </head>
      <body className="min-h-full flex flex-col font-sans">
        <BackgroundShell>
          {children}
        </BackgroundShell>
        <Toaster theme="dark" position="top-right" richColors />
      </body>
    </html>
  );
}
