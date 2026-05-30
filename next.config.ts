import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  webpack: (config) => {
    // Treat 'cesium' as an external global variable (window.Cesium) 
    // to completely prevent Webpack from parsing its massive source tree and throwing Octal escape errors.
    config.externals = [...(config.externals || []), { cesium: 'Cesium' }];
    return config;
  },
};

export default nextConfig;
