/**
 * Tenant Detail Page — /admin/tenants/[id]
 *
 * Server Component com Server Actions para:
 *  - Bloquear tenant        (Requisito 1.4, 1.5)
 *  - Reativar tenant        (Requisito 1.4, 1.5)
 *  - Alterar plano          (Requisito 1.6)
 *
 * Requirements: 1.4, 1.5, 1.6
 */

import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/auth';
import { prisma } from '@/infrastructure/database/prisma/client';
import { blockTenantUseCase } from '@/application/tenants/BlockTenantUseCase';
import { reactivateTenantUseCase } from '@/application/tenants/ReactivateTenantUseCase';
import type { TenantPlan } from '@/domain/entities/Tenant';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, string> = {
  ACTIVE:     'bg-green-100 text-green-800',
  BLOCKED:    'bg-red-100 text-red-800',
  SUSPENDED:  'bg-yellow-100 text-yellow-800',
  TERMINATED: 'bg-gray-100 text-gray-700',
};

const USER_ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN:      'Super Admin',
  OFFICE_ADMIN:     'Office Admin',
  LAWYER:           'Advogado',
  LEGAL_ASSISTANT:  'Assistente Jurídico',
  INTERN:           'Estagiário',
  READ_ONLY_USER:   'Somente Leitura',
};

const USER_STATUS_BADGE: Record<string, string> = {
  ACTIVE:   'bg-green-100 text-green-700',
  INACTIVE: 'bg-red-100 text-red-700',
  PENDING:  'bg-yellow-100 text-yellow-700',
};

const PLANS: TenantPlan[] = ['BASIC', 'PROFESSIONAL', 'ENTERPRISE'];

// ─────────────────────────────────────────────────────────────────────────────
// Server Actions
// ─────────────────────────────────────────────────────────────────────────────

async function blockTenant(tenantId: string, formData: FormData) {
  'use server';

  const session = await auth();
  if (!session?.user || session.user.role !== 'SUPER_ADMIN') {
    redirect('/dashboard');
  }

  const reason = (formData.get('reason') as string | null)?.trim() || 'Bloqueado pelo Super Admin';

  await blockTenantUseCase.execute({
    tenantId,
    actorUserId: session.user.userId,
    actorRole:   'SUPER_ADMIN',
    reason,
  });

  redirect(`/admin/tenants/${tenantId}`);
}

async function reactivateTenant(tenantId: string) {
  'use server';

  const session = await auth();
  if (!session?.user || session.user.role !== 'SUPER_ADMIN') {
    redirect('/dashboard');
  }

  await reactivateTenantUseCase.execute({
    tenantId,
    actorUserId: session.user.userId,
    actorRole:   'SUPER_ADMIN',
  });

  redirect(`/admin/tenants/${tenantId}`);
}

async function changePlan(tenantId: string, formData: FormData) {
  'use server';

  const session = await auth();
  if (!session?.user || session.user.role !== 'SUPER_ADMIN') {
    redirect('/dashboard');
  }

  const plan = formData.get('plan') as TenantPlan | null;
  if (!plan || !PLANS.includes(plan)) {
    redirect(`/admin/tenants/${tenantId}?error=invalid_plan`);
  }

  await prisma.tenant.update({
    where: { id: tenantId },
    data: { plan },
  });

  redirect(`/admin/tenants/${tenantId}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Page Component
// ─────────────────────────────────────────────────────────────────────────────

export default async function TenantDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Carrega o tenant com contagem de usuários e lista de usuários
  const tenant = await prisma.tenant.findUnique({
    where: { id },
    include: {
      users: {
        where:   { deletedAt: null },
        orderBy: { createdAt: 'desc' },
        select: {
          id:          true,
          name:        true,
          email:       true,
          role:        true,
          status:      true,
          lastLoginAt: true,
          createdAt:   true,
        },
      },
    },
  });

  if (!tenant) {
    notFound();
  }

  // Bind Server Actions ao tenantId
  const blockAction      = blockTenant.bind(null, tenant.id);
  const reactivateAction = reactivateTenant.bind(null, tenant.id);
  const changePlanAction = changePlan.bind(null, tenant.id);

  const isBlocked = tenant.status === 'BLOCKED' || tenant.status === 'SUSPENDED';

  return (
    <div className="space-y-8">
      {/* Breadcrumb */}
      <nav className="text-sm text-gray-500">
        <Link href="/admin" className="hover:text-gray-700">
          Tenants
        </Link>
        <span className="mx-2">/</span>
        <span className="text-gray-900 font-medium">{tenant.name}</span>
      </nav>

      {/* Cabeçalho */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{tenant.name}</h1>
          <p className="text-sm text-gray-500 mt-1">
            Slug: <code className="bg-gray-100 px-1 rounded">{tenant.slug}</code>
          </p>
        </div>
        <span
          className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
            STATUS_BADGE[tenant.status] ?? 'bg-gray-100 text-gray-700'
          }`}
        >
          {tenant.status}
        </span>
      </div>

      {/* Informações do Tenant */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Informações</h2>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
          <div>
            <dt className="text-xs font-medium text-gray-500 uppercase">ID</dt>
            <dd className="mt-1 text-sm text-gray-900 font-mono">{tenant.id}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-gray-500 uppercase">Nome</dt>
            <dd className="mt-1 text-sm text-gray-900">{tenant.name}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-gray-500 uppercase">Slug</dt>
            <dd className="mt-1 text-sm text-gray-900">{tenant.slug}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-gray-500 uppercase">Plano</dt>
            <dd className="mt-1 text-sm text-gray-900">{tenant.plan}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-gray-500 uppercase">Status</dt>
            <dd className="mt-1 text-sm text-gray-900">{tenant.status}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-gray-500 uppercase">Criado em</dt>
            <dd className="mt-1 text-sm text-gray-900">
              {new Date(tenant.createdAt).toLocaleString('pt-BR')}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-gray-500 uppercase">Última atualização</dt>
            <dd className="mt-1 text-sm text-gray-900">
              {new Date(tenant.updatedAt).toLocaleString('pt-BR')}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-gray-500 uppercase">Total de usuários</dt>
            <dd className="mt-1 text-sm text-gray-900">{tenant.users.length}</dd>
          </div>
        </dl>
      </div>

      {/* Ações */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Ações Administrativas</h2>
        <div className="flex flex-wrap gap-4">

          {/* Alterar Plano — Requisito 1.6 */}
          <form action={changePlanAction} className="flex items-center gap-2">
            <select
              name="plan"
              defaultValue={tenant.plan}
              className="text-sm border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              {PLANS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 transition-colors"
            >
              Alterar Plano
            </button>
          </form>

          {/* Bloquear — Requisito 1.4, 1.5 */}
          {!isBlocked && (
            <form action={blockAction} className="flex items-center gap-2">
              <input
                type="text"
                name="reason"
                placeholder="Motivo do bloqueio"
                className="text-sm border border-gray-300 rounded-md px-3 py-2 w-56 focus:ring-2 focus:ring-red-400 focus:border-red-400"
              />
              <button
                type="submit"
                className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-md hover:bg-red-700 transition-colors"
                onClick={(e) => {
                  if (!confirm('Tem certeza que deseja bloquear este tenant?')) {
                    e.preventDefault();
                  }
                }}
              >
                Bloquear
              </button>
            </form>
          )}

          {/* Reativar — Requisito 1.4, 1.5 */}
          {isBlocked && (
            <form action={reactivateAction}>
              <button
                type="submit"
                className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-md hover:bg-green-700 transition-colors"
                onClick={(e) => {
                  if (!confirm('Tem certeza que deseja reativar este tenant?')) {
                    e.preventDefault();
                  }
                }}
              >
                Reativar Tenant
              </button>
            </form>
          )}
        </div>
      </div>

      {/* Lista de Usuários */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">
            Usuários ({tenant.users.length})
          </h2>
        </div>
        <table className="min-w-full divide-y divide-gray-100">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Nome / Email
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Papel
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Status
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Último login
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {tenant.users.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-6 py-8 text-center text-sm text-gray-500">
                  Nenhum usuário encontrado.
                </td>
              </tr>
            ) : (
              tenant.users.map((user: any) => (
                <tr key={user.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <div className="text-sm font-medium text-gray-900">{user.name}</div>
                    <div className="text-xs text-gray-400">{user.email}</div>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-700">
                    {USER_ROLE_LABELS[user.role] ?? user.role}
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        USER_STATUS_BADGE[user.status] ?? 'bg-gray-100 text-gray-700'
                      }`}
                    >
                      {user.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">
                    {user.lastLoginAt
                      ? new Date(user.lastLoginAt).toLocaleString('pt-BR')
                      : '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
