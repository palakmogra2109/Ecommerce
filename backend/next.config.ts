import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Shared constants live one level up (../shared); expand the
  // Turbopack project root so files outside backend/ resolve.
  turbopack: {
    root: path.join(__dirname, ".."),
  },
};

export default nextConfig;