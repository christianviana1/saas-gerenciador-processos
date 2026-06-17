/**
 * CreateProcessUseCase — Cria um novo processo judicial no tenant.
 *
 * Fluxo:
 *  1. Verifica permissão RBAC (process:create) — lança ForbiddenError se negado
 *  2. Valida o número CNJ via CnjNumber.parse() — lança ValidationError se inválido
 *  3. Valida responsibleUserIds: pelo menos 1, todos devem ser usuários ativos no tenant
 *  4. Cria o processo via processRepository.create(data, tenantId) — tenantId imutável
 *  5. Enfileira job no datajudSyncQueue: { type: 'initial-sync', ... }
 *  6. Enfileira evento de auditoria (fire-and-forget)
 *
 * Requisitos: 6.1, 6.2, 6.3, 6.4, 6.8, 6.9
 */

import { rbacEngine } from '@/domain/services/RBACEngine';
import { CnjNumber } from '@/domain/value-objects/CnjNumber';
import { processRepository } from '@/infrastructure/database/repositories/ProcessRepository';
import { userRepository } from '@/infrastructure/database/repositories/UserRepository';
import { datajudSyncQueue, auditQueue } from '@/infrastructure/queues/queues';
import { ValidationError } from '@/shared/errors/AppError';
import type { Role } from '@/domain/services/RBACEngine';
import type { Process } from '@/domain/entities/Process';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateProcessInput {
  /** Número CNJ no formato NNNNNNN-DD.AAAA.J.TT.OOOO */
  cnjNumber: string;
  clientName: string;
  processClass: string;
  subject: string;
  /** Ao menos um usuário ativo do tenant */
  responsibleUserIds: string[];
  currentCourt?: string;
  description?: string;
  tags?: string[];
  /** Tenant proprietário do processo (imutável após criação) */
  tenantId: string;
  /** ID do usuário que está executando a ação */
  actorUserId: string;
  /** Papel do ator para verificação RBAC */
  actorRole: Role;
  /** Tenant do ator para verificação de isolamento cross-tenant */
  actorTenantId: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Use Case
// ─────────────────────────────────────────────────────────────────────────────

export class CreateProcessUseCase {
  /**
   * Executa o fluxo de criação de processo judicial.
   *
   * @throws {ForbiddenError}   quando o ator não tem permissão `process:create`
   * @throws {ValidationError}  quando o número CNJ é inválido
   * @throws {ValidationError}  quando responsibleUserIds está vazio ou contém
   *                            usuários inexistentes/inativos no tenant
   * @throws {ConflictError}    quando já existe um processo com o mesmo CNJ no tenant
   */
  async execute(input: CreateProcessInput): Promise<Process> {
    const {
      cnjNumber,
      clientName,
      processClass,
      subject,
      responsibleUserIds,
      currentCourt,
      description,
      tags,
      tenantId,
      actorUserId,
      actorRole,
      actorTenantId,
    } = input;

    // ── 1. Verificação RBAC ──────────────────────────────────────────────────
    // Lança ForbiddenError automaticamente se a permissão for negada.
    // Requirement 2.2
    rbacEngine.enforce(
      {
        userId: actorUserId,
        tenantId: actorTenantId,
        role: actorRole,
        resourceTenantId: tenantId,
      },
      'process:create',
    );

    // ── 2. Validação do número CNJ ───────────────────────────────────────────
    // CnjNumber.parse() lança ValidationError para formatos inválidos.
    // Requirement 6.1
    const parsedCnj = CnjNumber.parse(cnjNumber);

    // ── 3. Validação de responsibleUserIds ───────────────────────────────────
    // Pelo menos 1 ID deve ser fornecido e todos devem ser usuários ativos no tenant.
    // Requirement 6.5
    if (!Array.isArray(responsibleUserIds) || responsibleUserIds.length === 0) {
      throw new ValidationError(
        'At least one responsible user must be assigned to the process.',
        { field: 'responsibleUserIds' },
      );
    }

    // Verifica cada ID em paralelo para eficiência
    const userChecks = await Promise.all(
      responsibleUserIds.map((userId) => userRepository.findById(userId, tenantId)),
    );

    const invalidUserIds: string[] = [];
    for (let i = 0; i < responsibleUserIds.length; i++) {
      const user = userChecks[i];
      // Usuário inexistente no tenant ou inativo (status !== 'ACTIVE' ou deletedAt != null)
      if (user === null || user.status !== 'ACTIVE' || user.deletedAt !== null) {
        invalidUserIds.push(responsibleUserIds[i]);
      }
    }

    if (invalidUserIds.length > 0) {
      throw new ValidationError(
        `The following responsible user IDs are not active in this tenant: ${invalidUserIds.join(', ')}.`,
        { field: 'responsibleUserIds', invalidUserIds },
      );
    }

    // ── 4. Criar processo ────────────────────────────────────────────────────
    // processRepository.create() lança ConflictError se cnjNumber já existe no tenant.
    // tenantId é passado como parâmetro separado — é imutável após a criação.
    // Requirements 6.2, 6.3, 6.8, 6.9
    const process = await processRepository.create(
      {
        cnjNumber: parsedCnj.value,
        clientName,
        processClass,
        subject,
        responsibleUserIds,
        currentCourt,
        description,
        tags,
      },
      tenantId,
    );

    // ── 5. Enfileirar sincronização inicial com DataJud ───────────────────────
    // Requirement 6.4: descoberta do tribunal via DataJud de forma assíncrona,
    // sem bloquear a resposta de criação. Requirement 7.7.
    await datajudSyncQueue.add(
      'initial-sync',
      {
        type: 'initial-sync',
        processId: process.id,
        tenantId,
        cnjNumber: parsedCnj.value,
        triggerType: 'event',
      },
      {
        // Job ID único para evitar enfileiramento duplicado acidental
        jobId: `initial-sync:${process.id}`,
      },
    );

    // ── 6. Registrar evento de auditoria ─────────────────────────────────────
    // Requirement 3.1: registrar criação de processo no Audit_Service.
    // Requirement 3.3: fire-and-forget — não aguarda persistência (< 50ms).
    void auditQueue.add('audit-create-process', {
      tenantId,
      userId: actorUserId,
      action: 'process:create',
      resourceType: 'Process',
      resourceId: process.id,
      ipAddress: '0.0.0.0',  // Será sobrescrito pela camada de apresentação
      userAgent: 'server',    // Será sobrescrito pela camada de apresentação
      payloadAfter: {
        id: process.id,
        cnjNumber: parsedCnj.value,
        clientName,
        processClass,
        subject,
        tenantId,
        responsibleUserIds,
        createdAt: process.createdAt.toISOString(),
      },
    });

    // ── 7. Retornar processo criado ───────────────────────────────────────────
    return process;
  }
}

/** Singleton para uso na camada de aplicação e Server Actions. */
export const createProcessUseCase = new CreateProcessUseCase();
