/**
 * Notificações — Histórico das 100 notificações mais recentes.
 *
 * Server Component: busca diretamente via Prisma as 100 notificações
 * mais recentes do usuário autenticado, não expiradas, e repassa ao
 * NotificacoesClient (Client Component) para interatividade.
 *
 * Requirements: 10.7, 10.8
 */

import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@/infrastructure/database/prisma/client';
import {
  NotificacoesClient,
  type NotificationItem,
} from '@/modules/notificacoes/components/NotificacoesClient';

// ─────────────────────────────────────────────────────────────────────────────
// Page Component
// ─────────────────────────────────────────────────────────────────────────────

export default async function NotificacoesPage() {
  const session = await auth();
  if (!session?.user) {
    redirect('/login');
  }

  const { tenantId, userId } = session.user;
  const now = new Date();

  // Busca as 100 notificações mais recentes, não expiradas (Req. 10.8)
  const rows = await prisma.notification.findMany({
    where: {
      tenantId,
      userId,
      expiresAt: { gt: now },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: {
      id:           true,
      type:         true,
      title:        true,
      body:         true,
      readAt:       true,
      createdAt:    true,
      resourceType: true,
      resourceId:   true,
    },
  });

  // Serialise Dates to ISO strings for client-side consumption
  const notifications: NotificationItem[] = rows.map((n) => ({
    id:           n.id,
    type:         n.type,
    title:        n.title,
    body:         n.body,
    readAt:       n.readAt?.toISOString() ?? null,
    createdAt:    n.createdAt.toISOString(),
    resourceType: n.resourceType,
    resourceId:   n.resourceId,
  }));

  return <NotificacoesClient initialNotifications={notifications} />;
}
