import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Electron build ships .next/standalone as a self-contained server.
  output: process.env.NEXT_PUBLIC_APP_PROFILE === "desktop" ? "standalone" : undefined,
  // gzip would buffer the NDJSON stream from /api/chat; this is a localhost app.
  compress: false,
  // Loaded from node_modules at runtime instead of bundled: linkedom pulls in
  // optional CSS deps that webpack can't resolve (fetch_url never needs them).
  serverExternalPackages: ["linkedom", "@mozilla/readability"],
  // Defence in depth for model output: the page may only load images and
  // open connections to itself, so a prompt-injected answer can't beacon out.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [{ key: "Content-Security-Policy", value: "img-src 'self' data: blob:; connect-src 'self'" }],
      },
    ];
  },
};

export default nextConfig;
