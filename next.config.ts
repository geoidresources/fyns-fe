import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Opt out of server-side bundling for massive browser-only libraries like Cesium
  serverExternalPackages: ["cesium", "resium"],
  // Explicitly tell Next.js 16 to use Turbopack and ignore the absence of webpack config
  turbopack: {},
};

export default nextConfig;
