/**
 * LoginForm — Client Component for the login page.
 *
 * Renders a form with email + password fields and a conditional TOTP code
 * field that appears after Auth.js signals MFA_REQUIRED.
 *
 * Uses `useActionState` to bind to `loginAction` and reflect server state.
 *
 * Accessibility:
 *  - Each field has an associated <label> with `htmlFor`.
 *  - Error messages are linked via `aria-describedby`.
 *  - The submit button is disabled and shows a loading label while pending.
 *
 * Requirements: 5.1, 5.4
 */

'use client';

import { useFormState } from 'react-dom';
import { loginAction, type LoginState } from '@/modules/auth/actions/loginAction';

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function LoginForm() {
  const [state, formAction, isPending] = useFormState<LoginState, FormData>(
    loginAction,
    {},
  );

  return (
    <form action={formAction} noValidate className="space-y-5">
      {/* ── Global error banner ────────────────────────────────────────── */}
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

      {/* ── MFA prompt banner ──────────────────────────────────────────── */}
      {state.requiresMFA && !state.error && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
        >
          Insira o código de 6 dígitos do seu aplicativo autenticador para continuar.
        </div>
      )}

      {/* ── Email ──────────────────────────────────────────────────────── */}
      <div className="space-y-1.5">
        <label
          htmlFor="email"
          className="block text-sm font-medium text-slate-700"
        >
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          disabled={isPending}
          aria-describedby={state.error ? 'form-error' : undefined}
          placeholder="voce@escritorio.com.br"
          className={[
            'block w-full rounded-md border px-3 py-2.5 text-sm text-slate-900',
            'placeholder:text-slate-400',
            'focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent',
            'disabled:cursor-not-allowed disabled:opacity-50',
            'border-slate-300',
          ].join(' ')}
        />
      </div>

      {/* ── Password ───────────────────────────────────────────────────── */}
      <div className="space-y-1.5">
        <label
          htmlFor="password"
          className="block text-sm font-medium text-slate-700"
        >
          Senha
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          disabled={isPending}
          aria-describedby={state.error ? 'form-error' : undefined}
          placeholder="••••••••••••"
          className={[
            'block w-full rounded-md border px-3 py-2.5 text-sm text-slate-900',
            'placeholder:text-slate-400',
            'focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent',
            'disabled:cursor-not-allowed disabled:opacity-50',
            'border-slate-300',
          ].join(' ')}
        />
      </div>

      {/* ── TOTP code — shown only when MFA is required ────────────────── */}
      {state.requiresMFA && (
        <div className="space-y-1.5">
          <label
            htmlFor="totpCode"
            className="block text-sm font-medium text-slate-700"
          >
            Código de autenticação (MFA)
          </label>
          <input
            id="totpCode"
            name="totpCode"
            type="text"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            autoComplete="one-time-code"
            autoFocus
            required
            disabled={isPending}
            placeholder="000000"
            aria-describedby="totpCode-hint"
            className={[
              'block w-full rounded-md border px-3 py-2.5 text-center font-mono',
              'text-lg tracking-[0.4em] text-slate-900 placeholder:text-slate-300',
              'focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent',
              'disabled:cursor-not-allowed disabled:opacity-50',
              'border-slate-300',
            ].join(' ')}
          />
          <p id="totpCode-hint" className="text-xs text-slate-400">
            Digite o código de 6 dígitos gerado pelo seu aplicativo autenticador.
          </p>
        </div>
      )}

      {/* ── Submit ─────────────────────────────────────────────────────── */}
      <button
        type="submit"
        disabled={isPending}
        className={[
          'w-full rounded-md bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white',
          'hover:bg-slate-800 active:bg-slate-950 transition-colors',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
          'focus-visible:outline-slate-900',
          'disabled:cursor-not-allowed disabled:opacity-60',
        ].join(' ')}
        aria-busy={isPending}
      >
        {isPending
          ? 'Entrando…'
          : state.requiresMFA
            ? 'Verificar e entrar'
            : 'Entrar'}
      </button>
    </form>
  );
}
