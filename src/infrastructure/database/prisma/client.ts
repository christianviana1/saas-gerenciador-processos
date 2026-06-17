/**
 * Prisma Client Singleton
 *
 * Prevents multiple PrismaClient instances from being created in
 * development due to Next.js hot-reloading.
 *
 * In production a new instance is created once per process.
 */

import { PrismaClient } from '@prisma/client'

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined
}

export const prisma = global.prisma ?? new PrismaClient()

if (process.env.NODE_ENV !== 'production') global.prisma = prisma
