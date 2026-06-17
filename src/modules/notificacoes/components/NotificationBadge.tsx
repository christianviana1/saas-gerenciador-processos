'use client';

/**
 * NotificationBadge — Client Component
 *
 * Polls /api/notificacoes?unreadOnly=true every 30 seconds and displays
 * an unread notification count badge next to the bell icon.
 *
 * Requirements: 10.6
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';

export function NotificationBadge() {
  const [count, setCount] = useState(0);

  async function fetchUnread() {
    try {
      const res = await fetch('/api/notificacoes?unreadOnly=true', {
        // Don't cache — we always want fresh counts
        cache: 'no-store',
      });
      if (res.ok) {
        const data = await res.json();
        // API returns { total: number } or { data: [...], total: number }
        const unread = typeof data.total === 'number' ? data.total : 0;
        setCount(unread);
      }
    } catch {
      // Silent fail — badge stays at last known count
    }
  }

  useEffect(() => {
    // Immediate fetch on mount
    fetchUnread();

    // Poll every 30 seconds (Requirement 10.6)
    const interval = setInterval(fetchUnread, 30_000);

    return () => clearInterval(interval);
  }, []);

  return (
    <Link
      href="/notificacoes"
      className="relative inline-flex items-center p-2 rounded-md text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors"
      aria-label={`Notificações${count > 0 ? ` — ${count} não lida${count !== 1 ? 's' : ''}` : ''}`}
    >
      {/* Bell icon (inline SVG to avoid extra dependencies) */}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="h-5 w-5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>

      {/* Badge — only visible when count > 0 */}
      {count > 0 && (
        <span
          className="absolute top-0.5 right-0.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold leading-none"
          aria-hidden="true"
        >
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Link>
  );
}
