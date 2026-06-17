/**
 * CreateTaskUseCase — Cria uma nova tarefa jurídica no tenant.
 *
 * Fluxo:
 *  1. Verifica permissão RBAC (task:create) — lança ForbiddenError se negado
 *  2. Se assigneeUserId fornecido: valida que o usuário existe e está ATIVO no tenant
 *  3. Se processId fornecido: valida que o processo existe no tenant
 *  4. Cria a tarefa diretamente via Prisma (tenantId obrigatório e imutável)
 *  5. Se priority === 'URGENT' && dueDate <= now + 24h: enfileira notificação imediata
 *  6. Enfileira evento de auditoria (fire-and-forget)
 *
 * Requisitos: 9.2, 9.3, 9.6
 */

import { prisma } from '@/infrastructure/database/prisma/client';
import { rbacEngine } from '@/domain/services/RBACEngine';
import { notificationsQueue, auditQueue } from '@/infrastructure/queues/queues';
import { ValidationError, NotFoundError } from '@/shared/errors/AppError';
import { requiresImmediateNotification } from '@/domain/entities/Task';
import type { Role } from '@/domain/services/RBACEngine';
import type { Task } from '@/domain/entities/Task';
import type { TaskPriority, TaskStatus } from '@/domain/entities/Task';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateTaskInput {
  /** Tenant proprietário da tarefa (obrigatório e imutável após criação) */
  tenantId: string;
  /** ID do usuário que está executando a ação */
  actorUserId: string;
  /** Papel do ator para verificação RBAC */
  actorRole: Role;
  /** Título da tarefa */
  title: string;
  /** Descrição opcional */
  description?: string;
  /** Prioridade da tarefa — padrão MEDIUM */
  priority: TaskPriority;
  /** Usuário responsável pela tarefa (opcional) */
  assigneeUserId?: string;
  /** Data limite para conclusão (opcional) */
  dueDate?: Date;
  /** Processo judicial ao qual a tarefa pertence (opcional) */
  processId?: string;
  /** Usuário que criou a tarefa (pode diferir do ator em integrações) */
  createdByUserId: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Use Case
// ─────────────────────────────────────────────────────────────────────────────

export class CreateTaskUseCase {
  /**
   * Executa o fluxo de criação de tarefa jurídica.
   *
   * @throws {ForbiddenError}   quando o ator não tem permissão `task:create`
   * @throws {ValidationError}  quando assigneeUserId não existe ou está inativo no tenant
   * @throws {NotFoundError}    quando processId é fornecido mas não existe no tenant
   */
  async execute(input: CreateTaskInput): Promise<Task> {
    const {
      tenantId,
      actorUserId,
      actorRole,
      title,
      description,
      priority,
      assigneeUserId,
      dueDate,
      processId,
      createdByUserId,
    } = input;

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
      'task:create',
    );

    // ── 2. Validar assigneeUserId ────────────────────────────────────────────
    // Se fornecido, o usuário deve existir e estar ATIVO no tenant.
    // Requirement 9.2 — campo assignee_user_id deve referenciar usuário válido.
    if (assigneeUserId !== undefined) {
      const assignee = await prisma.user.findFirst({
        where: {
          id: assigneeUserId,
          tenantId,
          deletedAt: null,
        },
        select: { id: true, status: true },
      });

      if (assignee === null) {
        throw new ValidationError(
          `O usuário responsável (assigneeUserId: "${assigneeUserId}") não foi encontrado neste tenant.`,
          { field: 'assigneeUserId', assigneeUserId },
        );
      }

      if (assignee.status !== 'ACTIVE') {
        throw new ValidationError(
          `O usuário responsável (assigneeUserId: "${assigneeUserId}") está inativo no tenant.`,
          { field: 'assigneeUserId', assigneeUserId, status: assignee.status },
        );
      }
    }

    // ── 3. Validar processId ─────────────────────────────────────────────────
    // Se fornecido, o processo deve existir no tenant (sem soft-delete).
    // Requirement 1.2 — isolamento de dados por tenant.
    if (processId !== undefined) {
      const process = await prisma.process.findFirst({
        where: {
          id: processId,
          tenantId,
          deletedAt: null,
        },
        select: { id: true },
      });

      if (process === null) {
        throw new NotFoundError(
          `O processo (processId: "${processId}") não foi encontrado neste tenant.`,
          { field: 'processId', processId },
        );
      }
    }

    // ── 4. Criar tarefa via Prisma ───────────────────────────────────────────
    // tenantId é passado diretamente — é imutável após criação.
    // Status padrão: TODO (Requirement 9.1).
    // Requirements 9.2, 9.3
    const prismaTask = await prisma.task.create({
      data: {
        tenantId,
        title,
        description: description ?? null,
        priority,
        assigneeUserId: assigneeUserId ?? null,
        dueDate: dueDate ?? null,
        processId: processId ?? null,
        status: 'TODO',
        createdByUserId,
      },
    });

    // Mapeia para o tipo de domínio Task
    const task: Task = {
      id: prismaTask.id,
      tenantId: prismaTask.tenantId,
      processId: prismaTask.processId,
      title: prismaTask.title,
      description: prismaTask.description,
      priority: prismaTask.priority as TaskPriority,
      assigneeUserId: prismaTask.assigneeUserId,
      dueDate: prismaTask.dueDate,
      status: prismaTask.status as TaskStatus,
      createdByUserId: prismaTask.createdByUserId,
      createdAt: prismaTask.createdAt,
      updatedAt: prismaTask.updatedAt,
      deletedAt: prismaTask.deletedAt,
    };

    // ── 5. Notificação imediata para tarefas URGENTES ────────────────────────
    // Se priority === 'URGENT' e dueDate estiver nos próximos 24h,
    // enfileirar notificação para o assignee imediatamente.
    // Requirement 9.6
    if (assigneeUserId !== undefined && requiresImmediateNotification(task)) {
      // Cria um registro de notificação no banco antes de enfileirar o job,
      // pois NotificationJob exige um notificationId persistido.
      // Requirement 10.8: notificações In-App retidas por 90 dias.
      const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
      const notification = await prisma.notification.create({
        data: {
          tenantId,
          userId: assigneeUserId,
          type: 'TASK_ASSIGNED',
          title: `Tarefa urgente atribuída: ${title}`,
          body: dueDate
            ? `A tarefa "${title}" vence em ${dueDate.toLocaleString('pt-BR')}.`
            : `A tarefa "${title}" foi marcada como urgente.`,
          resourceType: 'Task',
          resourceId: task.id,
          expiresAt,
        },
        select: { id: true },
      });

      void notificationsQueue.add(
        'urgent-task-notification',
        {
          notificationId: notification.id,
          userId: assigneeUserId,
          tenantId,
          type: 'TASK_ASSIGNED',
          channels: ['in-app', 'email', 'push'],
        },
      ).catch((err: unknown) => {
        console.error('[CreateTaskUseCase] Falha ao enfileirar notificação urgente:', err);
      });
    }

    // ── 6. Registrar evento de auditoria (fire-and-forget) ───────────────────
    // Requirement 3.1: registrar criação de tarefa no Audit_Service.
    // Requirement 3.3: latência adicional < 50ms — não aguardar.
    void auditQueue.add('audit-create-task', {
      tenantId,
      userId: actorUserId,
      action: 'task:create',
      resourceType: 'Task',
      resourceId: task.id,
      ipAddress: '0.0.0.0',  // Sobrescrito pela camada de apresentação
      userAgent: 'server',   // Sobrescrito pela camada de apresentação
      payloadAfter: {
        id: task.id,
        tenantId,
        processId: task.processId,
        title,
        priority,
        assigneeUserId: task.assigneeUserId,
        dueDate: task.dueDate?.toISOString() ?? null,
        status: task.status,
        createdByUserId,
        createdAt: task.createdAt.toISOString(),
      },
    }).catch((err: unknown) => {
      console.error('[CreateTaskUseCase] Falha ao enfileirar evento de auditoria:', err);
    });

    // ── 7. Retornar tarefa criada ─────────────────────────────────────────────
    return task;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton
// ─────────────────────────────────────────────────────────────────────────────

/** Singleton para uso na camada de aplicação e Server Actions. */
export const createTaskUseCase = new CreateTaskUseCase();
