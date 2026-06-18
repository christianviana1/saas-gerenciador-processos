import crypto from "crypto";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  experimental: {
    typedRoutes: false,
    // Tell Next.js not to bundle these Node.js-only packages — load them at runtime
    serverComponentsExternalPackages: [
      "bullmq",
      "ioredis",
      "argon2",
      "@prisma/client",
    ],
  },

  // Security headers applied to every route.
  // A per-build nonce is used here for the static header configuration.
  // The Edge Middleware (middleware.ts) generates a fresh nonce per request
  // and overrides the CSP header at runtime for authenticated routes.
  async headers() {
    // Generate a build-time nonce for the static header fallback.
    // The middleware will replace this with a per-request nonce for dynamic routes.
    const nonce = crypto.randomBytes(16).toString("base64");

    const csp = [
      "default-src 'self'",
      `script-src 'self' 'nonce-${nonce}'`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self'",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; ");

    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value:
              "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
          {
            key: "Content-Security-Policy",
            value: csp,
          },
        ],
      },
    ];
  },

  // Log only errors in production
  logging: {
    fetches: {
      fullUrl: process.env.NODE_ENV === "development",
    },
  },
};

export default nextConfig;
