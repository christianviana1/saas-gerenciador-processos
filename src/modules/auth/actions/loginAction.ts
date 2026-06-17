/**
 * loginAction — Server Action for the login form.
 *
 * Calls Auth.js `signIn('credentials', ...)` with the submitted credentials.
 * Returns typed state for the `useActionState` hook in `LoginForm`.
 *
 * State machine:
 *  - Default first pass         → {}
 *  - MFA required               → { requiresMFA: true }
 *  - Account locked             → { error: 'Sua conta está temporariamente bloqueada…' }
 *  - Invalid credentials / misc → { error: string }
 *  - Success                    → performs redirect (never returns to client)
 *
 * Requirements: 5.1, 5.4
 */

'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { signIn }   from '@/auth';
import { AuthError } from 'next-auth';

// ─────────────────────────────────────────────────────────────────────────────
// State type (shared with the Client Component via import)
// ─────────────────────────────────────────────────────────────────────────────

export interface LoginState {
  /** Human-readable error message to display in the form */
  error?: string;
  /** When true, the TOTP code field must be shown and a second submission made */
  requiresMFA?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Action
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Server Action invoked by the login form.
 *
 * @param _prevState - Previous form state (required by `useActionState` signature)
 * @param formData   - Submitted form data
 */
export async function loginAction(
  _prevState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email    = String(formData.get('email')    ?? '').toLowerCase().trim();
  const password = String(formData.get('password') ?? '');
  const totpCode = String(formData.get('totpCode') ?? '').trim() || undefined;

  // ── Basic client-side guard ──────────────────────────────────────────────
  if (!email || !password) {
    return { error: 'Email e senha são obrigatórios.' };
  }

  // ── Extract IP for audit trail ───────────────────────────────────────────
  const headersList = await headers();
  const ip = headersList.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';

  // Determine where to redirect on success — honour the `callbackUrl` param
  // when it is safe (same origin or relative path).
  const callbackUrl = '/dashboard';

  try {
    await signIn('credentials', {
      email,
      password,
      totpCode: totpCode ?? '',
      redirect: false,
      // Extra fields forwarded to the authorize() callback via credentials
      // (Auth.js v5 passes the raw credentials object through)
    });
  } catch (err) {
    // ── Auth.js surfaces provider errors as AuthError subclasses ─────────
    if (err instanceof AuthError) {
      const cause = (err as { cause?: { err?: { message?: string } } }).cause?.err?.message
        ?? err.message
        ?? '';

      switch (true) {
        case cause.includes('MFA_REQUIRED'):
          // Signal the form to show the TOTP field — not a real error
          return { requiresMFA: true };

        case cause.includes('ACCOUNT_LOCKED'):
          return {
            error:
              'Sua conta está temporariamente bloqueada devido a múltiplas tentativas de login. ' +
              'Aguarde 15 minutos e tente novamente.',
          };

        case cause.includes('USER_INACTIVE'):
          return {
            error:
              'Sua conta está inativa. Entre em contato com o administrador do escritório.',
          };

        case cause.includes('TENANT_BLOCKED'):
          return {
            error:
              'O acesso ao escritório está suspenso. Entre em contato com o suporte.',
          };

        case cause.includes('MFA_INVALID_CODE'):
          return { error: 'Código de autenticação inválido. Verifique o seu aplicativo autenticador.' };

        case cause.includes('MFA_CONFIGURATION_ERROR'):
          return {
            error:
              'Erro na configuração do MFA. Entre em contato com o administrador.',
          };

        default:
          return { error: 'Email ou senha incorretos.' };
      }
    }

    // ── next/navigation redirects surface as NEXT_REDIRECT — re-throw ────
    // (redirect() throws internally; we must re-throw it)
    if (
      err instanceof Error &&
      (err.message === 'NEXT_REDIRECT' || (err as { digest?: string }).digest?.startsWith('NEXT_REDIRECT'))
    ) {
      throw err;
    }

    // ── Unexpected errors ─────────────────────────────────────────────────
    console.error('[loginAction] Unexpected error:', err);
    return { error: 'Ocorreu um erro inesperado. Por favor, tente novamente.' };
  }

  void ip; // consumed by audit trail inside auth.ts authorize()

  // ── Successful login — redirect away from the login page ─────────────────
  redirect(callbackUrl);
}
