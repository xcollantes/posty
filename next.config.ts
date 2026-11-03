import type { NextConfig } from "next";

// The UI is reached through `tailscale serve`, which forwards the public
// host. APP_URL is listed too in case a proxy rewrites it.
const appHost = process.env.APP_URL ? new URL(process.env.APP_URL).host : "";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["sharp", "postgres"],
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
      allowedOrigins: appHost ? [appHost] : [],
    },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
