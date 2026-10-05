import type { NextConfig } from "next";

import { contentSecurityPolicy } from "./lib/security/content-security-policy";
import { ORDER_PHOTO_MULTIPART_MAX_BYTES } from "./data/order-photo-upload";

const nextConfig: NextConfig = {
  agentRules: false,
  poweredByHeader: false,
  reactStrictMode: true,
  experimental: {
    // One 10 MiB photo plus a bounded 64 KiB multipart envelope. The route
    // independently enforces both the received body and the decoded file.
    proxyClientMaxBodySize: ORDER_PHOTO_MULTIPART_MAX_BYTES,
    // Sharp's operation cache retains decoded/intermediate image data between
    // requests. The filesystem result cache remains enabled by Next.js.
    imgOptOperationCache: false,
    // MALLOC_ARENA_MAX enables Sharp's CPU-based default on Linux/glibc.
    // Keep cold Next/Image requests at the application's existing concurrency.
    imgOptConcurrency: 1,
  },
  // FFmpeg is spawned as a real executable and PDFKit reads its bundled AFM
  // font data at runtime. Keeping both packages external prevents the server
  // bundlers from rewriting those filesystem paths.
  serverExternalPackages: ["ffmpeg-static", "pdfkit"],
  images: {
    formats: ["image/avif", "image/webp"],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy(process.env) },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
