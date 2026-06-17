/**
 * Processo — Página de detalhes de um processo judicial.
 *
 * Server Component: carrega o processo via Prisma com histórico de tribunais
 * em ordem cronológica decrescente e tarefas vinculadas ao processo.
 *
 * Exibe indicador de desatualização quando lastDatajudSyncAt > 48h ou null.
 *
 * Requirements: 6.6, 7.8, 8.4
 */

import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/auth';
import { prisma } from '@/infrastructure/database/prisma/client';
import { isDatajudSyncStale } from '@/domain/entities/Process';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  ACTIVE:   'Ativo',
  ARCHIVED: 'Arquivado',
  DELETED:  'Excluído',
};

const STATUS_BADGE: Record<string, string> = {
  ACTIVE:   'bg-green-100 text-green-800',
  ARCHIVED: 'bg-gray-100 text-gray-700',
  DELETED:  'bg-red-100 text-red-800',
};

const TASK_STATUS_LABELS: Record<string, string> = {
  TODO:        'A Fazer',
  IN_PROGRESS: 'Em Andamento',
  REVIEW:      'Revisão',
  DONE:        'Concluído',
};

const TASK_STATUS_BADGE: Record<string, string> = {
  TODO:        'bg-gray-100 text-gray-700',
  IN_PROGRESS: 'bg-blue-100 text-blue-800',
  REVIEW:      'bg-yellow-100 text-yellow-800',
  DONE:        'bg-green-100 text-green-800',
};

const TASK_PRIORITY_LABELS: Record<string, string> = {
  LOW:    'Baixa',
  MEDIUM: 'Média',
  HIGH:   'Alta',
  URGENT: 'Urgente',
};

const TASK_PRIORITY_BADGE: Record<string, string> = {
  LOW:    'bg-gray-100 text-gray-600',
  MEDIUM: 'bg-blue-100 text-blue-700',
  HIGH:   'bg-orange-100 text-orange-700',
  URGENT: 'bg-red-100 text-red-700',
};

// ─────────────────────────────────────────────────────────────────────────────
// Page Component
// ─────────────────────────────────────────────────────────────────────────────

export default async function ProcessoDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect('/login');
  }

  const { id } = await params;

  // Carrega o processo scoped ao tenant da sessão
  const processo = await prisma.process.findFirst({
    where: {
      id,
      tenantId: session.user.tenantId,
      deletedAt: null,
    },
  });

  if (!processo) {
    notFound();
  }

  // Histórico de tribunais em ordem cronológica decrescente (Requirement 8.4)
  const courtHistory = await prisma.courtHistory.findMany({
    where: {
      processId: processo.id,
      tenantId: session.user.tenantId,
    },
    orderBy: { changedAt: 'desc' },
    include: {
      changedByUser: {
        select: { id: true, name: true, email: true },
      },
    },
  });

  // Tarefas vinculadas ao processo
  const tasks = await prisma.task.findMany({
    where: {
      processId: processo.id,
      tenantId: session.user.tenantId,
      deletedAt: null,
    },
    orderBy: [{ status: 'asc' }, { dueDate: 'asc' }],
    include: {
      assignee: {
        select: { id: true, name: true, email: true },
      },
    },
  });

  const stale = isDatajudSyncStale(processo as { lastDatajudSyncAt: Date | null });
  const responsibleIds: string[] = Array.isArray(processo.responsibleUserIds)
    ? (processo.responsibleUserIds as string[])
    : [];

  return (
    <div className="space-y-8">
      {/* Breadcrumb */}
      <nav className="text-sm text-gray-500" aria-label="Breadcrumb">
        <Link href="/processos" className="hover:text-gray-700">
          Processos
        </Link>
        <span className="mx-2" aria-hidden="true">/</span>
        <span className="text-gray-900 font-medium font-mono">
          {processo.cnjNumber}
        </span>
      </nav>

      {/* Cabeçalho */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 font-mono">
            {processo.cnjNumber}
          </h1>
          <p className="text-base text-gray-600 mt-1">{processo.clientName}</p>
        </div>
        <div className="flex items-center gap-3">
          {stale && (
            <span
              className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-yellow-100 text-yellow-800"
              title="Última sincronização há mais de 48 horas"
            >
              ⚠ Desatualizado
            </span>
          )}
          <span
            className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
              STATUS_BADGE[processo.status] ?? 'bg-gray-100 text-gray-700'
            }`}
          >
            {STATUS_LABELS[processo.status] ?? processo.status}
          </span>
        </div>
      </div>

      {/* Informações gerais */}
      <section aria-labelledby="info-heading">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2
            id="info-heading"
            className="text-lg font-semibold text-gray-900 mb-4"
          >
            Informações do processo
          </h2>
          <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-4">
            <div>
              <dt className="text-xs font-medium text-gray-500 uppercase">
                Número CNJ
              </dt>
              <dd className="mt-1 text-sm text-gray-900 font-mono">
                {processo.cnjNumber}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-gray-500 uppercase">
                Cliente
              </dt>
              <dd className="mt-1 text-sm text-gray-900">{processo.clientName}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-gray-500 uppercase">
                Classe processual
              </dt>
              <dd className="mt-1 text-sm text-gray-900">{processo.processClass}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-gray-500 uppercase">
                Assunto
              </dt>
              <dd className="mt-1 text-sm text-gray-900">{processo.subject}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-gray-500 uppercase">
                Tribunal atual
              </dt>
              <dd className="mt-1 text-sm text-gray-900">
                {processo.currentCourt ?? (
                  <span className="text-gray-400 italic">
                    Aguardando sincronização DataJud
                  </span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-gray-500 uppercase">
                Última sincronização DataJud
              </dt>
              <dd className="mt-1 text-sm text-gray-900">
                <div className="flex items-center gap-2">
                  {stale && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                      Desatualizado
                    </span>
                  )}
                  <span>
                    {processo.lastDatajudSyncAt
                      ? new Date(processo.lastDatajudSyncAt).toLocaleString('pt-BR')
                      : '—'}
                  </span>
                </div>
              </dd>
            </div>
            {processo.description && (
              <div className="sm:col-span-2 lg:col-span-3">
                <dt className="text-xs font-medium text-gray-500 uppercase">
                  Descrição
                </dt>
                <dd className="mt-1 text-sm text-gray-900 whitespace-pre-wrap">
                  {processo.description}
                </dd>
              </div>
            )}
            {Array.isArray(processo.tags) && (processo.tags as string[]).length > 0 && (
              <div className="sm:col-span-2 lg:col-span-3">
                <dt className="text-xs font-medium text-gray-500 uppercase">
                  Tags
                </dt>
                <dd className="mt-1 flex flex-wrap gap-1">
                  {(processo.tags as string[]).map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700"
                    >
                      {tag}
                    </span>
                  ))}
                </dd>
              </div>
            )}
            {responsibleIds.length > 0 && (
              <div className="sm:col-span-2 lg:col-span-3">
                <dt className="text-xs font-medium text-gray-500 uppercase">
                  Responsáveis
                </dt>
                <dd className="mt-1 text-sm text-gray-900">
                  {responsibleIds.join(', ')}
                </dd>
              </div>
            )}
            <div>
              <dt className="text-xs font-medium text-gray-500 uppercase">
                Criado em
              </dt>
              <dd className="mt-1 text-sm text-gray-900">
                {new Date(processo.createdAt).toLocaleString('pt-BR')}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-gray-500 uppercase">
                Atualizado em
              </dt>
              <dd className="mt-1 text-sm text-gray-900">
                {new Date(processo.updatedAt).toLocaleString('pt-BR')}
              </dd>
            </div>
          </dl>
        </div>
      </section>

      {/* Histórico de Tribunais (Requirement 8.4 — ordem cronológica decrescente) */}
      <section aria-labelledby="court-history-heading">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2
              id="court-history-heading"
              className="text-lg font-semibold text-gray-900"
            >
              Histórico de Tribunais ({courtHistory.length})
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Exibido em ordem cronológica decrescente — mais recente primeiro
            </p>
          </div>

          {courtHistory.length === 0 ? (
            <div className="px-6 py-8 text-center text-sm text-gray-500">
              Nenhuma movimentação de tribunal registrada ainda.
            </div>
          ) : (
            <ol className="divide-y divide-gray-100" aria-label="Histórico de tribunais">
              {courtHistory.map((entry, idx) => (
                <li key={entry.id} className="px-6 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {/* Badge de posição (mais recente primeiro) */}
                        {idx === 0 && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                            Atual
                          </span>
                        )}
                        <span className="text-sm font-medium text-gray-900 truncate">
                          {entry.newCourt}
                        </span>
                      </div>
                      {entry.previousCourt && (
                        <p className="mt-1 text-xs text-gray-500">
                          Anterior:{' '}
                          <span className="text-gray-700">{entry.previousCourt}</span>
                        </p>
                      )}
                      {entry.changeReason && (
                        <p className="mt-1 text-xs text-gray-500">
                          Motivo:{' '}
                          <span className="text-gray-700">{entry.changeReason}</span>
                        </p>
                      )}
                      {entry.changedByUser && (
                        <p className="mt-1 text-xs text-gray-500">
                          Alterado por:{' '}
                          <span className="text-gray-700">
                            {entry.changedByUser.name}
                          </span>
                        </p>
                      )}
                    </div>
                    <time
                      dateTime={new Date(entry.changedAt).toISOString()}
                      className="flex-shrink-0 text-xs text-gray-400 whitespace-nowrap"
                    >
                      {new Date(entry.changedAt).toLocaleString('pt-BR')}
                    </time>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>

      {/* Tarefas vinculadas */}
      <section aria-labelledby="tasks-heading">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
            <h2
              id="tasks-heading"
              className="text-lg font-semibold text-gray-900"
            >
              Tarefas ({tasks.length})
            </h2>
          </div>

          {tasks.length === 0 ? (
            <div className="px-6 py-8 text-center text-sm text-gray-500">
              Nenhuma tarefa vinculada a este processo.
            </div>
          ) : (
            <ul className="divide-y divide-gray-100" aria-label="Tarefas do processo">
              {tasks.map((task) => {
                const isOverdue =
                  task.dueDate !== null &&
                  task.status !== 'DONE' &&
                  new Date(task.dueDate) < new Date();
                return (
                  <li key={task.id} className="px-6 py-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                              TASK_STATUS_BADGE[task.status] ?? 'bg-gray-100 text-gray-700'
                            }`}
                          >
                            {TASK_STATUS_LABELS[task.status] ?? task.status}
                          </span>
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                              TASK_PRIORITY_BADGE[task.priority] ?? 'bg-gray-100 text-gray-600'
                            }`}
                          >
                            {TASK_PRIORITY_LABELS[task.priority] ?? task.priority}
                          </span>
                          {isOverdue && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                              Vencida
                            </span>
                          )}
                          <span className="text-sm font-medium text-gray-900 truncate">
                            {task.title}
                          </span>
                        </div>
                        {task.assignee && (
                          <p className="mt-1 text-xs text-gray-500">
                            Responsável:{' '}
                            <span className="text-gray-700">{task.assignee.name}</span>
                          </p>
                        )}
                        {task.dueDate && (
                          <p className="mt-1 text-xs text-gray-500">
                            Prazo:{' '}
                            <time
                              dateTime={new Date(task.dueDate).toISOString()}
                              className={isOverdue ? 'text-red-700 font-medium' : 'text-gray-700'}
                            >
                              {new Date(task.dueDate).toLocaleDateString('pt-BR')}
                            </time>
                          </p>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      {/* Rodapé — link de volta */}
      <div>
        <Link
          href="/processos"
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          ← Voltar à lista de processos
        </Link>
      </div>
    </div>
  );
}
