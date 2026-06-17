/**
 * API Routes: /api/admin/tenants/[id]
 *
 * GET   — Detalhes do tenant (somente SUPER_ADMIN)
 * PATCH — Atualiza plano e/ou status do tenant (somente SUPER_ADMIN)
 *
 * RBAC: exclusivo para SUPER_ADMIN — qualquer outro papel recebe 403.
 *
 * Requirements: 1.4, 1.5, 1.6, 2.1
 */

import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/infrastructure/database/prisma/client';
import { blockTenantUseCase } from '@/application/tenants/BlockTenantUseCase';
import { reactivateTenantUseCase } from '@/application/tenants/ReactivateTenantUseCase';
import { handleApiError } from '@/shared/errors';
import { AuthenticationError, ForbiddenError, NotFoundError } from '@/shared/errors';

// ─────────────────────────────────────────────────────────────────────────────
// Zod Schema
// ─────────────────────────────────────────────────────────────────────────────

const PatchTenantSchema = z.object({
  plan:   z.enum(['BASIC', 'PROFESSIONAL', 'ENTERPRISE']).optional(),
  status: z.enum(['ACTIVE', 'BLOCKED', 'SUSPENDED', 'TERMINATED']).optional(),
  reason: z.string().max(500).optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// RBAC guard helper
// ─────────────────────────────────────────────────────────────────────────────

function assertSuperAdmin(userId: string | null, role: string | null): void {
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
// GET /api/admin/tenants/[id]
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Retorna os detalhes completos de um tenant, incluindo contagem de usuários.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const userId   = request.headers.get('x-user-id');
    const userRole = request.headers.get('x-user-role');

    assertSuperAdmin(userId, userRole);

    const { id } = await params;

    const tenant = await prisma.tenant.findUnique({
      where: { id },
      select: {
        id:        true,
        name:      true,
        slug:      true,
        plan:      true,
        status:    true,
        settings:  true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            users: true,
          },
        },
      },
    });

    if (!tenant) {
      throw new NotFoundError(`Tenant '${id}' não encontrado.`, { id });
    }

    return Response.json({
      data: {
        ...tenant,
        userCount: tenant._count.users,
        _count:    undefined,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/admin/tenants/[id]
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Atualiza o plano e/ou status de um tenant.
 *
 * Para status BLOCKED usa BlockTenantUseCase (Redis + auditoria).
 * Para status ACTIVE  usa ReactivateTenantUseCase (remove chave Redis + auditoria).
 * Para alteração de plano atualiza diretamente via Prisma (Requisito 1.6).
 *
 * Body: { plan?: TenantPlan, status?: TenantStatus, reason?: string }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const userId   = request.headers.get('x-user-id');
    const userRole = request.headers.get('x-user-role');

    assertSuperAdmin(userId, userRole);

    const { id } = await params;

    // ── Verificar existência do tenant ───────────────────────────────────────
    const existing = await prisma.tenant.findUnique({
      where:  { id },
      select: { id: true, status: true, plan: true },
    });

    if (!existing) {
      throw new NotFoundError(`Tenant '${id}' não encontrado.`, { id });
    }

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

    const parsed = PatchTenantSchema.safeParse(body);
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

    const { plan, status, reason } = parsed.data;

    // ── Alterar plano (Requisito 1.6) ────────────────────────────────────────
    if (plan && plan !== existing.plan) {
      await prisma.tenant.update({
        where: { id },
        data:  { plan },
      });
    }

    // ── Alterar status ───────────────────────────────────────────────────────
    if (status && status !== existing.status) {
      if (status === 'BLOCKED') {
        // Usa BlockTenantUseCase para garantir Redis + auditoria (Requisito 1.5)
        await blockTenantUseCase.execute({
          tenantId:    id,
          actorUserId: userId!,
          actorRole:   'SUPER_ADMIN',
          reason:      reason ?? 'Bloqueado via API',
        });
      } else if (status === 'ACTIVE') {
        // Usa ReactivateTenantUseCase para remover chave Redis + auditoria (Requisito 1.5)
        await reactivateTenantUseCase.execute({
          tenantId:    id,
          actorUserId: userId!,
          actorRole:   'SUPER_ADMIN',
        });
      } else {
        // Outros status (SUSPENDED, TERMINATED) — atualização direta
        await prisma.tenant.update({
          where: { id },
          data:  { status },
        });
      }
    }

    // ── Retornar tenant atualizado ───────────────────────────────────────────
    const updated = await prisma.tenant.findUnique({
      where:  { id },
      select: {
        id:        true,
        name:      true,
        slug:      true,
        plan:      true,
        status:    true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return Response.json({
      data:    updated,
      message: 'Tenant atualizado com sucesso.',
    });
  } catch (err) {
    return handleApiError(err);
  }
}
