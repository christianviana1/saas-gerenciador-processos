/**
 * API Routes: /api/processos
 *
 * GET  — Lista processos do tenant com filtros e paginação (Req. 6.6)
 * POST — Cria novo processo judicial (Req. 6.1, 6.2, 6.4, 6.8)
 *
 * Auth: lê sessão dos headers x-tenant-id, x-user-id, x-user-role
 *       injetados pelo middleware.ts
 *
 * Requirements: 6.6, 6.7, 8.4
 */

import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { listProcessesUseCase } from '@/application/processos/ListProcessesUseCase';
import { createProcessUseCase } from '@/application/processos/CreateProcessUseCase';
import { handleApiError, AuthenticationError } from '@/shared/errors';
import type { Role } from '@/domain/services/RBACEngine';

// ─────────────────────────────────────────────────────────────────────────────
// Zod Schemas
// ─────────────────────────────────────────────────────────────────────────────

const CreateProcessSchema = z.object({
  cnjNumber:           z.string().min(1, 'CNJ number is required'),
  clientName:          z.string().min(1, 'Client name is required'),
  processClass:        z.string().min(1, 'Process class is required'),
  subject:             z.string().min(1, 'Subject is required'),
  responsibleUserIds:  z.array(z.string().uuid()).min(1, 'At least one responsible user is required'),
  currentCourt:        z.string().optional(),
  description:         z.string().optional(),
  tags:                z.array(z.string()).optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Auth helper
// ─────────────────────────────────────────────────────────────────────────────

function readSession(request: NextRequest): { tenantId: string; userId: string; role: Role } {
  const tenantId = request.headers.get('x-tenant-id');
  const userId   = request.headers.get('x-user-id');
  const role     = request.headers.get('x-user-role');

  if (!tenantId || !userId || !role) {
    throw new AuthenticationError('Missing authentication headers.');
  }

  return { tenantId, userId, role: role as Role };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/processos
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lista processos do tenant com suporte a filtros e paginação.
 *
 * Query params:
 *   - status, responsibleUserId, currentCourt, tags, createdFrom, createdTo,
 *     search, page, pageSize
 */
export async function GET(request: NextRequest): Promise<Response> {
  try {
    const { tenantId, userId, role } = readSession(request);

    const { searchParams } = request.nextUrl;

    const page     = searchParams.get('page')     ? Number(searchParams.get('page'))     : 1;
    const pageSize = searchParams.get('pageSize')  ? Number(searchParams.get('pageSize')) : 20;
    const tagsRaw  = searchParams.get('tags');

    const result = await listProcessesUseCase.execute({
      tenantId,
      actorUserId: userId,
      actorRole:   role,
      filters: {
        status:            searchParams.get('status') as import('@prisma/client').ProcessStatus | undefined ?? undefined,
        responsibleUserId: searchParams.get('responsibleUserId') ?? undefined,
        currentCourt:      searchParams.get('currentCourt')      ?? undefined,
        tags:              tagsRaw ? tagsRaw.split(',')          : undefined,
        createdFrom:       searchParams.get('createdFrom')       ? new Date(searchParams.get('createdFrom')!) : undefined,
        createdTo:         searchParams.get('createdTo')         ? new Date(searchParams.get('createdTo')!)   : undefined,
        search:            searchParams.get('search')            ?? undefined,
        page:              isNaN(page)     ? 1  : page,
        pageSize:          isNaN(pageSize) ? 20 : pageSize,
      },
    });

    return Response.json({ data: result });
  } catch (err) {
    return handleApiError(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/processos
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cria um novo processo judicial no tenant.
 *
 * Body: CreateProcessSchema
 * Returns 201 com o processo criado.
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

    const parsed = CreateProcessSchema.safeParse(body);
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

    const process = await createProcessUseCase.execute({
      ...parsed.data,
      tenantId,
      actorUserId:    userId,
      actorRole:      role,
      actorTenantId:  tenantId,
    });

    return Response.json({ data: process }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
