/**
 * Auth.js v5 catch-all route handler.
 *
 * Re-exports the GET and POST handlers produced by NextAuth() in `src/auth.ts`.
 * This file must be a thin re-export — all configuration lives in `src/auth.ts`.
 *
 * Requirements: 5.1, 5.2, 5.3
 */

export { GET, POST } from '@/auth';
