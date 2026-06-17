/**
 * MFASetupForm — Client Component for TOTP verification during MFA setup.
 *
 * Renders an input for the 6-digit code and a submit button.
 * The Server Action `confirmMFAAction` is called on form submission.
 *
 * Requirements: 5.4, 12.8
 */

'use client';

import { useFormState }  from 'react-dom';
import { confirmMFAAction } from './actions';

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

interface MFASetupFormProps {
  userId:   string;
  tenantId: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Form state type (returned by the Server Action)
// ─────────────────────────────────────────────────────────────────────────────

interface FormState {
  error?:   string;
  success?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function MFASetupForm({ userId, tenantId }: MFASetupFormProps) {
  // Bind the action so it always receives the userId & tenantId
  const boundAction = confirmMFAAction.bind(null, userId, tenantId);

  const [state, formAction, isPending] = useFormState<FormState, FormData>(
    boundAction,
    {},
  );

  if (state.success) {
    return (
      <div
        role="alert"
        className="rounded-md bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-800"
      >
        <strong className="font-medium">MFA ativado com sucesso!</strong>
        <br />
        A autenticação de dois fatores está agora habilitada para a sua conta.
        <br />
        <a
          href="/login"
          className="mt-2 inline-block font-medium text-green-700 underline underline-offset-2"
        >
          Ir para o login
        </a>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      {/* Error message */}
      {state.error && (
        <div
          role="alert"
          className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700"
        >
          {state.error}
        </div>
      )}

      {/* TOTP code input */}
      <div className="space-y-1.5">
        <label
          htmlFor="totpCode"
          className="block text-sm font-medium text-slate-700"
        >
          Código de verificação
        </label>
        <input
          id="totpCode"
          name="totpCode"
          type="text"
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={6}
          required
          autoComplete="one-time-code"
          placeholder="000000"
          className={[
            'block w-full rounded-md border px-3 py-2.5 text-center font-mono',
            'text-lg tracking-[0.4em] text-slate-900 placeholder:text-slate-300',
            'focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent',
            'disabled:cursor-not-allowed disabled:opacity-50',
            'border-slate-300',
          ].join(' ')}
          disabled={isPending}
          aria-describedby="totpCode-hint"
        />
        <p id="totpCode-hint" className="text-xs text-slate-400">
          Digite o código de 6 dígitos gerado pelo seu aplicativo autenticador.
        </p>
      </div>

      {/* Submit button */}
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
      >
        {isPending ? 'Verificando…' : 'Confirmar e ativar MFA'}
      </button>
    </form>
  );
}
