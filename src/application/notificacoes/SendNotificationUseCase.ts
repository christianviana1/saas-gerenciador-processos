/**
 * SendNotificationUseCase — Persiste uma notificação e enfileira entrega multicanal.
 *
 * Fluxo:
 *  1. Persiste o registro `Notification` com `expiresAt = now + 90 dias`
 *  2. Busca as preferências de notificação do usuário para o tipo informado
 *     (fallback: todos os canais habilitados quando não há preferência cadastrada)
 *  3. Determina os canais habilitados a partir das preferências
 *  4. Enfileira job na `notificationsQueue` com os dados necessários para entrega
 *
 * Requisitos: 10.3, 10.4, 10.8
 */

import { prisma } from '@/infrastructure/database/prisma/client';
import { notificationsQueue } from '@/infrastructure/queues/queues';
import type { NotificationType } from '@prisma/client';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface SendNotificationInput {
  /** Usuário destinatário da notificação */
  userId: string;
  /** Tenant ao qual a notificação pertence */
  tenantId: string;
  /** Tipo da notificação — determina as preferências de canal a consultar */
  type: NotificationType;
  /** Título da notificação */
  title: string;
  /** Corpo / mensagem da notificação */
  body: string;
  /** Tipo do recurso relacionado (ex.: "Process", "Task") — opcional */
  resourceType?: string;
  /** ID do recurso relacionado — opcional */
  resourceId?: string;
}

export interface SendNotificationOutput {
  /** ID do registro `Notification` persistido */
  notificationId: string;
}

// Canal de entrega (alinhado com o tipo do job na fila)
type NotificationChannel = 'in-app' | 'email' | 'push';

// ─────────────────────────────────────────────────────────────────────────────
// Use Case
// ─────────────────────────────────────────────────────────────────────────────

export class SendNotificationUseCase {
  /**
   * Persiste uma notificação e enfileira a entrega nos canais habilitados pelo usuário.
   *
   * Requisito 10.3: Entrega assíncrona via Queue_Worker — nunca bloqueia o evento original.
   * Requisito 10.4: Cada usuário configura individualmente quais canais deseja receber.
   * Requisito 10.8: Histórico de notificações In-App retido por 90 dias.
   */
  async execute(input: SendNotificationInput): Promise<SendNotificationOutput> {
    const {
      userId,
      tenantId,
      type,
      title,
      body,
      resourceType,
      resourceId,
    } = input;

    // ── 1. Persistir registro de Notification ────────────────────────────────
    // expiresAt = now + 90 dias (Requisito 10.8)
    const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

    const notification = await prisma.notification.create({
      data: {
        tenantId,
        userId,
        type,
        title,
        body,
        resourceType: resourceType ?? null,
        resourceId: resourceId ?? null,
        expiresAt,
      },
      select: { id: true },
    });

    // ── 2. Buscar preferências de notificação do usuário ─────────────────────
    // Consulta a preferência específica para este tipo de notificação.
    // Requisito 10.4: usuários configuram canais individualmente por tipo.
    const preference = await prisma.userNotificationPreference.findUnique({
      where: {
        userId_notificationType: {
          userId,
          notificationType: type,
        },
      },
      select: {
        channelInApp: true,
        channelEmail: true,
        channelPush: true,
      },
    });

    // ── 3. Determinar canais habilitados ─────────────────────────────────────
    // Quando não há preferência cadastrada, o padrão é todos os canais habilitados
    // (mirrors o default do schema: channelInApp=true, channelEmail=true, channelPush=true).
    const channelInApp  = preference?.channelInApp  ?? true;
    const channelEmail  = preference?.channelEmail  ?? true;
    const channelPush   = preference?.channelPush   ?? true;

    const channels: NotificationChannel[] = [];
    if (channelInApp)  channels.push('in-app');
    if (channelEmail)  channels.push('email');
    if (channelPush)   channels.push('push');

    // ── 4. Enfileirar entrega multicanal (fire-and-forget) ───────────────────
    // Requisito 10.3: entrega assíncrona — não bloquear o fluxo chamador.
    if (channels.length > 0) {
      void notificationsQueue.add(
        'send-notification',
        {
          notificationId: notification.id,
          userId,
          tenantId,
          type,
          channels,
        },
      ).catch((err: unknown) => {
        console.error(
          '[SendNotificationUseCase] Falha ao enfileirar notificação na fila:',
          err,
        );
      });
    }

    // ── 5. Retornar ID da notificação persistida ─────────────────────────────
    return { notificationId: notification.id };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton
// ─────────────────────────────────────────────────────────────────────────────

/** Singleton para uso na camada de aplicação e workers. */
export const sendNotificationUseCase = new SendNotificationUseCase();
