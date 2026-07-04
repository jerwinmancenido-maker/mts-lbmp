import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@mts-lbmp/shared", "@mts-lbmp/ui"],
  allowedDevOrigins: ["localhost", "127.0.0.1", "172.16.0.107", "172.21.122.125", "172.30.1.204"]
};

export default nextConfig;
