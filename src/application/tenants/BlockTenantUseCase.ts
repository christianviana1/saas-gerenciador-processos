/**
 * BlockTenantUseCase — Bloqueia um tenant, impedindo o login imediato de todos
 * os seus usuários.
 *
 * Fluxo:
 *  1. Verifica que o ator é SUPER_ADMIN
 *  2. Confirma que o tenant existe
 *  3. Atualiza tenant.status = 'BLOCKED' no banco via Prisma
 *  4. Grava a chave Redis `tenant:blocked:{tenantId}` = '1' sem expiração —
 *     o middleware e os callbacks do Auth.js verificam essa chave para invalidar
 *     sessões imediatamente (Requisito 1.5)
 *  5. Enfileira evento de auditoria com motivo (fire-and-forget)
 *
 * Requisitos: 1.4, 1.5, 3.1, 3.3
 */

import IORedis from 'ioredis';
import { prisma } from '@/infrastructure/database/prisma/client';
import { auditQueue } from '@/infrastructure/queues/queues';
import { ForbiddenError, NotFoundError } from '@/shared/errors/AppError';
import type { Role } from '@/domain/services/RBACEngine';

// ─────────────────────────────────────────────────────────────────────────────
// Redis connection (dedicada para operações de bloqueio de tenant)
// Reutiliza as mesmas variáveis de ambiente definidas para o BullMQ.
// ─────────────────────────────────────────────────────────────────────────────

const redis = new IORedis({
  host: process.env.REDIS_HOST ?? 'localhost',
  port: Number(process.env.REDIS_PORT ?? 6379),
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null,
});

/** Prefixo da chave Redis que sinaliza tenant bloqueado. */
export const TENANT_BLOCKED_KEY_PREFIX = 'tenant:blocked:';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface BlockTenantInput {
  /** ID do tenant a ser bloqueado */
  tenantId: string;
  /** ID do ator que realiza a ação (para trilha de auditoria) */
  actorUserId: string;
  /** Papel do ator — deve ser SUPER_ADMIN */
  actorRole: Role;
  /** Motivo do bloqueio (obrigatório para auditoria) */
  reason: string;
}

export interface BlockTenantOutput {
  tenantId: string;
  blockedAt: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// Use Case
// ─────────────────────────────────────────────────────────────────────────────

export class BlockTenantUseCase {
  /**
   * Executa o bloqueio do tenant.
   *
   * @throws {ForbiddenError}  quando o ator não é SUPER_ADMIN
   * @throws {NotFoundError}   quando o tenant não existe
   */
  async execute(input: BlockTenantInput): Promise<BlockTenantOutput> {
    const { tenantId, actorUserId, actorRole, reason } = input;

    // ── 1. Verificação de papel ──────────────────────────────────────────────
    // Somente SUPER_ADMIN pode bloquear tenants (Requisito 1.4)
    if (actorRole !== 'SUPER_ADMIN') {
      throw new ForbiddenError(
        'Somente Super Admin pode bloquear tenants.',
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
      data: { status: 'BLOCKED' },
      select: { id: true, updatedAt: true },
    });

    const blockedAt = updated.updatedAt;

    // ── 4. Gravar chave Redis para invalidação imediata de sessões ───────────
    // Chave sem TTL (permanente até que ReactivateTenantUseCase a remova).
    // Requisito 1.5: impedir login imediatamente após bloqueio.
    await redis.set(`${TENANT_BLOCKED_KEY_PREFIX}${tenantId}`, '1');

    // ── 5. Enfileirar evento de auditoria (fire-and-forget) ──────────────────
    // Requisito 3.1: registrar bloqueio de tenant com motivo
    // Requisito 3.3: não bloquear o fluxo principal
    void auditQueue.add('audit-block-tenant', {
      tenantId,
      userId: actorUserId,
      action: 'tenant:blocked',
      resourceType: 'Tenant',
      resourceId: tenantId,
      ipAddress: '0.0.0.0',  // Sobrescrito pela camada de apresentação
      userAgent: 'server',   // Sobrescrito pela camada de apresentação
      payloadBefore: { status: tenant.status },
      payloadAfter: {
        status: 'BLOCKED',
        reason,
        blockedAt: blockedAt.toISOString(),
      },
    }).catch((err: unknown) => {
      console.error('[BlockTenantUseCase] Falha ao enfileirar evento de auditoria:', err);
    });

    return { tenantId, blockedAt };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton
// ─────────────────────────────────────────────────────────────────────────────

/** Singleton para uso na camada de aplicação. */
export const blockTenantUseCase = new BlockTenantUseCase();
