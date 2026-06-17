/**
 * API Routes: /api/notificacoes/[id]/lida
 *
 * PATCH — Marca uma notificação In-App como lida (Req. 10.7)
 *
 * Auth: lê sessão dos headers x-tenant-id, x-user-id
 *       injetados pelo middleware.ts
 *
 * Requirements: 10.6, 10.7
 */

import { type NextRequest } from 'next/server';
import { prisma } from '@/infrastructure/database/prisma/client';
import { handleApiError, AuthenticationError, NotFoundError, ForbiddenError } from '@/shared/errors';

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
// PATCH /api/notificacoes/[id]/lida
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Marca uma notificação como lida definindo `readAt = new Date()`.
 *
 * Verifica que a notificação pertence ao usuário autenticado (userId + tenantId)
 * antes de persistir a alteração. Notificações já lidas são retornadas sem
 * nova escrita no banco (idempotente).
 *
 * Returns 200 com a notificação atualizada.
 *
 * Requirement 10.7
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { tenantId, userId } = readSession(request);
    const { id } = await params;

    // Busca a notificação para verificar propriedade antes de atualizar
    const notification = await prisma.notification.findUnique({
      where: { id },
    });

    if (!notification) {
      throw new NotFoundError('Notificação não encontrada.');
    }

    // Garante que a notificação pertence ao tenant e ao usuário da sessão
    if (notification.tenantId !== tenantId || notification.userId !== userId) {
      throw new ForbiddenError('Acesso negado a esta notificação.');
    }

    // Idempotência: se já está lida, retorna sem nova escrita
    if (notification.readAt !== null) {
      return Response.json({ data: notification });
    }

    const updated = await prisma.notification.update({
      where: { id },
      data:  { readAt: new Date() },
    });

    return Response.json({ data: updated });
  } catch (err) {
    return handleApiError(err);
  }
}
