/**
 * API Route: PATCH /api/usuarios/[id]/status
 *
 * Desativa um usuário do tenant.
 * Apenas Office_Admin e Super_Admin podem executar esta ação.
 *
 * Requirements: 4.8, 4.9, 2.2
 */

import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { deactivateUserUseCase } from '@/application/usuarios/DeactivateUserUseCase';
import { handleApiError, AuthenticationError } from '@/shared/errors';
import type { Role } from '@/domain/services/RBACEngine';

// ─────────────────────────────────────────────────────────────────────────────
// Zod Schema
// ─────────────────────────────────────────────────────────────────────────────

const PatchStatusSchema = z.object({
  action: z.literal('deactivate', {
    errorMap: () => ({ message: "Ação inválida. Use 'deactivate'." }),
  }),
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/usuarios/[id]/status
// ─────────────────────────────────────────────────────────────────────────────

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    // ── 1. Extrair contexto da sessão dos headers ─────────────────────────────
    const tenantId = request.headers.get('x-tenant-id');
    const userId   = request.headers.get('x-user-id');
    const userRole = request.headers.get('x-user-role') as Role | null;

    if (!tenantId || !userId || !userRole) {
      throw new AuthenticationError('Sessão inválida ou expirada.');
    }

    // ── 2. Extrair ID do usuário alvo da rota ─────────────────────────────────
    const { id: targetUserId } = await params;

    // ── 3. Validar corpo da requisição ────────────────────────────────────────
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json(
        { code: 'VALIDATION_ERROR', message: 'Corpo da requisição inválido.' },
        { status: 400 },
      );
    }

    const parsed = PatchStatusSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { code: 'VALIDATION_ERROR', message: 'Dados inválidos', details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }

    // ── 4. Obter IP e User-Agent para auditoria ───────────────────────────────
    const ipAddress = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      ?? request.headers.get('x-real-ip')
      ?? '0.0.0.0';
    const userAgent = request.headers.get('user-agent') ?? 'unknown';

    // ── 5. Executar use case ──────────────────────────────────────────────────
    const result = await deactivateUserUseCase.execute({
      targetUserId,
      tenantId,
      actorId:   userId,
      actorRole: userRole,
      ipAddress,
      userAgent,
    });

    return Response.json({
      userId: result.userId,
      status: result.status,
      message: 'Usuário desativado com sucesso.',
    });
  } catch (err) {
    return handleApiError(err);
  }
}
