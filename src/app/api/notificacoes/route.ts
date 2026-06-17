/**
 * API Routes: /api/notificacoes
 *
 * GET — Retorna as 100 notificações mais recentes do usuário com badge count
 *       (Req. 10.6, 10.8)
 *
 * Auth: lê sessão dos headers x-tenant-id, x-user-id
 *       injetados pelo middleware.ts
 *
 * Requirements: 10.6, 10.7, 10.8
 */

import { type NextRequest } from 'next/server';
import { prisma } from '@/infrastructure/database/prisma/client';
import { handleApiError, AuthenticationError } from '@/shared/errors';

// ─────────────────────────────────────────────────────────────────────────────
// Auth helper
// ─────────────────────────────────────────────────────────────────────────────

function readSession(request: NextRequest): { tenantId: string; userId: string } {
  const tenantId = request.headers.get('x-tenant-id');
  const userId   = request.headers.get('x-user-id');

  if (!tenantId || !userId) {
    throw new AuthenticationError('Sessão inválida ou expirada.');
  }

  return { tenantId, userId };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/notificacoes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Retorna as 100 notificações mais recentes do usuário autenticado,
 * excluindo notificações expiradas (expiresAt <= now).
 *
 * Response: { data: Notification[], unreadCount: number }
 *
 * Requirements: 10.6, 10.8
 */
export async function GET(request: NextRequest): Promise<Response> {
  try {
    const { tenantId, userId } = readSession(request);
    const now = new Date();

    const [notifications, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: {
          tenantId,
          userId,
          expiresAt: { gt: now },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      prisma.notification.count({
        where: {
          tenantId,
          userId,
          expiresAt: { gt: now },
          readAt: null,
        },
      }),
    ]);

    return Response.json({ data: notifications, unreadCount });
  } catch (err) {
    return handleApiError(err);
  }
}
