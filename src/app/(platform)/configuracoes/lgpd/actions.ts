/**
 * Server Actions — Painel LGPD
 *
 * Disponibiliza ações de:
 *  - exportUserData: gera e retorna o JSON de portabilidade de dados (LGPD Art. 18, III)
 *  - requestAnonymization: anonimiza dados pessoais do usuário (LGPD Art. 18, VI)
 *
 * Restrições de acesso:
 *  - Apenas OFFICE_ADMIN e SUPER_ADMIN podem invocar essas ações.
 *  - O tenantId da sessão é sempre utilizado — impossível agir em outro tenant.
 *
 * Requirements: 13.3, 13.4, 13.8
 */

'use server';

import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { exportUserDataUseCase } from '@/application/lgpd/ExportUserDataUseCase';
import { anonymizeUserUseCase } from '@/application/lgpd/AnonymizeUserUseCase';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const ADMIN_ROLES = ['OFFICE_ADMIN', 'SUPER_ADMIN'];

async function requireAdminSession() {
  const session = await auth();

  if (!session?.user) {
    redirect('/login');
  }

  if (!ADMIN_ROLES.includes(session.user.role)) {
    redirect('/403');
  }

  return session.user;
}

// ─────────────────────────────────────────────────────────────────────────────
// Actions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Exporta os dados pessoais de um usuário como JSON.
 *
 * Retorna o objeto { ok: true, json, meta } em sucesso ou { ok: false, error } em falha.
 * A camada de UI é responsável por fazer o download do JSON retornado.
 *
 * Requirement: 13.3
 */
export async function exportUserDataAction(
  userId: string,
): Promise<
  | { ok: true; json: string; meta: { exportedAt: string; recordCounts: Record<string, number> } }
  | { ok: false; error: string }
> {
  const user = await requireAdminSession();

  if (!userId || typeof userId !== 'string') {
    return { ok: false, error: 'ID de usuário inválido.' };
  }

  try {
    const result = await exportUserDataUseCase.execute({
      userId,
      tenantId: user.tenantId,
    });

    return {
      ok: true,
      json: result.json,
      meta: {
        exportedAt: result.meta.exportedAt,
        recordCounts: result.meta.recordCounts,
      },
    };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : 'Erro ao exportar dados do usuário.';
    return { ok: false, error: message };
  }
}

/**
 * Solicita a anonimização dos dados pessoais de um usuário.
 *
 * ATENÇÃO: Operação irreversível — o nome e e-mail do usuário serão substituídos
 * por valores anonimizados e o acesso ao sistema será revogado.
 *
 * Requirement: 13.4
 */
export async function requestAnonymizationAction(
  userId: string,
): Promise<{ ok: true; anonymizedAt: string } | { ok: false; error: string }> {
  const adminUser = await requireAdminSession();

  if (!userId || typeof userId !== 'string') {
    return { ok: false, error: 'ID de usuário inválido.' };
  }

  try {
    const result = await anonymizeUserUseCase.execute({
      userId,
      tenantId: adminUser.tenantId,
      requestedByUserId: adminUser.userId,
    });

    return {
      ok: true,
      anonymizedAt: result.anonymizedAt.toISOString(),
    };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : 'Erro ao anonimizar dados do usuário.';
    return { ok: false, error: message };
  }
}
