/**
 * DeactivateUserUseCase — Desativa um usuário de um tenant.
 *
 * Fluxo:
 *  1. Verifica permissão RBAC (user:deactivate) do ator
 *  2. Verifica que o usuário alvo existe no tenant e está ativo
 *  3. Impede auto-desativação
 *  4. Atualiza status do usuário para INACTIVE
 *  5. Enfileira evento de auditoria via auditQueue
 *
 * Requisitos: 4.8, 4.9, 2.2
 */

import { prisma } from '@/infrastructure/database/prisma/client';
import { rbacEngine } from '@/domain/services/RBACEngine';
import { auditQueue } from '@/infrastructure/queues/queues';
import { NotFoundError, ForbiddenError } from '@/shared/errors';
import type { Role } from '@/domain/services/RBACEngine';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface DeactivateUserInput {
  /** ID do usuário a ser desativado */
  targetUserId: string;
  /** Tenant ao qual o usuário pertence */
  tenantId: string;
  /** ID do usuário que está realizando a ação */
  actorId: string;
  /** Papel do ator (para verificação RBAC) */
  actorRole: Role;
  /** IP do ator (para auditoria) */
  ipAddress?: string;
  /** User-Agent do ator (para auditoria) */
  userAgent?: string;
}

export interface DeactivateUserOutput {
  userId: string;
  status: 'INACTIVE';
}

// ─────────────────────────────────────────────────────────────────────────────
// Use Case
// ─────────────────────────────────────────────────────────────────────────────

export class DeactivateUserUseCase {
  /**
   * Executa o fluxo de desativação de usuário.
   *
   * @throws {ForbiddenError} quando o ator não tem permissão `user:deactivate`
   * @throws {ForbiddenError} quando o ator tenta desativar a si mesmo
   * @throws {NotFoundError} quando o usuário alvo não existe no tenant
   */
  async execute(input: DeactivateUserInput): Promise<DeactivateUserOutput> {
    const {
      targetUserId,
      tenantId,
      actorId,
      actorRole,
      ipAddress = '0.0.0.0',
      userAgent = 'server',
    } = input;

    // ── 1. Verificação RBAC ──────────────────────────────────────────────────
    // Req 2.2, 4.7: apenas Office_Admin e Super_Admin podem desativar usuários
    rbacEngine.enforce(
      {
        userId: actorId,
        tenantId,
        role: actorRole,
        resourceTenantId: tenantId,
      },
      'user:deactivate',
    );

    // ── 2. Impedir auto-desativação ──────────────────────────────────────────
    if (actorId === targetUserId) {
      throw new ForbiddenError('Um usuário não pode desativar a própria conta.');
    }

    // ── 3. Verificar que o usuário existe no tenant ──────────────────────────
    const user = await prisma.user.findFirst({
      where: {
        id: targetUserId,
        tenantId,
        deletedAt: null,
      },
      select: {
        id: true,
        email: true,
        status: true,
        role: true,
      },
    });

    if (!user) {
      throw new NotFoundError(
        `Usuário com ID '${targetUserId}' não encontrado neste tenant.`,
        { targetUserId, tenantId },
      );
    }

    // ── 4. Atualizar status para INACTIVE ────────────────────────────────────
    // Req 4.8: desativar conta do usuário
    await prisma.user.update({
      where: { id: targetUserId },
      data: { status: 'INACTIVE' },
    });

    // ── 5. Registrar evento de auditoria (fire-and-forget) ───────────────────
    // Req 3.1, 4.9: registrar desativação no Audit_Service
    void auditQueue.add('audit-deactivate-user', {
      tenantId,
      userId: actorId,
      action: 'user:deactivated',
      resourceType: 'User',
      resourceId: targetUserId,
      ipAddress,
      userAgent,
      payloadBefore: {
        userId: user.id,
        email: user.email,
        status: user.status,
        role: user.role,
      },
      payloadAfter: {
        userId: user.id,
        status: 'INACTIVE',
      },
    });

    return {
      userId: targetUserId,
      status: 'INACTIVE',
    };
  }
}

/** Singleton para uso na camada de aplicação. */
export const deactivateUserUseCase = new DeactivateUserUseCase();
