/**
 * API Routes: /api/tarefas
 *
 * GET  — Lista tarefas do tenant com filtros e paginação (Req. 9.7)
 * POST — Cria nova tarefa jurídica (Req. 9.2, 9.3, 9.6)
 *
 * Auth: lê sessão dos headers x-tenant-id, x-user-id, x-user-role
 *       injetados pelo middleware.ts
 *
 * Requirements: 9.1, 9.5, 9.7, 9.8
 */

import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { createTaskUseCase } from '@/application/tarefas/CreateTaskUseCase';
import { taskRepository } from '@/infrastructure/database/repositories';
import { handleApiError, AuthenticationError } from '@/shared/errors';
import type { Role } from '@/domain/services/RBACEngine';
import type { TaskStatus, TaskPriority } from '@/domain/entities/Task';

// ─────────────────────────────────────────────────────────────────────────────
// Zod Schemas
// ─────────────────────────────────────────────────────────────────────────────

const CreateTaskSchema = z.object({
  title:           z.string().min(1, 'O título é obrigatório'),
  description:     z.string().optional(),
  priority:        z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']),
  assigneeUserId:  z.string().uuid().optional(),
  dueDate:         z.string().datetime().optional(),
  processId:       z.string().uuid().optional(),
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
// GET /api/tarefas
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lista tarefas do tenant com suporte a filtros e paginação.
 *
 * Query params:
 *   - status, priority, assigneeUserId, processId,
 *     dueDateFrom, dueDateTo, page, pageSize
 *
 * Requirement 9.7
 */
export async function GET(request: NextRequest): Promise<Response> {
  try {
    const { tenantId } = readSession(request);

    const { searchParams } = request.nextUrl;

    const page     = searchParams.get('page')     ? Number(searchParams.get('page'))     : 1;
    const pageSize = searchParams.get('pageSize')  ? Number(searchParams.get('pageSize')) : 20;

    const result = await taskRepository.findMany(
      {
        status:          (searchParams.get('status')         as TaskStatus | null)   ?? undefined,
        priority:        (searchParams.get('priority')       as TaskPriority | null) ?? undefined,
        assigneeUserId:  searchParams.get('assigneeUserId')  ?? undefined,
        processId:       searchParams.get('processId')       ?? undefined,
        dueDateFrom:     searchParams.get('dueDateFrom')     ? new Date(searchParams.get('dueDateFrom')!) : undefined,
        dueDateTo:       searchParams.get('dueDateTo')       ? new Date(searchParams.get('dueDateTo')!)   : undefined,
        page:            isNaN(page)     ? 1  : page,
        pageSize:        isNaN(pageSize) ? 20 : pageSize,
      },
      tenantId,
    );

    return Response.json({ data: result });
  } catch (err) {
    return handleApiError(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/tarefas
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cria uma nova tarefa jurídica no tenant.
 *
 * Body: CreateTaskSchema
 * Returns 201 com a tarefa criada.
 *
 * Requirements: 9.2, 9.3, 9.6, 9.8
 */
export async function POST(request: NextRequest): Promise<Response> {
  try {
    const { tenantId, userId, role } = readSession(request);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json(
        { code: 'VALIDATION_ERROR', message: 'Corpo da requisição inválido.' },
        { status: 400 },
      );
    }

    const parsed = CreateTaskSchema.safeParse(body);
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

    const task = await createTaskUseCase.execute({
      ...rest,
      dueDate:         dueDate ? new Date(dueDate) : undefined,
      tenantId,
      actorUserId:     userId,
      actorRole:       role,
      createdByUserId: userId,
    });

    return Response.json({ data: task }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
