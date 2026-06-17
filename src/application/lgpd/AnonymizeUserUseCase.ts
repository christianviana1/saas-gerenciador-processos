/**
 * AnonymizeUserUseCase — Anonimiza dados pessoais de um usuário em conformidade com a LGPD.
 *
 * Fluxo:
 *  1. Verificar que o usuário existe no tenant
 *  2. Gerar valores anonimizados (nome, email)
 *  3. Atualizar registro do User: nome, email anonimizados, deletedAt = now
 *  4. Atualizar registros de AuditLog do usuário: ipAddress → '0.0.0.0', userAgent → 'ANONIMIZADO'
 *  5. Atualizar registros de CourtHistory: changedByUserId → null para mudanças deste usuário
 *  6. Atualizar registros de ConsentRecord: ipAddress → '0.0.0.0'
 *  7. Registrar evento de auditoria de anonimização (action: 'user:anonymized')
 *
 * Toda a operação é atômica via prisma.$transaction.
 *
 * Requisito: 13.4
 */

import { randomUUID } from 'crypto';
import { prisma } from '@/infrastructure/database/prisma/client';
import { auditQueue } from '@/infrastructure/queues/queues';
import { NotFoundError } from '@/shared/errors';

// ─────────────────────────────────────────────────────────────────────────────
// Constantes de anonimização
// ─────────────────────────────────────────────────────────────────────────────

const ANONYMIZED_NAME = 'Usuário Anonimizado';
const ANONYMIZED_IP = '0.0.0.0';
const ANONYMIZED_USER_AGENT = 'ANONIMIZADO';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface AnonymizeUserInput {
  /** ID do usuário a ser anonimizado */
  userId: string;
  /** Tenant ao qual o usuário pertence */
  tenantId: string;
  /** ID do usuário (ou sistema) que solicitou a anonimização — para auditoria */
  requestedByUserId: string;
  /** IP do solicitante (para auditoria) */
  ipAddress?: string;
  /** User-Agent do solicitante (para auditoria) */
  userAgent?: string;
}

export interface AnonymizeUserOutput {
  /** ID do usuário anonimizado */
  userId: string;
  /** Email anonimizado gerado */
  anonymizedEmail: string;
  /** Timestamp em que a anonimização foi realizada */
  anonymizedAt: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// Use Case
// ─────────────────────────────────────────────────────────────────────────────

export class AnonymizeUserUseCase {
  /**
   * Executa a anonimização completa dos dados pessoais de um usuário.
   *
   * Preserva registros de auditoria e histórico processual de forma anonimizada,
   * garantindo conformidade com a LGPD (art. 18, VI) sem destruir trilhas de auditoria.
   *
   * @throws {NotFoundError} quando o usuário não existe no tenant especificado
   */
  async execute(input: AnonymizeUserInput): Promise<AnonymizeUserOutput> {
    const {
      userId,
      tenantId,
      requestedByUserId,
      ipAddress = ANONYMIZED_IP,
      userAgent = 'server',
    } = input;

    // ── 1. Verificar que o usuário existe no tenant ──────────────────────────
    // Inclui usuários já deletados logicamente — LGPD exige anonimização mesmo nesses casos
    const user = await prisma.user.findFirst({
      where: {
        id: userId,
        tenantId,
      },
      select: {
        id: true,
        email: true,
        name: true,
        status: true,
      },
    });

    if (!user) {
      throw new NotFoundError(
        `Usuário com ID '${userId}' não encontrado neste tenant.`,
        { userId, tenantId },
      );
    }

    // ── 2. Gerar valores anonimizados ────────────────────────────────────────
    // Req 13.4: nome → 'Usuário Anonimizado', email → 'anonimizado-{uuid}@deleted.invalid'
    const anonymizedEmail = `anonimizado-${randomUUID()}@deleted.invalid`;
    const anonymizedAt = new Date();

    // ── 3–6. Executar anonimização em transação atômica ──────────────────────
    // prisma.$transaction garante atomicidade: ou tudo é aplicado ou nada
    await prisma.$transaction([
      // 3. Atualizar registro do usuário
      prisma.user.update({
        where: { id: userId },
        data: {
          name: ANONYMIZED_NAME,
          email: anonymizedEmail,
          // Invalidar hash da senha para impedir futuros logins
          passwordHash: `ANONIMIZADO-${randomUUID()}`,
          // Remover segredo MFA se existir
          mfaSecret: null,
          mfaEnabled: false,
          deletedAt: anonymizedAt,
        },
      }),

      // 4. Anonimizar campos de identificação nos registros de AuditLog
      // Preserva registros intactos (imutabilidade de auditoria), apenas substitui PII
      prisma.auditLog.updateMany({
        where: {
          userId,
          tenantId,
        },
        data: {
          ipAddress: ANONYMIZED_IP,
          userAgent: ANONYMIZED_USER_AGENT,
        },
      }),

      // 5. Anonimizar histórico de tribunais: substituir changedByUserId por null
      // Preserva o registro histórico processual sem vínculo com dados pessoais
      prisma.courtHistory.updateMany({
        where: {
          changedByUserId: userId,
          tenantId,
        },
        data: {
          changedByUserId: null,
        },
      }),

      // 6. Anonimizar registros de consentimento LGPD: preservar registro, remover IP
      prisma.consentRecord.updateMany({
        where: {
          userId,
          tenantId,
        },
        data: {
          ipAddress: ANONYMIZED_IP,
        },
      }),
    ]);

    // ── 7. Registrar evento de auditoria da anonimização (fire-and-forget) ───
    // Req 3.1: registrar ação 'user:anonymized' no Audit_Service
    // Req 3.3: fire-and-forget — não bloqueia o retorno
    // Nota: registrado com userId do solicitante, não do usuário anonimizado
    void auditQueue.add('audit-anonymize-user', {
      tenantId,
      userId: requestedByUserId,
      action: 'user:anonymized',
      resourceType: 'User',
      resourceId: userId,
      ipAddress,
      userAgent,
      payloadBefore: {
        userId: user.id,
        email: user.email,
        name: user.name,
        status: user.status,
      },
      payloadAfter: {
        userId: user.id,
        email: anonymizedEmail,
        name: ANONYMIZED_NAME,
        anonymizedAt: anonymizedAt.toISOString(),
      },
    }).catch((err: unknown) => {
      console.error('[AnonymizeUserUseCase] Falha ao enfileirar evento de auditoria:', err);
    });

    return {
      userId,
      anonymizedEmail,
      anonymizedAt,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton
// ─────────────────────────────────────────────────────────────────────────────

/** Singleton para uso na camada de aplicação. */
export const anonymizeUserUseCase = new AnonymizeUserUseCase();
