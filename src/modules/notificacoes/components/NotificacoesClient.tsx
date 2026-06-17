'use client';

/**
 * NotificacoesClient — Client Component
 *
 * Renders the notification list with interactive "Marcar como lida" and
 * "Marcar todas como lidas" actions. Updates the UI optimistically without
 * a full page refresh.
 *
 * Requirements: 10.7, 10.8
 */

import { useState, useTransition } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type NotificationType =
  | 'PROCESS_UPDATED'
  | 'COURT_CHANGED'
  | 'TASK_ASSIGNED'
  | 'TASK_COMPLETED'
  | 'INVITATION_SENT'
  | 'INVITATION_ACCEPTED'
  | 'ACCOUNT_BLOCKED'
  | 'DATAJUD_UNAVAILABLE'
  | 'SYSTEM_ALERT';

export interface NotificationItem {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
  resourceType: string | null;
  resourceId: string | null;
}

interface Props {
  initialNotifications: NotificationItem[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Portuguese labels for notification types
// ─────────────────────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<NotificationType, string> = {
  PROCESS_UPDATED:    'Processo Atualizado',
  COURT_CHANGED:      'Tribunal Alterado',
  TASK_ASSIGNED:      'Tarefa Atribuída',
  TASK_COMPLETED:     'Tarefa Concluída',
  INVITATION_SENT:    'Convite Enviado',
  INVITATION_ACCEPTED:'Convite Aceito',
  ACCOUNT_BLOCKED:    'Conta Bloqueada',
  DATAJUD_UNAVAILABLE:'DataJud Indisponível',
  SYSTEM_ALERT:       'Alerta do Sistema',
};

/** Badge color per notification type */
const TYPE_COLORS: Record<NotificationType, string> = {
  PROCESS_UPDATED:    'bg-blue-100 text-blue-800',
  COURT_CHANGED:      'bg-purple-100 text-purple-800',
  TASK_ASSIGNED:      'bg-yellow-100 text-yellow-800',
  TASK_COMPLETED:     'bg-green-100 text-green-800',
  INVITATION_SENT:    'bg-cyan-100 text-cyan-800',
  INVITATION_ACCEPTED:'bg-teal-100 text-teal-800',
  ACCOUNT_BLOCKED:    'bg-red-100 text-red-800',
  DATAJUD_UNAVAILABLE:'bg-orange-100 text-orange-800',
  SYSTEM_ALERT:       'bg-gray-100 text-gray-800',
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    day:    '2-digit',
    month:  '2-digit',
    year:   'numeric',
    hour:   '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function NotificacoesClient({ initialNotifications }: Props) {
  const [notifications, setNotifications] = useState<NotificationItem[]>(initialNotifications);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const unreadCount = notifications.filter((n) => n.readAt === null).length;

  // ── Mark single notification as read ──────────────────────────────────────

  function markAsRead(id: string) {
    // Optimistic update
    setNotifications((prev) =>
      prev.map((n) =>
        n.id === id ? { ...n, readAt: new Date().toISOString() } : n,
      ),
    );

    startTransition(async () => {
      try {
        const res = await fetch(`/api/notificacoes/${id}/lida`, {
          method: 'PATCH',
        });

        if (!res.ok) {
          // Revert optimistic update on failure
          setNotifications((prev) =>
            prev.map((n) => (n.id === id ? { ...n, readAt: null } : n)),
          );
          setError('Erro ao marcar notificação como lida. Tente novamente.');
        }
      } catch {
        setNotifications((prev) =>
          prev.map((n) => (n.id === id ? { ...n, readAt: null } : n)),
        );
        setError('Erro de rede. Tente novamente.');
      }
    });
  }

  // ── Mark all unread notifications as read ─────────────────────────────────

  function markAllAsRead() {
    const unreadIds = notifications
      .filter((n) => n.readAt === null)
      .map((n) => n.id);

    if (unreadIds.length === 0) return;

    // Optimistic update — mark all as read immediately
    const now = new Date().toISOString();
    setNotifications((prev) =>
      prev.map((n) => (n.readAt === null ? { ...n, readAt: now } : n)),
    );
    setError(null);

    startTransition(async () => {
      try {
        // Fire all PATCH requests in parallel
        const results = await Promise.allSettled(
          unreadIds.map((id) =>
            fetch(`/api/notificacoes/${id}/lida`, { method: 'PATCH' }),
          ),
        );

        const failedIds = unreadIds.filter(
          (_, i) => results[i].status === 'rejected' ||
            (results[i].status === 'fulfilled' &&
              !(results[i] as PromiseFulfilledResult<Response>).value.ok),
        );

        if (failedIds.length > 0) {
          // Revert only the ones that failed
          setNotifications((prev) =>
            prev.map((n) =>
              failedIds.includes(n.id) ? { ...n, readAt: null } : n,
            ),
          );
          setError(
            `${failedIds.length} notificação(ões) não puderam ser marcadas como lidas.`,
          );
        }
      } catch {
        // Full network error — revert all
        setNotifications((prev) =>
          prev.map((n) =>
            unreadIds.includes(n.id) ? { ...n, readAt: null } : n,
          ),
        );
        setError('Erro de rede. Tente novamente.');
      }
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-3xl mx-auto py-6 px-4 sm:px-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Notificações</h1>
          {unreadCount > 0 && (
            <p className="text-sm text-gray-500 mt-1">
              {unreadCount} não lida{unreadCount !== 1 ? 's' : ''}
            </p>
          )}
        </div>

        {/* "Mark all as read" — only shown when there are unread items */}
        {unreadCount > 0 && (
          <button
            onClick={markAllAsRead}
            disabled={isPending}
            className="text-sm text-blue-600 hover:text-blue-800 font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            aria-label="Marcar todas as notificações como lidas"
          >
            {isPending ? 'Aguarde…' : 'Marcar todas como lidas'}
          </button>
        )}
      </div>

      {/* Error banner */}
      {error && (
        <div
          role="alert"
          className="mb-4 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700"
        >
          {error}
          <button
            onClick={() => setError(null)}
            className="ml-2 text-red-500 hover:text-red-700 font-medium"
            aria-label="Fechar mensagem de erro"
          >
            ✕
          </button>
        </div>
      )}

      {/* Empty state */}
      {notifications.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-12 w-12 text-gray-300 mb-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
          <p className="text-gray-500 text-sm">Nenhuma notificação para exibir.</p>
        </div>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white shadow-sm">
          {notifications.map((notification) => {
            const isUnread = notification.readAt === null;
            const typeLabel = TYPE_LABELS[notification.type] ?? notification.type;
            const badgeColor = TYPE_COLORS[notification.type] ?? 'bg-gray-100 text-gray-800';

            return (
              <li
                key={notification.id}
                className={[
                  'relative flex gap-4 px-4 py-4 transition-colors',
                  isUnread
                    ? 'border-l-4 border-l-blue-500 bg-blue-50/40'
                    : 'border-l-4 border-l-transparent',
                ].join(' ')}
              >
                {/* Content */}
                <div className="flex-1 min-w-0">
                  {/* Top row: type badge + date */}
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${badgeColor}`}
                    >
                      {typeLabel}
                    </span>
                    <span className="text-xs text-gray-400">
                      {formatDate(notification.createdAt)}
                    </span>
                    {isUnread && (
                      <span className="inline-block h-2 w-2 rounded-full bg-blue-500" aria-label="Não lida" />
                    )}
                  </div>

                  {/* Title */}
                  <p
                    className={[
                      'text-sm',
                      isUnread
                        ? 'font-semibold text-gray-900'
                        : 'font-normal text-gray-700',
                    ].join(' ')}
                  >
                    {notification.title}
                  </p>

                  {/* Body */}
                  <p className="text-sm text-gray-500 mt-0.5 line-clamp-2">
                    {notification.body}
                  </p>
                </div>

                {/* "Mark as read" action */}
                {isUnread && (
                  <div className="flex-shrink-0 self-start pt-0.5">
                    <button
                      onClick={() => markAsRead(notification.id)}
                      disabled={isPending}
                      className="text-xs text-blue-600 hover:text-blue-800 font-medium whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      aria-label={`Marcar "${notification.title}" como lida`}
                    >
                      Marcar como lida
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
