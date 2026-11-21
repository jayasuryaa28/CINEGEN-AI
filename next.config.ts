import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cleanDistDir: false,
  reactStrictMode: true,
  serverExternalPackages: [
    "@tensorflow/tfjs",
    "@tensorflow/tfjs-node",
    "bullmq",
    "fluent-ffmpeg",
  ],
  experimental: {
    serverActions: {
      bodySizeLimit: "500mb",
    },
  },
};

export default nextConfig;
