/**
 * API Routes: /api/tarefas/[id]/status
 *
 * PATCH — Move tarefa para novo status no Kanban (Req. 9.4, 9.9)
 *
 * Auth: lê sessão dos headers x-tenant-id, x-user-id, x-user-role
 *       injetados pelo middleware.ts
 *
 * Requirements: 9.1, 9.5, 9.7, 9.8
 */

import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { moveTaskStatusUseCase } from '@/application/tarefas/MoveTaskStatusUseCase';
import { handleApiError, AuthenticationError } from '@/shared/errors';
import { TaskStatusEnum } from '@/domain/value-objects/TaskStatus';
import type { Role } from '@/domain/services/RBACEngine';

// ─────────────────────────────────────────────────────────────────────────────
// Zod Schema
// ─────────────────────────────────────────────────────────────────────────────

const MoveTaskStatusSchema = z.object({
  toStatus:       z.nativeEnum(TaskStatusEnum, {
    errorMap: () => ({ message: 'Status inválido. Use: TODO, IN_PROGRESS, REVIEW ou DONE.' }),
  }),
  movedByUserId:  z.string().uuid().optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Auth helper
// ─────────────────────────────────────────────────────────────────────────────

function readSession(request: NextRequest): { tenantId: string; userId: string; role: Role } {
  const tenantId = request.headers.get('x-tenant-id');
  const userId   = request.headers.get('x-user-id');
  const role     = request.headers.get('x-user-role');

  if (!tenantId || !userId || !role) {
    throw new AuthenticationError('Sessão inválida ou expirada.');
  }

  return { tenantId, userId, role: role as Role };
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/tarefas/[id]/status
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Move uma tarefa para um novo status no quadro Kanban.
 *
 * Body: { toStatus: TaskStatusEnum, movedByUserId?: string }
 *
 * O `movedByUserId` é opcional: quando omitido, usa o userId da sessão.
 * Valida transições de status via MoveTaskStatusUseCase.
 * Registra movimentação imutável em TaskHistory (Requirement 9.4, 9.9).
 *
 * Returns 200 com a tarefa atualizada.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { tenantId, userId, role } = readSession(request);
    const { id } = await params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json(
        { code: 'VALIDATION_ERROR', message: 'Corpo da requisição inválido.' },
        { status: 400 },
      );
    }

    const parsed = MoveTaskStatusSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        {
          code:    'VALIDATION_ERROR',
          message: 'Dados inválidos.',
          details: parsed.error.flatten().fieldErrors,
        },
        { status: 400 },
      );
    }

    const { toStatus, movedByUserId } = parsed.data;

    const updatedTask = await moveTaskStatusUseCase.execute({
      taskId:      id,
      tenantId,
      actorUserId: movedByUserId ?? userId,
      actorRole:   role,
      toStatus,
    });

    return Response.json({ data: updatedTask });
  } catch (err) {
    return handleApiError(err);
  }
}
