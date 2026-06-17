/**
 * MoveTaskStatusUseCase — Move uma tarefa para um novo status no Kanban.
 *
 * Fluxo:
 *  1. Verifica permissão RBAC (task:update) — lança ForbiddenError se negado
 *  2. Delega ao taskRepository.moveStatus(), que valida a transição de status
 *     e insere registro imutável em TaskHistory de forma atômica (prisma.$transaction)
 *  3. Enfileira evento de auditoria (fire-and-forget)
 *
 * Requirements: 9.4, 9.9
 *
 * O taskRepository.moveStatus() já trata:
 *  - Validação da transição de status via isValidTaskTransition()
 *  - Inserção atômica do registro imutável em TaskHistory com campos:
 *    (taskId, fromStatus, toStatus, movedByUserId, movedAt)
 *  - Isolamento de tenant (WHERE tenant_id = tenantId)
 */

import { taskRepository } from '@/infrastructure/database/repositories/TaskRepository';
import { rbacEngine } from '@/domain/services/RBACEngine';
import { auditQueue } from '@/infrastructure/queues/queues';
import { TaskStatusEnum } from '@/domain/value-objects/TaskStatus';
import type { Role } from '@/domain/services/RBACEngine';
import type { Task, TaskStatus } from '@/domain/entities/Task';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface MoveTaskStatusInput {
  /** ID da tarefa a ser movida */
  taskId: string;
  /** Tenant proprietário da tarefa */
  tenantId: string;
  /** ID do usuário que está executando a ação */
  actorUserId: string;
  /** Papel do ator para verificação RBAC */
  actorRole: Role;
  /** Status de destino para a tarefa */
  toStatus: TaskStatusEnum;
}

// ─────────────────────────────────────────────────────────────────────────────
// Use Case
// ─────────────────────────────────────────────────────────────────────────────

export class MoveTaskStatusUseCase {
  /**
   * Executa o fluxo de movimentação de status de tarefa no Kanban.
   *
   * @throws {ForbiddenError}   quando o ator não tem permissão `task:update`
   * @throws {NotFoundError}    quando a tarefa não existe no tenant
   * @throws {ValidationError}  quando a transição de status não é permitida
   *
   * Requirement 9.4: registra movimentação em histórico imutável com campos
   *   task_id, from_status, to_status, moved_by_user_id, moved_at.
   * Requirement 9.9: histórico imutável preservado mesmo após exclusão lógica.
   */
  async execute(input: MoveTaskStatusInput): Promise<Task> {
    const { taskId, tenantId, actorUserId, actorRole, toStatus } = input;

    // ── 1. Verificação RBAC ──────────────────────────────────────────────────
    // Lança ForbiddenError automaticamente se a permissão for negada.
    // Requirement 2.2
    rbacEngine.enforce(
      {
        userId: actorUserId,
        tenantId,
        role: actorRole,
        resourceTenantId: tenantId,
      },
      'task:update',
    );

    // ── 2. Mover status via repositório ──────────────────────────────────────
    // O taskRepository.moveStatus() executa em prisma.$transaction:
    //   - Valida a transição de status (isValidTaskTransition)
    //   - Atualiza task.status para toStatus
    //   - Cria registro imutável em TaskHistory com fromStatus, toStatus,
    //     movedByUserId e movedAt (gerado automaticamente pelo banco)
    // Requirements 9.4, 9.9
    const updatedTask = await taskRepository.moveStatus(
      taskId,
      toStatus as unknown as TaskStatus,
      actorUserId,
      tenantId,
    );

    // ── 3. Registrar evento de auditoria (fire-and-forget) ───────────────────
    // Requirement 3.1: registrar alteração de tarefa no Audit_Service.
    // Requirement 3.3: latência adicional < 50ms — não aguardar.
    void auditQueue.add('audit-move-task-status', {
      tenantId,
      userId: actorUserId,
      action: 'task:update',
      resourceType: 'Task',
      resourceId: taskId,
      ipAddress: '0.0.0.0',  // Sobrescrito pela camada de apresentação
      userAgent: 'server',   // Sobrescrito pela camada de apresentação
      payloadAfter: {
        id: taskId,
        tenantId,
        status: toStatus,
        updatedAt: updatedTask.updatedAt.toISOString(),
      },
    }).catch((err: unknown) => {
      console.error('[MoveTaskStatusUseCase] Falha ao enfileirar evento de auditoria:', err);
    });

    // ── 4. Retornar tarefa atualizada ─────────────────────────────────────────
    return updatedTask;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton
// ─────────────────────────────────────────────────────────────────────────────

/** Singleton para uso na camada de aplicação e Server Actions. */
export const moveTaskStatusUseCase = new MoveTaskStatusUseCase();
