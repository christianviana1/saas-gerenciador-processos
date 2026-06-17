/**
 * Auth.js v5 (NextAuth) — Main configuration
 *
 * Strategy: JWT (HS256), 8-hour session maxAge, session ID regeneration on sign-in.
 * Provider: CredentialsProvider — email + password (Argon2id) + optional TOTP.
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5
 */

import NextAuth, { type NextAuthConfig } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { PrismaClient, UserStatus, TenantStatus } from '@prisma/client';
import { randomUUID } from 'crypto';

import { argon2Hash } from '@/infrastructure/security/Argon2Hash';
import { totpService } from '@/infrastructure/security/TOTPService';
import { aesEncryption } from '@/infrastructure/security/AESEncryption';
import { rateLimiter } from '@/infrastructure/security/RateLimiter';

// ─────────────────────────────────────────────────────────────────────────────
// Prisma singleton
// ─────────────────────────────────────────────────────────────────────────────

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

const prisma = global.__prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  global.__prisma = prisma;
}

// ─────────────────────────────────────────────────────────────────────────────
// TypeScript module augmentation — extend Auth.js session types
// ─────────────────────────────────────────────────────────────────────────────

declare module 'next-auth' {
  interface Session {
    user: {
      userId: string;
      tenantId: string;
      role: string;
      sessionId: string;
      email: string;
      name: string;
    };
  }

  interface User {
    id: string;
    email: string;
    name: string;
    role: string;
    tenantId: string;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    userId: string;
    tenantId: string;
    role: string;
    sessionId: string;
    email: string;
    name: string;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Auth.js configuration
// ─────────────────────────────────────────────────────────────────────────────

export const authConfig: NextAuthConfig = {
  // Use JWT strategy — no database sessions
  session: {
    strategy: 'jwt',
    // Requirement 5.2: expire after 8 hours of inactivity
    maxAge: 8 * 60 * 60, // 8 hours in seconds
  },

  jwt: {
    // HS256 signing — NEXTAUTH_SECRET provides the 256-bit key
    maxAge: 8 * 60 * 60,
  },

  providers: [
    Credentials({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
        totpCode: { label: 'TOTP Code', type: 'text' },
      },

      async authorize(credentials) {
        const email = (credentials?.email as string | undefined)?.toLowerCase().trim();
        const password = credentials?.password as string | undefined;
        const totpCode = credentials?.totpCode as string | undefined;

        if (!email || !password) {
          return null;
        }

        // ── Look up user with tenant ────────────────────────────────────────
        const user = await prisma.user.findFirst({
          where: {
            email,
            deletedAt: null,
          },
          include: {
            tenant: true,
          },
        });

        if (!user) {
          // Record failure even for non-existent accounts (Requirement 3.7)
          await rateLimiter.recordFailedLogin(email);
          return null;
        }

        // ── Check lockout before verifying password ─────────────────────────
        const isLocked = await rateLimiter.isLockedOut(email);
        if (isLocked) {
          // Throw a descriptive error so the client can display a proper message
          throw new Error('ACCOUNT_LOCKED');
        }

        // ── Verify password (Argon2id) ──────────────────────────────────────
        const passwordValid = await argon2Hash.verify(user.passwordHash, password);
        if (!passwordValid) {
          await rateLimiter.recordFailedLogin(email);
          return null;
        }

        // ── Check user status ───────────────────────────────────────────────
        if (user.status !== UserStatus.ACTIVE) {
          throw new Error('USER_INACTIVE');
        }

        // ── Check tenant status ─────────────────────────────────────────────
        if (user.tenant.status !== TenantStatus.ACTIVE) {
          throw new Error('TENANT_BLOCKED');
        }

        // ── MFA verification (Requirement 5.4) ─────────────────────────────
        if (user.mfaEnabled) {
          if (!totpCode) {
            // Signal to the client that a TOTP code is required
            throw new Error('MFA_REQUIRED');
          }

          if (!user.mfaSecret) {
            // MFA is enabled but secret is missing — treat as failure
            await rateLimiter.recordFailedLogin(email);
            throw new Error('MFA_CONFIGURATION_ERROR');
          }

          // Decrypt the AES-encrypted TOTP secret stored in the database
          let plaintextSecret: string;
          try {
            plaintextSecret = aesEncryption.decrypt(user.mfaSecret);
          } catch {
            await rateLimiter.recordFailedLogin(email);
            throw new Error('MFA_CONFIGURATION_ERROR');
          }

          const totpValid = totpService.verify(totpCode, plaintextSecret);
          if (!totpValid) {
            await rateLimiter.recordFailedLogin(email);
            throw new Error('MFA_INVALID_CODE');
          }
        }

        // ── Authentication successful ───────────────────────────────────────
        // The signIn callback handles lastLoginAt update and clearing rate-limiter
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          tenantId: user.tenantId,
        };
      },
    }),
  ],

  callbacks: {
    /**
     * signIn callback: fires after the provider's authorize() succeeds.
     * Updates lastLoginAt and clears failed login counters.
     */
    async signIn({ user }) {
      if (!user?.id || !user?.email) return true;

      try {
        // Update lastLoginAt (Requirement 5.3 / audit trail)
        await prisma.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        });

        // Clear failed login counters on successful sign-in (Requirement 5.5)
        await rateLimiter.clearFailedLogins(user.email);
      } catch {
        // Non-fatal — do not block the sign-in
      }

      return true;
    },

    /**
     * JWT callback: runs whenever a JWT is created or updated.
     * Embeds userId, tenantId, role, and a fresh sessionId on initial sign-in.
     *
     * Requirement 5.3: regenerate session ID after login to prevent Session Fixation.
     */
    async jwt({ token, user }) {
      if (user) {
        // Initial sign-in — embed custom claims and generate a fresh session ID
        token.userId = user.id;
        token.tenantId = (user as { tenantId: string }).tenantId;
        token.role = (user as { role: string }).role;
        token.email = user.email ?? '';
        token.name = user.name ?? '';
        // Regenerate session ID on every new login (prevents Session Fixation)
        token.sessionId = randomUUID();
      }

      return token;
    },

    /**
     * Session callback: shapes what is exposed in `session.user` on the client.
     * Only the safe subset of JWT claims is forwarded.
     */
    async session({ session, token }) {
      session.user = {
        id: token.userId,
        emailVerified: null,
        userId: token.userId,
        tenantId: token.tenantId,
        role: token.role,
        sessionId: token.sessionId,
        email: token.email,
        name: token.name,
      };

      return session;
    },
  },

  // Custom pages (to be created in task 6.4)
  pages: {
    signIn: '/login',
    error: '/login',
  },

  // Debug only in development
  debug: process.env.NODE_ENV === 'development',
};

export const { handlers: { GET, POST }, auth, signIn, signOut } = NextAuth(authConfig);
