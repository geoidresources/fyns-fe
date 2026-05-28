import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "TerraMine - The mine, mapped. The risk, visible.",
  description: "Drone survey to decision platform for mining, quarrying, and civil works.",
};

import { BackgroundShell } from "@/components/layout/BackgroundShell";

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
      <body className="min-h-full flex flex-col font-sans">
        <BackgroundShell>
          {children}
        </BackgroundShell>
      </body>
    </html>
  );
}
