/**
 * LgpdActionButtons — Client Component
 *
 * Botões interativos para exportação de dados e solicitação de exclusão/anonimização
 * de cada usuário no painel LGPD.
 *
 * Requisitos: 13.3, 13.4, 13.8
 */

'use client';

import { useState, useTransition } from 'react';
import { exportUserDataAction, requestAnonymizationAction } from './actions';

interface LgpdActionButtonsProps {
  userId: string;
  userName: string;
}

export function LgpdActionButtons({ userId, userName }: LgpdActionButtonsProps) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null,
  );

  // ─── Exportar dados ───────────────────────────────────────────────────────

  function handleExport() {
    startTransition(async () => {
      setMessage(null);
      const result = await exportUserDataAction(userId);

      if (!result.ok) {
        setMessage({ type: 'error', text: result.error });
        return;
      }

      // Dispara o download do arquivo JSON no navegador
      const blob = new Blob([result.json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `dados-usuario-${userId}-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);

      setMessage({
        type: 'success',
        text: `Dados exportados com sucesso (${new Date(result.meta.exportedAt).toLocaleString('pt-BR')}).`,
      });
    });
  }

  // ─── Solicitar anonimização ───────────────────────────────────────────────

  function handleAnonymize() {
    const confirmed = window.confirm(
      `Tem certeza que deseja solicitar a exclusão/anonimização dos dados de "${userName}"?\n\nEsta ação é IRREVERSÍVEL: o nome, e-mail e informações de identificação serão permanentemente anonimizados e o acesso ao sistema será revogado.`,
    );

    if (!confirmed) return;

    startTransition(async () => {
      setMessage(null);
      const result = await requestAnonymizationAction(userId);

      if (!result.ok) {
        setMessage({ type: 'error', text: result.error });
        return;
      }

      setMessage({
        type: 'success',
        text: `Dados anonimizados com sucesso em ${new Date(result.anonymizedAt).toLocaleString('pt-BR')}.`,
      });
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Feedback inline */}
      {message && (
        <p
          className={`text-xs rounded px-2 py-1 ${
            message.type === 'success'
              ? 'bg-green-50 text-green-700 border border-green-200'
              : 'bg-red-50 text-red-700 border border-red-200'
          }`}
          role="status"
          aria-live="polite"
        >
          {message.text}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {/* Exportar dados */}
        <button
          type="button"
          onClick={handleExport}
          disabled={isPending}
          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md border border-blue-300 text-blue-700 bg-blue-50 hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          aria-label={`Exportar dados de ${userName}`}
        >
          {isPending ? (
            <span aria-hidden="true">⏳</span>
          ) : (
            <span aria-hidden="true">📥</span>
          )}
          Exportar dados
        </button>

        {/* Solicitar exclusão */}
        <button
          type="button"
          onClick={handleAnonymize}
          disabled={isPending}
          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md border border-red-300 text-red-700 bg-red-50 hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          aria-label={`Solicitar exclusão de conta de ${userName}`}
        >
          <span aria-hidden="true">🗑️</span>
          Solicitar exclusão de conta
        </button>
      </div>
    </div>
  );
}
