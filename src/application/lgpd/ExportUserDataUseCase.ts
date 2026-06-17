/**
 * ExportUserDataUseCase — Exporta todos os dados pessoais de um usuário (portabilidade LGPD).
 *
 * Fluxo:
 *  1. Coleta o registro do usuário
 *  2. Coleta registros de consentimento (ConsentRecord)
 *  3. Coleta logs de auditoria associados ao userId
 *  4. Coleta notificações associadas ao userId
 *  5. Coleta convites criados pelo usuário (InvitationToken onde invitedById = userId)
 *  6. Serializa tudo em JSON com estrutura padronizada
 *  7. Retorna a string JSON para disponibilização ao titular
 *
 * Requisitos: 13.3
 * LGPD Art. 18, III — Direito de portabilidade dos dados pessoais.
 *
 * Decisão de design: Retorno síncrono (string JSON) é suficiente para a maioria dos
 * usuários com < 1.000 registros. Para volumes maiores, a camada de apresentação pode
 * enviar o resultado por email / armazenar em object storage conforme o requisito das 72h.
 */

import { prisma } from '@/infrastructure/database/prisma/client';
import { NotFoundError } from '@/shared/errors/AppError';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ExportUserDataInput {
  /** ID do usuário cujos dados serão exportados */
  userId: string;
  /** Tenant ao qual o usuário pertence — garante isolamento multi-tenant */
  tenantId: string;
}

/** Estrutura padronizada do arquivo de exportação de dados pessoais */
export interface UserDataExport {
  /** Dados cadastrais do usuário (sem passwordHash e mfaSecret) */
  user: {
    id: string;
    email: string;
    name: string;
    role: string;
    status: string;
    mfaEnabled: boolean;
    lastLoginAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  };
  /** Registros de consentimento LGPD do usuário */
  consents: {
    id: string;
    policyVersion: string;
    consentedAt: Date;
    ipAddress: string;
    userAgent: string;
  }[];
  /** Logs de auditoria onde o userId corresponde ao usuário exportado */
  auditLogs: {
    id: string;
    action: string;
    resourceType: string;
    resourceId: string | null;
    timestamp: Date;
    ipAddress: string;
    userAgent: string;
  }[];
  /** Notificações recebidas pelo usuário */
  notifications: {
    id: string;
    type: string;
    title: string;
    body: string;
    resourceType: string | null;
    resourceId: string | null;
    readAt: Date | null;
    createdAt: Date;
  }[];
  /** Convites criados pelo usuário (invitedById) */
  invitationsCreated: {
    id: string;
    email: string;
    role: string;
    expiresAt: Date;
    usedAt: Date | null;
    revokedAt: Date | null;
    createdAt: Date;
  }[];
  /** Timestamp ISO 8601 do momento da exportação */
  exportedAt: string;
}

export interface ExportUserDataOutput {
  /** JSON serializado com todos os dados pessoais do usuário */
  json: string;
  /** Metadados da exportação para rastreabilidade */
  meta: {
    userId: string;
    tenantId: string;
    exportedAt: string;
    recordCounts: {
      consents: number;
      auditLogs: number;
      notifications: number;
      invitationsCreated: number;
    };
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Use Case
// ─────────────────────────────────────────────────────────────────────────────

export class ExportUserDataUseCase {
  /**
   * Coleta e serializa todos os dados pessoais do usuário em JSON.
   *
   * @throws {NotFoundError} quando o userId não existe no tenant informado
   */
  async execute(input: ExportUserDataInput): Promise<ExportUserDataOutput> {
    const { userId, tenantId } = input;

    // ── 1. Buscar registro do usuário ────────────────────────────────────────
    // Exclui campos sensíveis: passwordHash e mfaSecret nunca são exportados.
    // Requisito 13.3 — dados pessoais identificáveis disponibilizados ao titular.
    const user = await prisma.user.findFirst({
      where: {
        id: userId,
        tenantId,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        mfaEnabled: true,
        lastLoginAt: true,
        createdAt: true,
        updatedAt: true,
        // passwordHash e mfaSecret são EXCLUÍDOS intencionalmente
      },
    });

    if (!user) {
      throw new NotFoundError(
        `Usuário '${userId}' não encontrado no tenant '${tenantId}'.`,
        { userId, tenantId },
      );
    }

    // ── 2. Buscar registros de consentimento ─────────────────────────────────
    // Requisito 13.1 — histórico completo de consentimentos LGPD do usuário.
    const consents = await prisma.consentRecord.findMany({
      where: {
        userId,
        tenantId,
      },
      select: {
        id: true,
        policyVersion: true,
        consentedAt: true,
        ipAddress: true,
        userAgent: true,
      },
      orderBy: { consentedAt: 'asc' },
    });

    // ── 3. Buscar logs de auditoria ──────────────────────────────────────────
    // Somente logs do userId dentro do tenant — respeita isolamento multi-tenant.
    // Campos de payload excluídos por padrão para reduzir tamanho do export.
    const auditLogs = await prisma.auditLog.findMany({
      where: {
        userId,
        tenantId,
      },
      select: {
        id: true,
        action: true,
        resourceType: true,
        resourceId: true,
        timestamp: true,
        ipAddress: true,
        userAgent: true,
      },
      orderBy: { timestamp: 'asc' },
    });

    // ── 4. Buscar notificações ───────────────────────────────────────────────
    // Requisito 10.8 — histórico de notificações preservado por 90 dias.
    const notifications = await prisma.notification.findMany({
      where: {
        userId,
        tenantId,
      },
      select: {
        id: true,
        type: true,
        title: true,
        body: true,
        resourceType: true,
        resourceId: true,
        readAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    // ── 5. Buscar convites criados pelo usuário ──────────────────────────────
    // InvitationToken onde invitedById corresponde ao usuário exportado.
    const invitationsCreated = await prisma.invitationToken.findMany({
      where: {
        invitedById: userId,
        tenantId,
      },
      select: {
        id: true,
        email: true,
        role: true,
        expiresAt: true,
        usedAt: true,
        revokedAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    // ── 6. Montar estrutura de exportação ────────────────────────────────────
    const exportedAt = new Date().toISOString();

    const exportData: UserDataExport = {
      user,
      consents,
      auditLogs,
      notifications,
      invitationsCreated,
      exportedAt,
    };

    // ── 7. Serializar e retornar ─────────────────────────────────────────────
    // Requisito 13.3 — formato JSON padronizado, disponível em até 72h.
    const json = JSON.stringify(exportData, null, 2);

    return {
      json,
      meta: {
        userId,
        tenantId,
        exportedAt,
        recordCounts: {
          consents: consents.length,
          auditLogs: auditLogs.length,
          notifications: notifications.length,
          invitationsCreated: invitationsCreated.length,
        },
      },
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton
// ─────────────────────────────────────────────────────────────────────────────

/** Singleton para uso na camada de aplicação e nas rotas de API. */
export const exportUserDataUseCase = new ExportUserDataUseCase();
