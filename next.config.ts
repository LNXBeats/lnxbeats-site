import type { NextConfig } from "next";

import { directUploadConnectOrigin, publicMediaOrigin } from "./lib/media/storage/csp";

const isDevelopment = process.env.NODE_ENV === "development";
const directUploadOrigin = directUploadConnectOrigin();
const playbackOrigin = publicMediaOrigin();
const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob:${playbackOrigin ? ` ${playbackOrigin}` : ""}`,
  "font-src 'self' data:",
  `connect-src 'self'${directUploadOrigin ? ` ${directUploadOrigin}` : ""}${isDevelopment ? " ws: wss:" : ""}`,
  // Admin previews use local object URLs; validated public object media follows
  // a same-origin route that redirects only to this exact R2 bucket origin.
  `media-src 'self' blob:${playbackOrigin ? ` ${playbackOrigin}` : ""}`,
  "manifest-src 'self'",
].join("; ");

const nextConfig: NextConfig = {
  agentRules: false,
  poweredByHeader: false,
  reactStrictMode: true,
  experimental: {
    // Sharp's operation cache retains decoded/intermediate image data between
    // requests. The filesystem result cache remains enabled by Next.js.
    imgOptOperationCache: false,
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
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
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
