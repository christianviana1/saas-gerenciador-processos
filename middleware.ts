import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import {
  applySecurityHeaders,
  generateNonce,
} from "@/shared/middleware/securityHeaders";

/**
 * Next.js Edge Middleware
 *
 * Responsibilities (in order of execution):
 *  1. Generate a per-request nonce and apply all security headers (Requirement 12.1, 12.2, 12.9).
 *  2. Expose the nonce via a custom request header so RSC/layouts can inject
 *     it into <script nonce="…"> tags and pass it to next/script.
 *  3. Authenticate JWT on protected routes (Requirement 5.9):
 *     - Routes matching `/(platform)/.*`: redirect to /login if no valid JWT.
 *     - Routes matching `/api/.*` (except `/api/auth`): return 401 if no valid JWT.
 *  4. Public routes (login, invite, health): pass through with just security headers.
 *
 * NOTE: This middleware runs on the Edge Runtime.
 * DO NOT import Node.js-only modules (ioredis, Prisma, BullMQ, crypto from Node, etc.).
 * Rate limiting is enforced at the route handler level (RateLimiter uses ioredis).
 * Full tenant guard (including audit events) is enforced inside API route handlers.
 *
 * Requirements: 5.9, 12.1, 12.2, 12.9
 */
export async function middleware(request: NextRequest): Promise<NextResponse | Response> {
  const { pathname } = request.nextUrl;
  const nonce = generateNonce();

  // ── Build modified request headers (forward nonce to server components) ───
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);

  // ── Helper: build a NextResponse.next() with security headers applied ─────
  function secureNext(): NextResponse {
    const res = NextResponse.next({
      request: { headers: requestHeaders },
    });
    applySecurityHeaders(res, nonce);
    return res;
  }

  // ── 1. Public routes — pass through with security headers only ────────────
  //    These paths never require authentication.
  const isPublicPath =
    pathname === "/login" ||
    pathname === "/api/auth" ||
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/convite/") ||
    pathname === "/api/health" ||
    pathname === "/api/healthz";

  if (isPublicPath) {
    return secureNext();
  }

  // ── 2. Determine whether this route requires authentication ───────────────
  const isPlatformRoute = pathname.startsWith("/(platform)/") ||
    // App Router uses the segment name in the filesystem, not in the URL.
    // Platform routes in the app directory live under /src/app/(platform)/**
    // and are served at the root level (e.g., /dashboard, /processos, etc.).
    // We match them by excluding known public paths and API routes.
    (!pathname.startsWith("/api/") &&
      !pathname.startsWith("/_next/") &&
      pathname !== "/login" &&
      !pathname.startsWith("/convite/") &&
      !pathname.startsWith("/icons/") &&
      pathname !== "/" );

  const isProtectedApiRoute =
    pathname.startsWith("/api/") &&
    !pathname.startsWith("/api/auth/") &&
    pathname !== "/api/auth" &&
    pathname !== "/api/health" &&
    pathname !== "/api/healthz";

  const requiresAuth = isPlatformRoute || isProtectedApiRoute;

  if (!requiresAuth) {
    // Neither a platform route nor a protected API — apply headers and continue.
    return secureNext();
  }

  // ── 3. Verify JWT ──────────────────────────────────────────────────────────
  const secret = process.env.NEXTAUTH_SECRET;

  // If NEXTAUTH_SECRET is not configured, fail closed (deny all protected access).
  if (!secret) {
    if (isProtectedApiRoute) {
      const res = new Response(
        JSON.stringify({ code: "CONFIGURATION_ERROR", message: "Server misconfiguration" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
      return res;
    }
    // Redirect to login for platform routes
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  const token = await getToken({ req: request, secret });

  if (!token) {
    // No valid session — enforce authentication
    if (isProtectedApiRoute) {
      // API routes return 401 JSON (Requirement 5.9)
      const res = new Response(
        JSON.stringify({ code: "UNAUTHORIZED", message: "Authentication required" }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
      return res;
    }

    // Platform routes redirect to /login with the original path as callbackUrl
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // ── 4. Token present — allow request through with security headers ─────────
  // Forward the tenantId and userId from the JWT to downstream route handlers
  // via request headers so they can be consumed without re-verifying the token.
  requestHeaders.set("x-tenant-id", token.tenantId as string ?? "");
  requestHeaders.set("x-user-id", token.userId as string ?? "");
  requestHeaders.set("x-user-role", token.role as string ?? "");

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });

  applySecurityHeaders(response, nonce);

  return response;
}

/**
 * Run the middleware on all routes except:
 * - Next.js internals (_next/static, _next/image)
 * - Static public assets (favicon.ico, manifest.json, icons, sw.js)
 */
export const config = {
  matcher: [
    /*
     * Match all request paths EXCEPT for:
     * - _next/static  (static files)
     * - _next/image   (image optimisation)
     * - favicon.ico, manifest.json, sw.js, icons/
     */
    "/((?!_next/static|_next/image|favicon\\.ico|manifest\\.json|sw\\.js|icons/).*)",
  ],
};
