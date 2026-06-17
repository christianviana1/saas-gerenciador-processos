/**
 * Admin Dashboard — Lista todos os tenants da plataforma
 *
 * Server Component: busca dados diretamente via Prisma.
 * Somente acessível por SUPER_ADMIN (garantido pelo AdminLayout).
 *
 * Requirements: 1.4, 1.5, 1.6
 */

import Link from 'next/link';
import { prisma } from '@/infrastructure/database/prisma/client';

// Mapa de cores por status
const STATUS_BADGE: Record<string, string> = {
  ACTIVE:     'bg-green-100 text-green-800',
  BLOCKED:    'bg-red-100 text-red-800',
  SUSPENDED:  'bg-yellow-100 text-yellow-800',
  TERMINATED: 'bg-gray-100 text-gray-700',
};

// Mapa de cores por plano
const PLAN_BADGE: Record<string, string> = {
  BASIC:        'bg-blue-50 text-blue-700',
  PROFESSIONAL: 'bg-purple-50 text-purple-700',
  ENTERPRISE:   'bg-indigo-50 text-indigo-700',
};

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const params = await searchParams;
  const page     = Math.max(1, Number(params.page ?? 1));
  const pageSize = 20;

  const [tenants, total] = await Promise.all([
    prisma.tenant.findMany({
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id:        true,
        name:      true,
        slug:      true,
        plan:      true,
        status:    true,
        createdAt: true,
        _count: {
          select: { users: true },
        },
      },
    }),
    prisma.tenant.count(),
  ]);

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div>
      {/* Cabeçalho */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tenants</h1>
          <p className="text-sm text-gray-500 mt-1">
            {total} tenant{total !== 1 ? 's' : ''} cadastrado{total !== 1 ? 's' : ''}
          </p>
        </div>
        <a
          href="/admin/tenants/new"
          className="inline-flex items-center px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 transition-colors"
        >
          + Novo Tenant
        </a>
      </div>

      {/* Tabela */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Nome / Slug
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Plano
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Status
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Usuários
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Criado em
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Ações
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-100">
            {tenants.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-10 text-center text-sm text-gray-500">
                  Nenhum tenant encontrado.
                </td>
              </tr>
            ) : (
              tenants.map((tenant: any) => (
                <tr key={tenant.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="text-sm font-medium text-gray-900">{tenant.name}</div>
                    <div className="text-xs text-gray-400">{tenant.slug}</div>
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        PLAN_BADGE[tenant.plan] ?? 'bg-gray-100 text-gray-700'
                      }`}
                    >
                      {tenant.plan}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        STATUS_BADGE[tenant.status] ?? 'bg-gray-100 text-gray-700'
                      }`}
                    >
                      {tenant.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-700">
                    {tenant._count.users}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">
                    {new Date(tenant.createdAt).toLocaleDateString('pt-BR')}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <Link
                      href={`/admin/tenants/${tenant.id}`}
                      className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                    >
                      Detalhes →
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Paginação */}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm text-gray-600">
          <span>
            Página {page} de {totalPages}
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <a
                href={`/admin?page=${page - 1}`}
                className="px-3 py-1 rounded border border-gray-300 hover:bg-gray-100 transition-colors"
              >
                ← Anterior
              </a>
            )}
            {page < totalPages && (
              <a
                href={`/admin?page=${page + 1}`}
                className="px-3 py-1 rounded border border-gray-300 hover:bg-gray-100 transition-colors"
              >
                Próxima →
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
