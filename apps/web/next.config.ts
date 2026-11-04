import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@pew/core", "@pew/db", "@pew/model-adapters"],
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  poweredByHeader: false,
  experimental: {
    serverActions: {
      // 10 files × 2 MB per upload (F04) and 100 MB product archives (§8.2).
      bodySizeLimit: "110mb",
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default config;
