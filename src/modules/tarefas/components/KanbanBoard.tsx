'use client';

/**
 * KanbanBoard — Quadro Kanban de tarefas jurídicas.
 *
 * Client Component: permite movimentação de tarefas entre colunas via botões ← →.
 * Exibe badge "Vencida" (vermelho) quando dueDate < now e status !== DONE.
 * Chama PATCH /api/tarefas/[id]/status para persistir movimentações.
 *
 * Requirements: 9.1, 9.5
 */

import { useState, useTransition } from 'react';
import Link from 'next/link';
import type { Task, TaskStatus, TaskPriority } from '@/domain/entities/Task';

// ─────────────────────────────────────────────────────────────────────────────
// Column definitions (order matters — used for prev/next navigation)
// ─────────────────────────────────────────────────────────────────────────────

type Column = {
  status: TaskStatus;
  label: string;
  headerClass: string;
};

const COLUMNS: Column[] = [
  { status: 'TODO',        label: 'A Fazer',      headerClass: 'bg-gray-100  border-gray-300' },
  { status: 'IN_PROGRESS', label: 'Em Andamento', headerClass: 'bg-blue-50   border-blue-300' },
  { status: 'REVIEW',      label: 'Revisão',      headerClass: 'bg-yellow-50 border-yellow-300' },
  { status: 'DONE',        label: 'Concluído',    headerClass: 'bg-green-50  border-green-300' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Priority badges
// ─────────────────────────────────────────────────────────────────────────────

const PRIORITY_LABEL: Record<TaskPriority, string> = {
  LOW:    'Baixa',
  MEDIUM: 'Média',
  HIGH:   'Alta',
  URGENT: 'Urgente',
};

const PRIORITY_CLASS: Record<TaskPriority, string> = {
  LOW:    'bg-gray-100 text-gray-600',
  MEDIUM: 'bg-blue-100 text-blue-700',
  HIGH:   'bg-orange-100 text-orange-700',
  URGENT: 'bg-red-100 text-red-700 font-semibold',
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function isOverdue(task: Pick<Task, 'dueDate' | 'status'>): boolean {
  if (!task.dueDate || task.status === 'DONE') return false;
  return new Date(task.dueDate).getTime() < Date.now();
}

function formatDate(date: Date | null): string | null {
  if (!date) return null;
  return new Date(date).toLocaleDateString('pt-BR', {
    day:   '2-digit',
    month: '2-digit',
    year:  'numeric',
  });
}

/** Index of this status in COLUMNS (0-based). */
function colIndex(status: TaskStatus): number {
  return COLUMNS.findIndex((c) => c.status === status);
}

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

export interface GroupedTasks {
  TODO:        Task[];
  IN_PROGRESS: Task[];
  REVIEW:      Task[];
  DONE:        Task[];
}

interface KanbanBoardProps {
  initialTasks: GroupedTasks;
}

// ─────────────────────────────────────────────────────────────────────────────
// Task Card
// ─────────────────────────────────────────────────────────────────────────────

interface TaskCardProps {
  task: Task;
  canMovePrev: boolean;
  canMoveNext: boolean;
  onMove: (taskId: string, toStatus: TaskStatus) => void;
  isPending: boolean;
}

function TaskCard({ task, canMovePrev, canMoveNext, onMove, isPending }: TaskCardProps) {
  const overdue = isOverdue(task);
  const idx     = colIndex(task.status);

  const prevStatus = idx > 0 ? COLUMNS[idx - 1].status : null;
  const nextStatus = idx < COLUMNS.length - 1 ? COLUMNS[idx + 1].status : null;

  return (
    <article
      className={`bg-white rounded-lg border shadow-sm p-3 flex flex-col gap-2 transition-opacity ${
        isPending ? 'opacity-60' : 'opacity-100'
      }`}
      aria-label={`Tarefa: ${task.title}`}
    >
      {/* Title */}
      <p className="text-sm font-medium text-gray-900 leading-snug">{task.title}</p>

      {/* Badges row */}
      <div className="flex flex-wrap items-center gap-1.5">
        {/* Priority badge */}
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs ${
            PRIORITY_CLASS[task.priority]
          }`}
        >
          {PRIORITY_LABEL[task.priority]}
        </span>

        {/* Overdue badge */}
        {overdue && (
          <span
            className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-red-100 text-red-700 font-semibold"
            aria-label="Tarefa vencida"
          >
            Vencida
          </span>
        )}
      </div>

      {/* Meta: assignee + due date */}
      <div className="flex flex-col gap-0.5 text-xs text-gray-500">
        {task.assigneeUserId && (
          <span>
            Responsável:{' '}
            <span className="text-gray-700 font-medium truncate">{task.assigneeUserId}</span>
          </span>
        )}
        {task.dueDate && (
          <span className={overdue ? 'text-red-600 font-medium' : ''}>
            Prazo: {formatDate(task.dueDate)}
          </span>
        )}
      </div>

      {/* Move buttons */}
      {(canMovePrev || canMoveNext) && (
        <div className="flex items-center justify-between gap-1 pt-1 border-t border-gray-100 mt-auto">
          <button
            type="button"
            disabled={!canMovePrev || isPending}
            onClick={() => prevStatus && onMove(task.id, prevStatus)}
            className="flex-1 inline-flex items-center justify-center gap-1 py-1 px-2 text-xs rounded border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400"
            aria-label={`Mover para ${prevStatus ? COLUMNS[idx - 1].label : ''}`}
          >
            ← {prevStatus ? COLUMNS[idx - 1].label : ''}
          </button>
          <button
            type="button"
            disabled={!canMoveNext || isPending}
            onClick={() => nextStatus && onMove(task.id, nextStatus)}
            className="flex-1 inline-flex items-center justify-center gap-1 py-1 px-2 text-xs rounded border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400"
            aria-label={`Mover para ${nextStatus ? COLUMNS[idx + 1].label : ''}`}
          >
            {nextStatus ? COLUMNS[idx + 1].label : ''} →
          </button>
        </div>
      )}
    </article>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

export function KanbanBoard({ initialTasks }: KanbanBoardProps) {
  const [tasks, setTasks]       = useState<GroupedTasks>(initialTasks);
  const [error, setError]       = useState<string | null>(null);
  const [pending, setPending]   = useState<Set<string>>(new Set());
  const [, startTransition]     = useTransition();

  /**
   * Move a task to a new status:
   * 1. Optimistically update local state
   * 2. Call PATCH /api/tarefas/[id]/status
   * 3. Roll back on error
   */
  async function handleMove(taskId: string, toStatus: TaskStatus) {
    setError(null);

    // Find the task in current state
    let foundTask: Task | undefined;
    let fromStatus: TaskStatus | undefined;

    for (const col of COLUMNS) {
      const t = tasks[col.status].find((t) => t.id === taskId);
      if (t) {
        foundTask  = t;
        fromStatus = col.status;
        break;
      }
    }

    if (!foundTask || !fromStatus) return;

    const snapshot = { ...tasks };

    // Optimistic update
    startTransition(() => {
      setTasks((prev) => {
        const fromCol = prev[fromStatus!].filter((t) => t.id !== taskId);
        const toCol   = [...prev[toStatus], { ...foundTask!, status: toStatus }];
        return { ...prev, [fromStatus!]: fromCol, [toStatus]: toCol };
      });
    });

    setPending((prev) => new Set(prev).add(taskId));

    try {
      const res = await fetch(`/api/tarefas/${taskId}/status`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ toStatus }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { message?: string }).message ?? `Erro ao mover tarefa (${res.status})`,
        );
      }
    } catch (err) {
      // Roll back optimistic update
      setTasks(snapshot);
      setError(err instanceof Error ? err.message : 'Erro inesperado ao mover tarefa.');
    } finally {
      setPending((prev) => {
        const next = new Set(prev);
        next.delete(taskId);
        return next;
      });
    }
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tarefas</h1>
          <p className="text-sm text-gray-500 mt-1">
            {COLUMNS.reduce((acc, col) => acc + tasks[col.status].length, 0)} tarefa
            {COLUMNS.reduce((acc, col) => acc + tasks[col.status].length, 0) !== 1 ? 's' : ''} no total
          </p>
        </div>
        <Link
          href="/tarefas/nova"
          className="inline-flex items-center px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          + Nova Tarefa
        </Link>
      </div>

      {/* Error banner */}
      {error && (
        <div
          role="alert"
          className="mb-4 flex items-start gap-2 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700"
        >
          <span aria-hidden="true">⚠</span>
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="ml-auto text-red-500 hover:text-red-700 focus:outline-none"
            aria-label="Fechar mensagem de erro"
          >
            ✕
          </button>
        </div>
      )}

      {/* Kanban columns */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {COLUMNS.map((col, colIdx) => {
          const colTasks = tasks[col.status];
          return (
            <section
              key={col.status}
              aria-label={`Coluna ${col.label}`}
              className="flex flex-col min-h-[200px]"
            >
              {/* Column header */}
              <div
                className={`flex items-center justify-between px-3 py-2 rounded-t-lg border ${col.headerClass}`}
              >
                <h2 className="text-sm font-semibold text-gray-700">{col.label}</h2>
                <span
                  className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-white text-xs font-bold text-gray-600 border border-gray-300"
                  aria-label={`${colTasks.length} tarefas`}
                >
                  {colTasks.length}
                </span>
              </div>

              {/* Task cards */}
              <div
                className={`flex-1 rounded-b-lg border-x border-b p-2 flex flex-col gap-2 ${col.headerClass}`}
              >
                {colTasks.length === 0 ? (
                  <p className="text-xs text-gray-400 italic text-center py-4">
                    Nenhuma tarefa
                  </p>
                ) : (
                  colTasks.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      canMovePrev={colIdx > 0}
                      canMoveNext={colIdx < COLUMNS.length - 1}
                      onMove={handleMove}
                      isPending={pending.has(task.id)}
                    />
                  ))
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
