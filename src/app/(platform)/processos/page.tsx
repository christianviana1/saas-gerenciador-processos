/**
 * Processos — Listagem paginada de processos judiciais.
 *
 * Server Component: busca dados diretamente via processRepository.
 * Suporta filtros por status e texto de busca, paginação de 20 por página.
 * Exibe badge "Desatualizado" (amarelo) quando lastDatajudSyncAt é null ou > 48h.
 *
 * Requirements: 6.6, 7.8
 */

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/auth';
import { processRepository } from '@/infrastructure/database/repositories/ProcessRepository';
import { isDatajudSyncStale } from '@/domain/entities/Process';
import type { ProcessStatus } from '@/domain/entities/Process';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const PAGE_SIZE = 20;

const STATUS_LABELS: Record<ProcessStatus, string> = {
  ACTIVE:   'Ativo',
  ARCHIVED: 'Arquivado',
  DELETED:  'Excluído',
};

const STATUS_BADGE: Record<ProcessStatus, string> = {
  ACTIVE:   'bg-green-100 text-green-800',
  ARCHIVED: 'bg-gray-100 text-gray-700',
  DELETED:  'bg-red-100 text-red-800',
};

// ─────────────────────────────────────────────────────────────────────────────
// Page Component
// ─────────────────────────────────────────────────────────────────────────────

'use client';
export const dynamic = 'force-dynamic';

export default async function ProcessosPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    status?: string;
    search?: string;
  }>;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect('/login');
  }

  const params = await searchParams;
  const page   = Math.max(1, Number(params.page ?? 1));
  const status = params.status as ProcessStatus | undefined;
  const search = params.search?.trim() || undefined;

  // Busca paginada com filtros, escopo do tenant da sessão
  const result = await processRepository.findMany(
    {
      status:   status && ['ACTIVE', 'ARCHIVED', 'DELETED'].includes(status) ? status : undefined,
      search,
      page,
      pageSize: PAGE_SIZE,
    },
    session.user.tenantId,
  );

  const totalPages = Math.ceil(result.total / PAGE_SIZE);

  // Helper para construir query string mantendo os filtros ativos
  function buildUrl(overrides: Record<string, string | undefined>) {
    const qs = new URLSearchParams();
    const merged = { page: String(page), status, search, ...overrides };
    for (const [k, v] of Object.entries(merged)) {
      if (v) qs.set(k, v);
    }
    return `/processos?${qs.toString()}`;
  }

  return (
    <div>
      {/* Cabeçalho */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Processos</h1>
          <p className="text-sm text-gray-500 mt-1">
            {result.total} processo{result.total !== 1 ? 's' : ''} encontrado{result.total !== 1 ? 's' : ''}
          </p>
        </div>
        <Link
          href="/processos/novo"
          className="inline-flex items-center px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          + Novo Processo
        </Link>
      </div>

      {/* Barra de filtros */}
      <form method="GET" action="/processos" className="flex flex-wrap gap-3 mb-6">
        {/* Busca por texto */}
        <div className="flex-1 min-w-[200px]">
          <label htmlFor="search" className="sr-only">
            Buscar processo
          </label>
          <input
            id="search"
            name="search"
            type="search"
            defaultValue={search ?? ''}
            placeholder="Buscar por número CNJ, cliente ou assunto…"
            className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        {/* Filtro de status */}
        <div>
          <label htmlFor="status" className="sr-only">
            Status
          </label>
          <select
            id="status"
            name="status"
            defaultValue={status ?? ''}
            className="block rounded-md border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="">Todos os status</option>
            <option value="ACTIVE">Ativo</option>
            <option value="ARCHIVED">Arquivado</option>
          </select>
        </div>

        {/* Botão de aplicar filtros */}
        <button
          type="submit"
          className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-md hover:bg-gray-800 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
        >
          Filtrar
        </button>

        {/* Limpar filtros */}
        {(search || status) && (
          <Link
            href="/processos"
            className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-50 transition-colors"
          >
            Limpar
          </Link>
        )}
      </form>

      {/* Tabela de processos */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th
                  scope="col"
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                >
                  Número CNJ
                </th>
                <th
                  scope="col"
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                >
                  Cliente
                </th>
                <th
                  scope="col"
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                >
                  Tribunal atual
                </th>
                <th
                  scope="col"
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                >
                  Status
                </th>
                <th
                  scope="col"
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                >
                  Última sincronização
                </th>
                <th
                  scope="col"
                  className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider"
                >
                  Ações
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-100">
              {result.items.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-6 py-12 text-center text-sm text-gray-500"
                  >
                    Nenhum processo encontrado.{' '}
                    <Link
                      href="/processos/novo"
                      className="text-blue-600 hover:text-blue-800 font-medium"
                    >
                      Cadastrar novo processo
                    </Link>
                  </td>
                </tr>
              ) : (
                result.items.map((processo) => {
                  const stale = isDatajudSyncStale(processo);
                  return (
                    <tr
                      key={processo.id}
                      className="hover:bg-gray-50 transition-colors"
                    >
                      {/* CNJ */}
                      <td className="px-6 py-4">
                        <span className="font-mono text-sm text-gray-900">
                          {processo.cnjNumber}
                        </span>
                      </td>

                      {/* Cliente */}
                      <td className="px-6 py-4">
                        <div className="text-sm font-medium text-gray-900">
                          {processo.clientName}
                        </div>
                        <div className="text-xs text-gray-400">
                          {processo.processClass}
                        </div>
                      </td>

                      {/* Tribunal */}
                      <td className="px-6 py-4 text-sm text-gray-700">
                        {processo.currentCourt ?? (
                          <span className="text-gray-400 italic">Aguardando sincronização</span>
                        )}
                      </td>

                      {/* Status */}
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            STATUS_BADGE[processo.status] ?? 'bg-gray-100 text-gray-700'
                          }`}
                        >
                          {STATUS_LABELS[processo.status] ?? processo.status}
                        </span>
                      </td>

                      {/* Última sincronização */}
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          {stale && (
                            <span
                              className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800"
                              title="Dados podem estar desatualizados — última sincronização há mais de 48 horas"
                              aria-label="Dados desatualizados"
                            >
                              Desatualizado
                            </span>
                          )}
                          <span className="text-sm text-gray-500">
                            {processo.lastDatajudSyncAt
                              ? new Date(processo.lastDatajudSyncAt).toLocaleString('pt-BR')
                              : '—'}
                          </span>
                        </div>
                      </td>

                      {/* Ações */}
                      <td className="px-6 py-4 text-right">
                        <Link
                          href={`/processos/${processo.id}`}
                          className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                        >
                          Ver detalhes →
                        </Link>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Paginação */}
      {totalPages > 1 && (
        <nav
          aria-label="Paginação de processos"
          className="mt-4 flex items-center justify-between text-sm text-gray-600"
        >
          <span>
            Página {page} de {totalPages} — {result.total} processos
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link
                href={buildUrl({ page: String(page - 1) })}
                className="px-3 py-1 rounded border border-gray-300 hover:bg-gray-100 transition-colors"
              >
                ← Anterior
              </Link>
            )}
            {page < totalPages && (
              <Link
                href={buildUrl({ page: String(page + 1) })}
                className="px-3 py-1 rounded border border-gray-300 hover:bg-gray-100 transition-colors"
              >
                Próxima →
              </Link>
            )}
          </div>
        </nav>
      )}
    </div>
  );
}
