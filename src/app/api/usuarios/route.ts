/**
 * API Routes: /api/usuarios
 *
 * GET  — Lista usuários do tenant com paginação e filtros
 * POST — Convida novo usuário ao tenant
 *
 * Requirements: 4.2, 4.7, 2.2
 */

import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/infrastructure/database/prisma/client';
import { inviteUserUseCase } from '@/application/usuarios/InviteUserUseCase';
import { handleApiError } from '@/shared/errors';
import { AuthenticationError } from '@/shared/errors';
import type { Role } from '@/domain/services/RBACEngine';
import type { UserRole, UserStatus } from '@prisma/client';

// ─────────────────────────────────────────────────────────────────────────────
// Zod Schemas
// ─────────────────────────────────────────────────────────────────────────────

const ListQuerySchema = z.object({
  page:     z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  role:     z.enum(['SUPER_ADMIN', 'OFFICE_ADMIN', 'LAWYER', 'LEGAL_ASSISTANT', 'INTERN', 'READ_ONLY_USER']).optional(),
  status:   z.enum(['ACTIVE', 'INACTIVE', 'PENDING']).optional(),
  search:   z.string().max(255).optional(),
});

const InviteUserSchema = z.object({
  email: z.string().email('Email inválido').max(255),
  role:  z.enum(['OFFICE_ADMIN', 'LAWYER', 'LEGAL_ASSISTANT', 'INTERN', 'READ_ONLY_USER'], {
    errorMap: () => ({ message: 'Papel inválido' }),
  }),
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/usuarios
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lista os usuários ativos do tenant com suporte a paginação e filtros.
 *
 * Query params: page, pageSize, role, status, search
 */
export async function GET(request: NextRequest): Promise<Response> {
  try {
    // ── 1. Extrair contexto da sessão dos headers (injetados pelo middleware) ─
    const tenantId = request.headers.get('x-tenant-id');
    const userId   = request.headers.get('x-user-id');

    if (!tenantId || !userId) {
      throw new AuthenticationError('Sessão inválida ou expirada.');
    }

    // ── 2. Validar query params ───────────────────────────────────────────────
    const url = new URL(request.url);
    const queryParams = Object.fromEntries(url.searchParams.entries());

    const parsed = ListQuerySchema.safeParse(queryParams);
    if (!parsed.success) {
      return Response.json(
        { code: 'VALIDATION_ERROR', message: 'Parâmetros de consulta inválidos', details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }

    const { page, pageSize, role, status, search } = parsed.data;

    // ── 3. Montar filtros ─────────────────────────────────────────────────────
    const where: {
      tenantId: string;
      deletedAt: null;
      role?: UserRole;
      status?: UserStatus;
      OR?: Array<{ name?: { contains: string; mode: 'insensitive' }; email?: { contains: string; mode: 'insensitive' } }>;
    } = {
      tenantId,
      deletedAt: null,
    };

    if (role) where.role = role;
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { name:  { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    // ── 4. Consultar banco com paginação ──────────────────────────────────────
    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id:          true,
          email:       true,
          name:        true,
          role:        true,
          status:      true,
          mfaEnabled:  true,
          lastLoginAt: true,
          createdAt:   true,
        },
        orderBy: { createdAt: 'desc' },
        skip:  (page - 1) * pageSize,
        take:  pageSize,
      }),
      prisma.user.count({ where }),
    ]);

    return Response.json({
      data: users,
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
// POST /api/usuarios
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convida um novo usuário ao tenant.
 *
 * Body: { email: string, role: UserRole }
 */
export async function POST(request: NextRequest): Promise<Response> {
  try {
    // ── 1. Extrair contexto da sessão dos headers ─────────────────────────────
    const tenantId = request.headers.get('x-tenant-id');
    const userId   = request.headers.get('x-user-id');
    const userRole = request.headers.get('x-user-role') as Role | null;

    if (!tenantId || !userId || !userRole) {
      throw new AuthenticationError('Sessão inválida ou expirada.');
    }

    // ── 2. Validar corpo da requisição ────────────────────────────────────────
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json(
        { code: 'VALIDATION_ERROR', message: 'Corpo da requisição inválido.' },
        { status: 400 },
      );
    }

    const parsed = InviteUserSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { code: 'VALIDATION_ERROR', message: 'Dados inválidos', details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }

    const { email, role } = parsed.data;

    // ── 3. Executar use case ──────────────────────────────────────────────────
    const result = await inviteUserUseCase.execute({
      email,
      role: role as UserRole,
      tenantId,
      invitedById: userId,
      actorRole:   userRole,
      actorTenantId: tenantId,
    });

    return Response.json(
      {
        invitationId: result.invitationId,
        expiresAt:    result.expiresAt,
        message:      'Convite enviado com sucesso.',
      },
      { status: 201 },
    );
  } catch (err) {
    return handleApiError(err);
  }
}
