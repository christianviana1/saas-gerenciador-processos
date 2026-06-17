/**
 * Painel LGPD — Gestão de Consentimentos e Requisições
 *
 * Server Component restrito a OFFICE_ADMIN e SUPER_ADMIN.
 *
 * Exibe:
 *  1. Lista de registros de consentimento do tenant (usuário, versão da política, data)
 *  2. Botões de ação por usuário: "Exportar dados" e "Solicitar exclusão de conta"
 *
 * Requirements: 13.8 (painel de gestão), 13.3 (exportação), 13.4 (anonimização)
 */

import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@/infrastructure/database/prisma/client';
import { LgpdActionButtons } from './LgpdActionButtons';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const ADMIN_ROLES = ['OFFICE_ADMIN', 'SUPER_ADMIN'];

// ─────────────────────────────────────────────────────────────────────────────
// Page Component
// ─────────────────────────────────────────────────────────────────────────────

export default async function LgpdPage() {
  // ── Autenticação e autorização ─────────────────────────────────────────────
  const session = await auth();

  if (!session?.user) {
    redirect('/login');
  }

  if (!ADMIN_ROLES.includes(session.user.role)) {
    redirect('/403');
  }

  const { tenantId } = session.user;

  // ── Buscar registros de consentimento do tenant ───────────────────────────
  // Req 13.8: listar consentimentos dos usuários do tenant
  // Inclui dados do usuário (email, nome) — exceto usuários já anonimizados (deletedAt != null)
  const consentRecords = await prisma.consentRecord.findMany({
    where: {
      tenantId,
    },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          deletedAt: true,
        },
      },
    },
    orderBy: { consentedAt: 'desc' },
    take: 200,
  });

  // ── Agrupar consentimentos por usuário ────────────────────────────────────
  // Para exibir um registro por usuário com o consentimento mais recente
  const userMap = new Map<
    string,
    {
      userId: string;
      name: string;
      email: string;
      isAnonymized: boolean;
      latestConsentedAt: Date;
      latestPolicyVersion: string;
      consentCount: number;
    }
  >();

  for (const record of consentRecords) {
    const existing = userMap.get(record.userId);
    if (!existing) {
      userMap.set(record.userId, {
        userId: record.userId,
        name: record.user.name,
        email: record.user.email,
        isAnonymized: record.user.deletedAt !== null,
        latestConsentedAt: record.consentedAt,
        latestPolicyVersion: record.policyVersion,
        consentCount: 1,
      });
    } else {
      existing.consentCount += 1;
      // Manter o registro mais recente como primário
      if (record.consentedAt > existing.latestConsentedAt) {
        existing.latestConsentedAt = record.consentedAt;
        existing.latestPolicyVersion = record.policyVersion;
      }
    }
  }

  const users = Array.from(userMap.values());
  const activeUsers = users.filter((u) => !u.isAnonymized);
  const anonymizedUsers = users.filter((u) => u.isAnonymized);

  return (
    <div className="max-w-6xl mx-auto">
      {/* Cabeçalho */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Gestão LGPD</h1>
        <p className="text-sm text-gray-500 mt-1">
          Painel de consentimentos e requisições de dados dos usuários do seu escritório. Conforme
          a Lei Geral de Proteção de Dados (Lei nº 13.709/2018).
        </p>
      </div>

      {/* Cards de resumo */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <div className="bg-white rounded-lg border border-gray-200 px-5 py-4 shadow-sm">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">
            Total de registros de consentimento
          </p>
          <p className="mt-1 text-3xl font-bold text-gray-900">{consentRecords.length}</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 px-5 py-4 shadow-sm">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">
            Usuários com consentimento ativo
          </p>
          <p className="mt-1 text-3xl font-bold text-blue-600">{activeUsers.length}</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 px-5 py-4 shadow-sm">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">
            Contas anonimizadas
          </p>
          <p className="mt-1 text-3xl font-bold text-gray-400">{anonymizedUsers.length}</p>
        </div>
      </div>

      {/* Tabela principal — Consentimentos e ações */}
      <section aria-labelledby="consents-heading">
        <div className="flex items-center justify-between mb-3">
          <h2
            id="consents-heading"
            className="text-lg font-semibold text-gray-800"
          >
            Registros de Consentimento
          </h2>
          <span className="text-xs text-gray-400">
            Mostrando até 200 registros mais recentes por tenant
          </span>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    Usuário
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    E-mail
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    Versão da política aceita
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    Data do consentimento
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
                    Ações
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-100">
                {users.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-6 py-12 text-center text-sm text-gray-500"
                    >
                      Nenhum registro de consentimento encontrado para este tenant.
                    </td>
                  </tr>
                ) : (
                  users.map((u) => (
                    <tr
                      key={u.userId}
                      className={`transition-colors ${
                        u.isAnonymized ? 'bg-gray-50 opacity-60' : 'hover:bg-gray-50'
                      }`}
                    >
                      {/* Nome */}
                      <td className="px-6 py-4">
                        <div className="text-sm font-medium text-gray-900">{u.name}</div>
                        {u.consentCount > 1 && (
                          <div className="text-xs text-gray-400">
                            {u.consentCount} registros de consentimento
                          </div>
                        )}
                      </td>

                      {/* E-mail */}
                      <td className="px-6 py-4 text-sm text-gray-700">
                        {u.email}
                      </td>

                      {/* Versão da política */}
                      <td className="px-6 py-4">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-800">
                          {u.latestPolicyVersion}
                        </span>
                      </td>

                      {/* Data */}
                      <td className="px-6 py-4 text-sm text-gray-600">
                        <time dateTime={u.latestConsentedAt.toISOString()}>
                          {u.latestConsentedAt.toLocaleString('pt-BR', {
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </time>
                      </td>

                      {/* Status */}
                      <td className="px-6 py-4">
                        {u.isAnonymized ? (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-200 text-gray-600">
                            Anonimizado
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                            Ativo
                          </span>
                        )}
                      </td>

                      {/* Ações */}
                      <td className="px-6 py-4">
                        {u.isAnonymized ? (
                          <span className="text-xs text-gray-400 italic">
                            Dados já anonimizados
                          </span>
                        ) : (
                          <LgpdActionButtons userId={u.userId} userName={u.name} />
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Informações legais */}
      <section
        aria-label="Informações sobre direitos LGPD"
        className="mt-8 bg-blue-50 border border-blue-200 rounded-lg p-5"
      >
        <h2 className="text-sm font-semibold text-blue-800 mb-2">
          Direitos dos titulares de dados (LGPD — Lei nº 13.709/2018)
        </h2>
        <ul className="text-xs text-blue-700 space-y-1 list-disc list-inside">
          <li>
            <strong>Art. 18, II</strong> — Acesso aos dados: o titular pode solicitar confirmação
            de existência e acesso aos dados tratados.
          </li>
          <li>
            <strong>Art. 18, III</strong> — Portabilidade: exportação dos dados pessoais em formato
            estruturado (JSON). Prazo: até 72 horas.
          </li>
          <li>
            <strong>Art. 18, VI</strong> — Eliminação: anonimização dos dados pessoais
            identificáveis. Prazo: até 30 dias. Registros de auditoria são preservados de forma
            anonimizada.
          </li>
        </ul>
        <p className="text-xs text-blue-600 mt-3">
          A operação de exclusão/anonimização é <strong>irreversível</strong>. Registros de
          auditoria e histórico processual são preservados de forma anonimizada conforme exigência
          legal.
        </p>
      </section>
    </div>
  );
}
