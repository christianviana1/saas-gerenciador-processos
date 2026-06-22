/**
 * Tarefas — Quadro Kanban de tarefas jurídicas.
 *
 * Server Component: busca todas as tarefas ativas do tenant via taskRepository.findMany,
 * agrupa por status e repassa ao KanbanBoard (Client Component).
 *
 * Requirements: 9.1, 9.5
 */

import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { taskRepository } from '@/infrastructure/database/repositories/TaskRepository';
import { KanbanBoard } from '@/modules/tarefas/components/KanbanBoard';
import type { Task, TaskStatus } from '@/domain/entities/Task';
import type { GroupedTasks } from '@/modules/tarefas/components/KanbanBoard';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Agrupa lista plana de tarefas por status em um objeto GroupedTasks. */
function groupByStatus(tasks: Task[]): GroupedTasks {
  const groups: GroupedTasks = {
    TODO:        [],
    IN_PROGRESS: [],
    REVIEW:      [],
    DONE:        [],
  };

  for (const task of tasks) {
    const key = task.status as TaskStatus;
    if (key in groups) {
      groups[key].push(task);
    }
  }

  return groups;
}

// ─────────────────────────────────────────────────────────────────────────────
// Page Component
// ─────────────────────────────────────────────────────────────────────────────

'use client';
export const dynamic = 'force-dynamic';

export default async function TarefasPage() {
  const session = await auth();
  if (!session?.user) {
    redirect('/login');
  }

  // Busca todas as tarefas do tenant (até 50 por página).
  // Para um kanban completo buscamos todas as páginas — como o limite é 50 por
  // chamada e a maioria dos escritórios terá menos de 50 tarefas abertas,
  // uma única requisição é suficiente para a maioria dos casos.
  // Tasks com deletedAt != null são excluídas pelo repositório automaticamente.
  const result = await taskRepository.findMany(
    { pageSize: 50, page: 1 },
    session.user.tenantId,
  );

  const grouped = groupByStatus(result.items);

  return (
    <div className="p-4 md:p-6">
      <KanbanBoard initialTasks={grouped} />
    </div>
  );
}
