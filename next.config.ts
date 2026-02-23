import type { NextConfig } from "next";
import { readFileSync } from "fs";

const pkg = JSON.parse(readFileSync("./package.json", "utf-8"));

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: `v${pkg.version}`,
  },
  compress: true,
  experimental: {
    optimizePackageImports: ['date-fns', 'decimal.js', 'sonner'],
  },
};

export default nextConfig;
