import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Same-origin proxy for GCS-hosted tiles/tilesets/geojson. The bucket has
  // no CORS policy (and the worker service account lacks bucket-level perms
  // to add one); Cesium's WebGL loads hard-require CORS, so proxying makes
  // every asset same-origin. Also previews the production tile-proxy shape.
  async rewrites() {
    return [
      {
        source: "/gcs/:path*",
        destination: "https://storage.googleapis.com/:path*",
      },
    ];
  },
  webpack: (config) => {
    // Treat 'cesium' as an external global variable (window.Cesium) 
    // to completely prevent Webpack from parsing its massive source tree and throwing Octal escape errors.
    config.externals = [...(config.externals || []), { cesium: 'Cesium' }];
    return config;
  },
};

export default nextConfig;
