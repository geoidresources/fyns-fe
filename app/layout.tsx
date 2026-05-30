import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "GEOID - The mine, mapped. The risk, visible.",
  description: "Drone survey to decision platform for mining, quarrying, and civil works.",
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
      className={`${inter.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: `window.CESIUM_BASE_URL = "https://unpkg.com/cesium@1.141.0/Build/Cesium/";` }} />
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
