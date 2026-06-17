/**
 * API Routes: /api/tarefas/[id]
 *
 * PATCH  — Atualiza campos mutáveis de uma tarefa (Req. 9.2, 9.7)
 * DELETE — Exclusão lógica com verificação RBAC (Req. 9.8)
 *
 * Auth: lê sessão dos headers x-tenant-id, x-user-id, x-user-role
 *       injetados pelo middleware.ts
 *
 * Requirements: 9.1, 9.5, 9.7, 9.8
 */

import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { taskRepository } from '@/infrastructure/database/repositories';
import { handleApiError, AuthenticationError, ForbiddenError } from '@/shared/errors';
import { auditQueue } from '@/infrastructure/queues/queues';
import type { Role } from '@/domain/services/RBACEngine';

// ─────────────────────────────────────────────────────────────────────────────
// Zod Schema
// ─────────────────────────────────────────────────────────────────────────────

const UpdateTaskSchema = z.object({
  title:          z.string().min(1).optional(),
  description:    z.string().nullable().optional(),
  priority:       z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  assigneeUserId: z.string().uuid().nullable().optional(),
  dueDate:        z.string().datetime().nullable().optional(),
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
// PATCH /api/tarefas/[id]
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Atualiza campos mutáveis de uma tarefa: title, description, priority,
 * assigneeUserId, dueDate. Não altera o status (use /status para Kanban).
 *
 * Requirements: 9.2, 9.7
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

    const parsed = UpdateTaskSchema.safeParse(body);
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

    const { dueDate, ...rest } = parsed.data;

    const updatedTask = await taskRepository.update(
      id,
      {
        ...rest,
        dueDate: dueDate !== undefined
          ? (dueDate !== null ? new Date(dueDate) : null)
          : undefined,
      },
      tenantId,
    );

    // Registrar evento de auditoria (fire-and-forget)
    void auditQueue.add('audit-update-task', {
      tenantId,
      userId,
      action: 'task:update',
      resourceType: 'Task',
      resourceId: id,
      ipAddress: request.headers.get('x-forwarded-for') ?? '0.0.0.0',
      userAgent: request.headers.get('user-agent') ?? 'server',
      payloadAfter: {
        id,
        ...parsed.data,
        updatedAt: updatedTask.updatedAt.toISOString(),
      },
    }).catch((err: unknown) => {
      console.error('[PATCH /api/tarefas/[id]] Falha ao enfileirar evento de auditoria:', err);
    });

    return Response.json({ data: updatedTask });
  } catch (err) {
    return handleApiError(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/tarefas/[id]
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Exclusão lógica de uma tarefa.
 *
 * RBAC: o papel INTERN não pode excluir tarefas (Requirement 9.8, 2.6).
 * Retorna 204 No Content em caso de sucesso.
 * O histórico de movimentação é preservado (Requirement 9.9).
 *
 * Requirements: 9.8, 9.9
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { tenantId, userId, role } = readSession(request);
    const { id } = await params;

    // Requirement 9.8: INTERN não pode excluir tarefas
    if (role === 'INTERN') {
      throw new ForbiddenError(
        'Estagiários não têm permissão para excluir tarefas.',
        { role, action: 'task:delete' },
      );
    }

    await taskRepository.softDelete(id, tenantId);

    // Registrar evento de auditoria (fire-and-forget)
    void auditQueue.add('audit-delete-task', {
      tenantId,
      userId,
      action: 'task:delete',
      resourceType: 'Task',
      resourceId: id,
      ipAddress: request.headers.get('x-forwarded-for') ?? '0.0.0.0',
      userAgent: request.headers.get('user-agent') ?? 'server',
      payloadAfter: { id, deletedAt: new Date().toISOString() },
    }).catch((err: unknown) => {
      console.error('[DELETE /api/tarefas/[id]] Falha ao enfileirar evento de auditoria:', err);
    });

    return new Response(null, { status: 204 });
  } catch (err) {
    return handleApiError(err);
  }
}
