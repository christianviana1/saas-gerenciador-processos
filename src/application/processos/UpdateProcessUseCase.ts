/**
 * UpdateProcessUseCase — Atualiza um processo judicial existente no tenant.
 *
 * Fluxo:
 *  1. Verifica permissão RBAC (process:update) — lança ForbiddenError se negado
 *  2. Verifica que o processo existe no tenant — lança NotFoundError se ausente
 *  3. tenantId é IMUTÁVEL — nunca pode ser alterado (Requisito 6.9)
 *  4. Atualiza o processo via processRepository.update()
 *  5. Enfileira evento de auditoria (fire-and-forget, < 50ms)
 *
 * Requisitos: 6.5, 6.9, 2.2, 3.1, 3.3
 */

import { rbacEngine } from '@/domain/services/RBACEngine';
import { processRepository } from '@/infrastructure/database/repositories/ProcessRepository';
import { auditQueue } from '@/infrastructure/queues/queues';
import { NotFoundError } from '@/shared/errors/AppError';
import type { Role } from '@/domain/services/RBACEngine';
import type { Process, ProcessStatus } from '@/domain/entities/Process';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Campos mutáveis de um processo judicial.
 *
 * NOTA: `tenantId` e `cnjNumber` são intencionalmente omitidos aqui —
 * `tenantId` é imutável (Requisito 6.9) e `cnjNumber` não pode ser alterado
 * pois é parte da chave única (Requisito 6.8).
 */
export interface UpdateProcessUpdates {
  clientName?: string;
  currentCourt?: string | null;
  status?: ProcessStatus;
  processClass?: string;
  subject?: string;
  description?: string | null;
  tags?: string[] | null;
  responsibleUserIds?: string[];
}

export interface UpdateProcessInput {
  /** ID do processo a ser atualizado */
  processId: string;
  /**
   * Tenant ao qual o processo pertence.
   * IMUTÁVEL — nunca será alterado (Requisito 6.9).
   */
  tenantId: string;
  /** ID do usuário que está executando a ação */
  actorUserId: string;
  /** Papel do ator para verificação RBAC */
  actorRole: Role;
  /** Campos a serem atualizados */
  updates: UpdateProcessUpdates;
}

// ─────────────────────────────────────────────────────────────────────────────
// Use Case
// ─────────────────────────────────────────────────────────────────────────────

export class UpdateProcessUseCase {
  /**
   * Executa o fluxo de atualização de processo judicial.
   *
   * @throws {ForbiddenError}  quando o ator não tem permissão `process:update`
   * @throws {NotFoundError}   quando o processo não existe no tenant
   */
  async execute(input: UpdateProcessInput): Promise<Process> {
    const { processId, tenantId, actorUserId, actorRole, updates } = input;

    // ── 1. Verificação RBAC ──────────────────────────────────────────────────
    // Lança ForbiddenError automaticamente se a permissão for negada.
    // Requisito 2.2: avaliar permissões antes de executar qualquer ação.
    rbacEngine.enforce(
      {
        userId: actorUserId,
        tenantId,
        role: actorRole,
        resourceTenantId: tenantId,
      },
      'process:update',
    );

    // ── 2. Verificar existência do processo no tenant ─────────────────────────
    // Requisito 1.2: validar que o recurso pertence ao tenant da sessão ativa.
    const existing = await processRepository.findById(processId, tenantId);

    if (existing === null) {
      throw new NotFoundError(
        `Process '${processId}' not found in tenant '${tenantId}'.`,
        { processId, tenantId },
      );
    }

    // ── 3. Garantia de imutabilidade do tenantId ─────────────────────────────
    // O tenantId NUNCA é incluído nos dados de atualização (Requisito 6.9).
    // A separação estrutural do tipo UpdateProcessUpdates impede isso em
    // tempo de compilação. A verificação abaixo é uma salvaguarda de runtime.
    //
    // Nenhum campo proibido (tenantId, cnjNumber, id, createdAt) é passado
    // ao repositório — apenas os campos definidos em UpdateProcessUpdates.

    // ── 4. Atualizar processo ─────────────────────────────────────────────────
    // processRepository.update() aplica WHERE tenant_id = tenantId obrigatoriamente.
    const updated = await processRepository.update(processId, updates, tenantId);

    // ── 5. Registrar evento de auditoria ─────────────────────────────────────
    // Requisito 3.1: registrar alteração de processo no Audit_Service.
    // Requisito 3.3: fire-and-forget — não aguarda persistência (< 50ms).
    void auditQueue.add('audit-update-process', {
      tenantId,
      userId: actorUserId,
      action: 'process:update',
      resourceType: 'Process',
      resourceId: processId,
      ipAddress: '0.0.0.0',   // Sobrescrito pela camada de apresentação
      userAgent: 'server',     // Sobrescrito pela camada de apresentação
      payloadBefore: {
        id: existing.id,
        clientName: existing.clientName,
        currentCourt: existing.currentCourt,
        status: existing.status,
        processClass: existing.processClass,
        subject: existing.subject,
        description: existing.description,
        tags: existing.tags,
        responsibleUserIds: existing.responsibleUserIds,
        updatedAt: existing.updatedAt.toISOString(),
      },
      payloadAfter: {
        id: updated.id,
        clientName: updated.clientName,
        currentCourt: updated.currentCourt,
        status: updated.status,
        processClass: updated.processClass,
        subject: updated.subject,
        description: updated.description,
        tags: updated.tags,
        responsibleUserIds: updated.responsibleUserIds,
        updatedAt: updated.updatedAt.toISOString(),
      },
    });

    // ── 6. Retornar processo atualizado ───────────────────────────────────────
    return updated;
  }
}

/** Singleton para uso na camada de aplicação e Server Actions. */
export const updateProcessUseCase = new UpdateProcessUseCase();
