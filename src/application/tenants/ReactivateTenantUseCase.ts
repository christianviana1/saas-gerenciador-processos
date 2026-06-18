/**
 * ReactivateTenantUseCase — Reativa um tenant previamente bloqueado ou suspenso,
 * permitindo que seus usuários voltem a fazer login.
 *
 * Fluxo:
 *  1. Verifica que o ator é SUPER_ADMIN
 *  2. Confirma que o tenant existe
 *  3. Atualiza tenant.status = 'ACTIVE' no banco via Prisma
 *  4. Remove a chave Redis `tenant:blocked:{tenantId}` — libera as sessões
 *  5. Enfileira evento de auditoria (fire-and-forget)
 *
 * Requisitos: 1.4, 1.5, 3.1, 3.3
 */

import IORedis from 'ioredis';
import { prisma } from '@/infrastructure/database/prisma/client';
import { auditQueue } from '@/infrastructure/queues/queues';
import { ForbiddenError, NotFoundError } from '@/shared/errors/AppError';
import { TENANT_BLOCKED_KEY_PREFIX } from './BlockTenantUseCase';
import type { Role } from '@/domain/services/RBACEngine';

// ─────────────────────────────────────────────────────────────────────────────
// Redis connection (mesma configuração usada no BlockTenantUseCase)
// ─────────────────────────────────────────────────────────────────────────────

const redis = new IORedis({
  host: process.env.REDIS_HOST ?? 'localhost',
  port: Number(process.env.REDIS_PORT ?? 6379),
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null,
  lazyConnect: true,
});

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ReactivateTenantInput {
  /** ID do tenant a ser reativado */
  tenantId: string;
  /** ID do ator que realiza a ação (para trilha de auditoria) */
  actorUserId: string;
  /** Papel do ator — deve ser SUPER_ADMIN */
  actorRole: Role;
}

export interface ReactivateTenantOutput {
  tenantId: string;
  reactivatedAt: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// Use Case
// ─────────────────────────────────────────────────────────────────────────────

export class ReactivateTenantUseCase {
  /**
   * Executa a reativação do tenant.
   *
   * @throws {ForbiddenError}  quando o ator não é SUPER_ADMIN
   * @throws {NotFoundError}   quando o tenant não existe
   */
  async execute(input: ReactivateTenantInput): Promise<ReactivateTenantOutput> {
    const { tenantId, actorUserId, actorRole } = input;

    // ── 1. Verificação de papel ──────────────────────────────────────────────
    // Somente SUPER_ADMIN pode reativar tenants (Requisito 1.4)
    if (actorRole !== 'SUPER_ADMIN') {
      throw new ForbiddenError(
        'Somente Super Admin pode reativar tenants.',
        { actorRole },
      );
    }

    // ── 2. Confirmar existência do tenant ────────────────────────────────────
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, name: true, status: true },
    });

    if (!tenant) {
      throw new NotFoundError(
        `Tenant '${tenantId}' não encontrado.`,
        { tenantId },
      );
    }

    // ── 3. Atualizar status no banco ─────────────────────────────────────────
    const updated = await prisma.tenant.update({
      where: { id: tenantId },
      data: { status: 'ACTIVE' },
      select: { id: true, updatedAt: true },
    });

    const reactivatedAt = updated.updatedAt;

    // ── 4. Remover chave Redis de bloqueio ───────────────────────────────────
    // A remoção da chave faz com que o middleware permita novamente os logins.
    // Requisito 1.5: a remoção é imediata — próximas requisições passam a ser aceitas.
    await redis.del(`${TENANT_BLOCKED_KEY_PREFIX}${tenantId}`);

    // ── 5. Enfileirar evento de auditoria (fire-and-forget) ──────────────────
    // Requisito 3.1: registrar reativação de tenant
    // Requisito 3.3: não bloquear o fluxo principal
    void auditQueue.add('audit-reactivate-tenant', {
      tenantId,
      userId: actorUserId,
      action: 'tenant:reactivated',
      resourceType: 'Tenant',
      resourceId: tenantId,
      ipAddress: '0.0.0.0',  // Sobrescrito pela camada de apresentação
      userAgent: 'server',   // Sobrescrito pela camada de apresentação
      payloadBefore: { status: tenant.status },
      payloadAfter: {
        status: 'ACTIVE',
        reactivatedAt: reactivatedAt.toISOString(),
      },
    }).catch((err: unknown) => {
      console.error('[ReactivateTenantUseCase] Falha ao enfileirar evento de auditoria:', err);
    });

    return { tenantId, reactivatedAt };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton
// ─────────────────────────────────────────────────────────────────────────────

/** Singleton para uso na camada de aplicação. */
export const reactivateTenantUseCase = new ReactivateTenantUseCase();
