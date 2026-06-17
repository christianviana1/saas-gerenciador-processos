/**
 * API Route: GET /api/auditoria
 *
 * Retorna registros de auditoria paginados com filtros.
 *
 * Controle de acesso:
 *  - OFFICE_ADMIN: acessa apenas registros do seu próprio tenant.
 *  - SUPER_ADMIN: pode filtrar por qualquer tenant (via query param `tenantId`)
 *    ou consultar todos os tenants quando `tenantId` não for informado.
 *  - Demais papéis: HTTP 403.
 *
 * Query params:
 *  - userId        — filtra por usuário que realizou a ação
 *  - action        — filtra por ação (busca parcial)
 *  - resourceType  — filtra por tipo de recurso
 *  - resourceId    — filtra por ID do recurso
 *  - createdFrom   — início do período (ISO 8601)
 *  - createdTo     — fim do período (ISO 8601)
 *  - page          — número da página (padrão: 1)
 *  - pageSize      — registros por página (padrão: 50, máx: 100)
 *  - tenantId      — (somente SUPER_ADMIN) filtra por tenant específico
 *
 * Requirements: 3.5, 3.6
 */

import { type NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { z } from 'zod';

import { auditRepository } from '@/infrastructure/database/repositories/AuditRepository';
import { handleApiError, ForbiddenError } from '@/shared/errors';

// ─────────────────────────────────────────────────────────────────────────────
// Roles with access to audit logs
// ─────────────────────────────────────────────────────────────────────────────

const ALLOWED_ROLES = ['OFFICE_ADMIN', 'SUPER_ADMIN'] as const;
type AllowedRole = (typeof ALLOWED_ROLES)[number];

function isAllowedRole(role: string): role is AllowedRole {
  return (ALLOWED_ROLES as readonly string[]).includes(role);
}

// ─────────────────────────────────────────────────────────────────────────────
// Query param schema
// ─────────────────────────────────────────────────────────────────────────────

const QuerySchema = z.object({
  userId:       z.string().optional(),
  action:       z.string().optional(),
  resourceType: z.string().optional(),
  resourceId:   z.string().optional(),
  createdFrom:  z.string().datetime({ offset: true }).optional(),
  createdTo:    z.string().datetime({ offset: true }).optional(),
  page:         z.coerce.number().int().min(1).default(1),
  pageSize:     z.coerce.number().int().min(1).max(100).default(50),
  /** Honoured only for SUPER_ADMIN */
  tenantId:     z.string().optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/auditoria
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest): Promise<Response> {
  try {
    // ── 1. Authentication ───────────────────────────────────────────────────
    const secret = process.env.NEXTAUTH_SECRET;
    const token = await getToken({ req: request, secret });

    if (!token) {
      return new Response(
        JSON.stringify({ code: 'UNAUTHORIZED', message: 'Autenticação necessária.' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const sessionRole    = token.role as string;
    const sessionTenantId = token.tenantId as string;

    // ── 2. RBAC check ───────────────────────────────────────────────────────
    if (!isAllowedRole(sessionRole)) {
      throw new ForbiddenError(
        'Acesso negado: apenas Office_Admin e Super_Admin podem consultar registros de auditoria.',
      );
    }

    // ── 3. Parse & validate query params ────────────────────────────────────
    const url = new URL(request.url);
    const rawParams = Object.fromEntries(url.searchParams.entries());

    const parsed = QuerySchema.safeParse(rawParams);
    if (!parsed.success) {
      return Response.json(
        {
          code: 'VALIDATION_ERROR',
          message: 'Parâmetros de consulta inválidos.',
          details: parsed.error.flatten().fieldErrors,
        },
        { status: 400 },
      );
    }

    const {
      userId,
      action,
      resourceType,
      resourceId,
      createdFrom,
      createdTo,
      page,
      pageSize,
      tenantId: tenantIdParam,
    } = parsed.data;

    // ── 4. Determine effective tenantId for the query ────────────────────────
    // Requirement 3.5: OFFICE_ADMIN always scoped to their own tenant.
    // Requirement 3.6: SUPER_ADMIN may pass an explicit tenantId or query all.
    let effectiveTenantId: string | null;

    if (sessionRole === 'OFFICE_ADMIN') {
      // Always use the session tenant — ignore the query param
      effectiveTenantId = sessionTenantId;
    } else {
      // SUPER_ADMIN: use query param when provided, null means all tenants
      effectiveTenantId = tenantIdParam ?? null;
    }

    // ── 5. Build filters ─────────────────────────────────────────────────────
    const filters = {
      userId,
      action,
      resourceType,
      resourceId,
      timestampFrom: createdFrom ? new Date(createdFrom) : undefined,
      timestampTo:   createdTo   ? new Date(createdTo)   : undefined,
      page,
      pageSize,
    };

    // ── 6. Query repository ───────────────────────────────────────────────────
    const result = await auditRepository.findMany(filters, effectiveTenantId);

    // ── 7. Return paginated response ─────────────────────────────────────────
    return Response.json({
      data: result.items,
      pagination: {
        page:       result.page,
        pageSize:   result.pageSize,
        total:      result.total,
        totalPages: Math.ceil(result.total / result.pageSize),
        hasNextPage: result.hasNextPage,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
