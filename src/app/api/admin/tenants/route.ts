/**
 * API Routes: /api/admin/tenants
 *
 * GET  — Lista todos os tenants com paginação (somente SUPER_ADMIN)
 * POST — Cria novo tenant (somente SUPER_ADMIN)
 *
 * RBAC: exclusivo para SUPER_ADMIN — qualquer outro papel recebe 403.
 *
 * Requirements: 1.4, 2.1
 */

import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/infrastructure/database/prisma/client';
import { createTenantUseCase } from '@/application/tenants/CreateTenantUseCase';
import { handleApiError } from '@/shared/errors';
import { AuthenticationError, ForbiddenError } from '@/shared/errors';
import type { Role } from '@/domain/services/RBACEngine';

// ─────────────────────────────────────────────────────────────────────────────
// Zod Schemas
// ─────────────────────────────────────────────────────────────────────────────

const ListQuerySchema = z.object({
  page:     z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status:   z.enum(['ACTIVE', 'BLOCKED', 'SUSPENDED', 'TERMINATED']).optional(),
  plan:     z.enum(['BASIC', 'PROFESSIONAL', 'ENTERPRISE']).optional(),
  search:   z.string().max(255).optional(),
});

const CreateTenantSchema = z.object({
  name: z.string().min(2, 'Nome deve ter ao menos 2 caracteres').max(255),
  slug: z.string().min(3, 'Slug deve ter ao menos 3 caracteres').max(100),
  plan: z.enum(['BASIC', 'PROFESSIONAL', 'ENTERPRISE']).optional().default('BASIC'),
});

// ─────────────────────────────────────────────────────────────────────────────
// RBAC guard helper
// ─────────────────────────────────────────────────────────────────────────────

function assertSuperAdmin(userId: string | null, role: string | null): asserts role is 'SUPER_ADMIN' {
  if (!userId || !role) {
    throw new AuthenticationError('Sessão inválida ou expirada.');
  }
  if (role !== 'SUPER_ADMIN') {
    throw new ForbiddenError(
      'Acesso restrito ao Super Admin.',
      { role },
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/tenants
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lista todos os tenants com paginação e filtros opcionais.
 *
 * Query params: page, pageSize, status, plan, search
 */
export async function GET(request: NextRequest): Promise<Response> {
  try {
    const userId   = request.headers.get('x-user-id');
    const userRole = request.headers.get('x-user-role');

    assertSuperAdmin(userId, userRole);

    // ── Validar query params ─────────────────────────────────────────────────
    const url = new URL(request.url);
    const queryParams = Object.fromEntries(url.searchParams.entries());

    const parsed = ListQuerySchema.safeParse(queryParams);
    if (!parsed.success) {
      return Response.json(
        {
          code:    'VALIDATION_ERROR',
          message: 'Parâmetros de consulta inválidos',
          details: parsed.error.flatten().fieldErrors,
        },
        { status: 400 },
      );
    }

    const { page, pageSize, status, plan, search } = parsed.data;

    // ── Montar filtros ───────────────────────────────────────────────────────
    type TenantWhere = {
      status?: 'ACTIVE' | 'BLOCKED' | 'SUSPENDED' | 'TERMINATED';
      plan?:   'BASIC' | 'PROFESSIONAL' | 'ENTERPRISE';
      OR?:     Array<{ name?: { contains: string; mode: 'insensitive' }; slug?: { contains: string; mode: 'insensitive' } }>;
    };

    const where: TenantWhere = {};
    if (status) where.status = status;
    if (plan)   where.plan   = plan;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { slug: { contains: search, mode: 'insensitive' } },
      ];
    }

    // ── Consultar banco ──────────────────────────────────────────────────────
    const [tenants, total] = await Promise.all([
      prisma.tenant.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip:    (page - 1) * pageSize,
        take:    pageSize,
        select: {
          id:        true,
          name:      true,
          slug:      true,
          plan:      true,
          status:    true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: { users: true },
          },
        },
      }),
      prisma.tenant.count({ where }),
    ]);

    return Response.json({
      data: tenants.map((t: any) => ({
        ...t,
        userCount: t._count.users,
        _count: undefined,
      })),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/admin/tenants
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cria um novo tenant.
 *
 * Body: { name: string, slug: string, plan?: TenantPlan }
 */
export async function POST(request: NextRequest): Promise<Response> {
  try {
    const userId   = request.headers.get('x-user-id');
    const userRole = request.headers.get('x-user-role');

    assertSuperAdmin(userId, userRole);

    // ── Validar corpo ────────────────────────────────────────────────────────
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json(
        { code: 'VALIDATION_ERROR', message: 'Corpo da requisição inválido.' },
        { status: 400 },
      );
    }

    const parsed = CreateTenantSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        {
          code:    'VALIDATION_ERROR',
          message: 'Dados inválidos',
          details: parsed.error.flatten().fieldErrors,
        },
        { status: 400 },
      );
    }

    const { name, slug, plan } = parsed.data;

    // ── Executar use case ────────────────────────────────────────────────────
    const tenant = await createTenantUseCase.execute({
      name,
      slug,
      plan,
      actorRole:   userRole as Role,
      actorUserId: userId!,
    });

    return Response.json(
      {
        data:    tenant,
        message: 'Tenant criado com sucesso.',
      },
      { status: 201 },
    );
  } catch (err) {
    return handleApiError(err);
  }
}
