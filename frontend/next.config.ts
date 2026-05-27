import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  compress: false, // Let reverse proxy handle compression — saves RAM on low-resource PCs
  experimental: {
    // Permite proxyar archivos GCODE grandes (500MB) sin cortarlos
    middlewareClientMaxBodySize: 500 * 1024 * 1024,
  },
  // Proxy API requests to the backend in production
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.BACKEND_URL || "http://backend:8000"}/api/:path*`,
      },
      {
        source: "/ws",
        destination: `${process.env.BACKEND_WS_URL || "http://backend:8000"}/ws`,
      },
      {
        source: "/health",
        destination: `${process.env.BACKEND_URL || "http://backend:8000"}/health`,
      },
    ];
  },
};

export default nextConfig;
