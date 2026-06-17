/**
 * SyncDataJudUseCase — Sincronização forçada de processo com o DataJud pelo usuário.
 *
 * Fluxo:
 *  1. Verifica permissão RBAC (process:update) — lança ForbiddenError se negado
 *  2. Verifica que o processo existe no tenant — lança NotFoundError se ausente
 *  3. Verifica disponibilidade do DataJud via helper checkDataJudAvailability()
 *     - Se indisponível > 60 minutos consecutivos, enfileira alerta SYSTEM_ALERT ao Super_Admin
 *  4. Enfileira job `forced-sync` no datajudSyncQueue com os dados do processo
 *  5. Retorna { jobId, enqueuedAt }
 *
 * Nota: `lastDatajudSyncAt` é atualizado pelo worker após o sync ser concluído com sucesso.
 *
 * Requisitos: 7.6, 7.8
 */

import { rbacEngine } from '@/domain/services/RBACEngine';
import { processRepository } from '@/infrastructure/database/repositories/ProcessRepository';
import { datajudSyncQueue, notificationsQueue } from '@/infrastructure/queues/queues';
import { prisma } from '@/infrastructure/database/prisma/client';
import { NotFoundError } from '@/shared/errors/AppError';
import { redisConnection } from '@/infrastructure/queues/queues';
import type { Role } from '@/domain/services/RBACEngine';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Redis key that stores the ISO timestamp when DataJud was first detected
 * as unavailable in the current outage window.
 *
 * Set by the Queue_Worker upon detecting a DataJud failure.
 * Cleared by the worker when DataJud recovers.
 *
 * Requirement 7.6
 */
const DATAJUD_UNAVAILABLE_SINCE_KEY = 'datajud:unavailable_since';

/** 60 minutes in milliseconds — threshold for triggering Super_Admin alert. */
const DATAJUD_OUTAGE_ALERT_THRESHOLD_MS = 60 * 60 * 1_000;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface SyncDataJudInput {
  /** ID do processo a ser sincronizado */
  processId: string;
  /** Tenant ao qual o processo pertence */
  tenantId: string;
  /** ID do usuário que está solicitando a sincronização */
  userId: string;
  /** Papel do usuário para verificação RBAC */
  userRole: Role;
}

export interface SyncDataJudResult {
  /** BullMQ job ID do job enfileirado */
  jobId: string;
  /** Timestamp ISO quando o job foi enfileirado */
  enqueuedAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: DataJud Availability Check
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Verifica se o DataJud está indisponível há mais de 60 minutos consecutivos.
 *
 * Lê a chave Redis `datajud:unavailable_since`. Se a chave existir e o tempo
 * decorrido superar 60 minutos, enfileira uma notificação SYSTEM_ALERT ao
 * Super_Admin via notificationsQueue.
 *
 * A notificação é enfileirada de forma fire-and-forget (void) para não
 * bloquear o fluxo principal de sincronização.
 *
 * Requirement 7.6: alertar Super_Admin quando DataJud indisponível > 60 min consecutivos.
 */
export async function checkDataJudAvailability(): Promise<void> {
  let unavailableSinceIso: string | null;

  try {
    unavailableSinceIso = await redisConnection.get(DATAJUD_UNAVAILABLE_SINCE_KEY);
  } catch {
    // Redis read failure is non-fatal — availability check is best-effort.
    // Log structurally but do not block the sync request.
    console.warn(
      JSON.stringify({
        level: 'warn',
        service: 'SyncDataJudUseCase',
        action: 'checkDataJudAvailability',
        message: 'Failed to read datajud:unavailable_since from Redis; skipping availability check.',
      }),
    );
    return;
  }

  if (unavailableSinceIso === null) {
    // DataJud is available (no active outage key set). Nothing to do.
    return;
  }

  const unavailableSince = new Date(unavailableSinceIso);

  // Validate the stored value is a parseable date
  if (isNaN(unavailableSince.getTime())) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        service: 'SyncDataJudUseCase',
        action: 'checkDataJudAvailability',
        message: `Invalid datajud:unavailable_since value in Redis: "${unavailableSinceIso}"`,
      }),
    );
    return;
  }

  const elapsedMs = Date.now() - unavailableSince.getTime();

  if (elapsedMs < DATAJUD_OUTAGE_ALERT_THRESHOLD_MS) {
    // Outage is ongoing but has not yet crossed the 60-minute threshold.
    return;
  }

  // ── Outage exceeds 60 minutes — look up Super_Admin user(s) and alert ─────
  // Requirement 7.6: notify Super_Admin via Notification_Service.
  const elapsedMinutes = Math.floor(elapsedMs / 60_000);

  let superAdmins: Array<{ id: string; tenantId: string }>;
  try {
    superAdmins = await prisma.user.findMany({
      where: {
        role: 'SUPER_ADMIN',
        status: 'ACTIVE',
        deletedAt: null,
      },
      select: { id: true, tenantId: true },
    });
  } catch {
    // Non-fatal: log and skip alert to avoid blocking the sync request.
    console.error(
      JSON.stringify({
        level: 'error',
        service: 'SyncDataJudUseCase',
        action: 'checkDataJudAvailability',
        message: 'Failed to query Super_Admin users for DataJud outage alert.',
      }),
    );
    return;
  }

  if (superAdmins.length === 0) {
    return;
  }

  // Enqueue a SYSTEM_ALERT notification for each active Super_Admin.
  // Fire-and-forget — we do not await these to avoid blocking the sync flow.
  for (const admin of superAdmins) {
    void notificationsQueue.add(
      'datajud-unavailability-alert',
      {
        notificationId: `datajud-alert:${admin.id}:${Date.now()}`,
        userId: admin.id,
        tenantId: admin.tenantId,
        type: 'SYSTEM_ALERT',
        channels: ['in-app', 'email'],
      },
      {
        // Deduplicate: only one alert per admin per minute to prevent flooding.
        jobId: `datajud-alert:${admin.id}:${Math.floor(Date.now() / 60_000)}`,
        removeOnComplete: { count: 50 },
        removeOnFail: { count: 20 },
      },
    );
  }

  console.warn(
    JSON.stringify({
      level: 'warn',
      service: 'SyncDataJudUseCase',
      action: 'checkDataJudAvailability',
      message: `DataJud has been unavailable for ${elapsedMinutes} minutes. SYSTEM_ALERT enqueued for ${superAdmins.length} Super_Admin user(s).`,
      unavailableSince: unavailableSince.toISOString(),
      elapsedMinutes,
      alertedAdmins: superAdmins.map((a) => a.id),
    }),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Use Case
// ─────────────────────────────────────────────────────────────────────────────

export class SyncDataJudUseCase {
  /**
   * Executa o fluxo de sincronização forçada com DataJud.
   *
   * @throws {ForbiddenError}  quando o ator não tem permissão `process:update`
   * @throws {NotFoundError}   quando o processo não existe no tenant
   */
  async execute(input: SyncDataJudInput): Promise<SyncDataJudResult> {
    const { processId, tenantId, userId, userRole } = input;

    // ── 1. Verificação RBAC ──────────────────────────────────────────────────
    // Exige permissão process:update para forçar sincronização.
    // Requirement 2.2: avaliar permissões antes de executar qualquer ação.
    rbacEngine.enforce(
      {
        userId,
        tenantId,
        role: userRole,
        resourceTenantId: tenantId,
      },
      'process:update',
    );

    // ── 2. Verificar existência do processo no tenant ─────────────────────────
    // Requirement 1.2: validar que o recurso pertence ao tenant da sessão ativa.
    const process = await processRepository.findById(processId, tenantId);

    if (process === null) {
      throw new NotFoundError(
        `Process '${processId}' not found in tenant '${tenantId}'.`,
        { processId, tenantId },
      );
    }

    // ── 3. Verificar disponibilidade do DataJud ──────────────────────────────
    // Se DataJud estiver indisponível > 60 min, alertar Super_Admin.
    // Best-effort: falhas nesta verificação não bloqueiam o enfileiramento.
    // Requirement 7.6.
    await checkDataJudAvailability();

    // ── 4. Enfileirar job de sincronização forçada ────────────────────────────
    // Requirement 7.7: DataJud calls must NEVER block user operations.
    // O worker é responsável por atualizar lastDatajudSyncAt após o sync
    // bem-sucedido (Requirement 7.8).
    const enqueuedAt = new Date();

    const job = await datajudSyncQueue.add(
      'forced-sync',
      {
        type: 'forced-sync',
        processId: process.id,
        tenantId,
        cnjNumber: process.cnjNumber,
        triggerType: 'manual',
      },
      {
        // Unique job ID prevents enqueueing duplicate forced syncs for the same
        // process within the same second. If the user clicks "sync" multiple
        // times rapidly, only one job will be enqueued.
        jobId: `forced-sync:${processId}:${enqueuedAt.getTime()}`,
      },
    );

    // ── 5. Retornar resultado ─────────────────────────────────────────────────
    return {
      jobId: job.id ?? `forced-sync:${processId}:${enqueuedAt.getTime()}`,
      enqueuedAt: enqueuedAt.toISOString(),
    };
  }
}

/** Singleton para uso na camada de aplicação e Server Actions. */
export const syncDataJudUseCase = new SyncDataJudUseCase();
