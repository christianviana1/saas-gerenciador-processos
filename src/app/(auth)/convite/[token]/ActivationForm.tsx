/**
 * ActivationForm — Client Component for the invitation activation page.
 *
 * Renders:
 *  - Full-name input
 *  - Password input (with policy hint)
 *  - Confirm-password input
 *  - Explicit consent checkbox (Req 13.1, 13.2)
 *  - Submit button
 *
 * Connects to `activateAction` (Server Action) via `useActionState`.
 *
 * Requirements: 4.5, 13.1, 13.2
 */

'use client';

import { useFormState } from 'react-dom';
import type { ActivateFormState } from './actions';

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

interface ActivationFormProps {
  /** `activateAction` pre-bound with the invitation token (server-side). */
  boundAction: (
    prevState: ActivateFormState,
    formData: FormData,
  ) => Promise<ActivateFormState>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const inputClass = [
  'block w-full rounded-md border px-3 py-2.5 text-sm text-slate-900',
  'placeholder:text-slate-400',
  'focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent',
  'disabled:cursor-not-allowed disabled:opacity-50',
].join(' ');

const inputBorderDefault = 'border-slate-300';
const inputBorderError   = 'border-red-400';

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function ActivationForm({ boundAction }: ActivationFormProps) {
  const [state, formAction, isPending] = useFormState<ActivateFormState, FormData>(
    boundAction,
    {},
  );

  const fe = state.fieldErrors ?? {};

  return (
    <form action={formAction} noValidate className="space-y-5">
      {/* ── Global error banner ──────────────────────────────────────── */}
      {state.error && (
        <div
          id="form-error"
          role="alert"
          aria-live="assertive"
          className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {state.error}
        </div>
      )}

      {/* ── Full name ───────────────────────────────────────────────── */}
      <div className="space-y-1.5">
        <label htmlFor="name" className="block text-sm font-medium text-slate-700">
          Nome completo
        </label>
        <input
          id="name"
          name="name"
          type="text"
          autoComplete="name"
          required
          disabled={isPending}
          placeholder="Seu nome completo"
          aria-describedby={fe.name ? 'name-error' : undefined}
          className={`${inputClass} ${fe.name ? inputBorderError : inputBorderDefault}`}
        />
        {fe.name && (
          <p id="name-error" role="alert" className="text-xs text-red-600">
            {fe.name[0]}
          </p>
        )}
      </div>

      {/* ── Password ────────────────────────────────────────────────── */}
      <div className="space-y-1.5">
        <label htmlFor="password" className="block text-sm font-medium text-slate-700">
          Senha
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          disabled={isPending}
          placeholder="Mínimo 12 caracteres"
          aria-describedby="password-hint"
          className={`${inputClass} ${fe.password ? inputBorderError : inputBorderDefault}`}
        />
        {fe.password ? (
          <p id="password-hint" role="alert" className="text-xs text-red-600">
            {fe.password[0]}
          </p>
        ) : (
          <p id="password-hint" className="text-xs text-slate-400">
            Mínimo de 12 caracteres com letras maiúsculas, minúsculas, números e
            caracteres especiais.
          </p>
        )}
      </div>

      {/* ── Confirm password ────────────────────────────────────────── */}
      <div className="space-y-1.5">
        <label
          htmlFor="confirmPassword"
          className="block text-sm font-medium text-slate-700"
        >
          Confirmar senha
        </label>
        <input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          disabled={isPending}
          placeholder="Repita a senha"
          aria-describedby={fe.confirmPassword ? 'confirm-error' : undefined}
          className={`${inputClass} ${fe.confirmPassword ? inputBorderError : inputBorderDefault}`}
        />
        {fe.confirmPassword && (
          <p id="confirm-error" role="alert" className="text-xs text-red-600">
            {fe.confirmPassword[0]}
          </p>
        )}
      </div>

      {/* ── Explicit consent checkbox (Req 13.1, 13.2) ──────────────── */}
      <div className="flex items-start gap-3">
        <input
          id="consent"
          name="consent"
          type="checkbox"
          required
          disabled={isPending}
          className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-slate-900 cursor-pointer"
          aria-describedby={state.error ? 'form-error' : undefined}
        />
        <label htmlFor="consent" className="text-sm text-slate-600 cursor-pointer select-none">
          Li e aceito a{' '}
          <span className="font-medium text-slate-900">Política de Privacidade</span>
          {' '}e os{' '}
          <span className="font-medium text-slate-900">Termos de Uso</span>
          {' '}exibidos acima.
        </label>
      </div>

      {/* ── Submit ──────────────────────────────────────────────────── */}
      <button
        type="submit"
        disabled={isPending}
        aria-busy={isPending}
        className={[
          'w-full rounded-md bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white',
          'hover:bg-slate-800 active:bg-slate-950 transition-colors',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
          'focus-visible:outline-slate-900',
          'disabled:cursor-not-allowed disabled:opacity-60',
        ].join(' ')}
      >
        {isPending ? 'Ativando conta…' : 'Ativar conta'}
      </button>
    </form>
  );
}
