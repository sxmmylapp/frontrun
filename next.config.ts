import type { NextConfig } from "next";
import { readFileSync } from "fs";

const pkg = JSON.parse(readFileSync("./package.json", "utf-8"));

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: `v${pkg.version}`,
  },
  compress: true,
  experimental: {
    optimizePackageImports: ['date-fns', 'decimal.js', 'sonner', 'radix-ui'],
    staleTimes: {
      // Client-side router cache: navigating back to a page within these
      // windows serves the cached RSC payload instantly instead of re-fetching.
      dynamic: 30,  // dynamic pages cached for 30s on client
      static: 180,  // static pages cached for 3 min on client
    },
  },
};

export default nextConfig;
