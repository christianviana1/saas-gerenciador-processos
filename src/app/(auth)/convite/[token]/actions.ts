/**
 * Server Actions for the invitation activation page.
 *
 * `activateAction` — receives the activation form data (name, password,
 * confirmPassword, consent), delegates to `activateUserUseCase.execute()`,
 * and on success redirects to `/login?activated=true`.
 *
 * Requirements: 4.3, 4.4, 4.5, 4.6, 13.1, 13.2
 */

'use server';

import { redirect }           from 'next/navigation';
import { headers }            from 'next/headers';
import { activateUserUseCase } from '@/application/usuarios/ActivateUserUseCase';
import { ValidationError }    from '@/shared/errors';
import { POLICY_VERSION, type ActivateFormState } from './constants';

export type { ActivateFormState } from './constants';

// ─────────────────────────────────────────────────────────────────────────────
// Action
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Activates a user account from the invitation link.
 *
 * This action is bound to the `token` in the Server Component before being
 * passed to the Client Component, so the token is server-side only.
 *
 * @param token      - Bound at call site in the Server Component.
 * @param _prevState - Previous form state (required by `useActionState`).
 * @param formData   - Submitted form data.
 */
export async function activateAction(
  token: string,
  _prevState: ActivateFormState,
  formData: FormData,
): Promise<ActivateFormState> {
  const name            = String(formData.get('name')            ?? '').trim();
  const password        = String(formData.get('password')        ?? '');
  const confirmPassword = String(formData.get('confirmPassword') ?? '');
  const consent         = formData.get('consent') === 'on';

  // ── Client-side guard replicated server-side ────────────────────────────
  if (!consent) {
    return {
      error: 'Você deve aceitar a Política de Privacidade e os Termos de Uso para continuar.',
    };
  }

  if (password !== confirmPassword) {
    return {
      fieldErrors: {
        confirmPassword: ['As senhas não conferem.'],
      },
    };
  }

  // ── Collect request metadata for LGPD record ────────────────────────────
  const headersList = await headers();
  const ipAddress   =
    headersList.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    headersList.get('x-real-ip') ??
    'unknown';
  const userAgent = headersList.get('user-agent') ?? 'unknown';

  // ── Delegate to Use Case ─────────────────────────────────────────────────
  try {
    await activateUserUseCase.execute({
      token,
      name,
      password,
      ipAddress,
      userAgent,
      policyVersion: POLICY_VERSION,
    });
  } catch (err) {
    if (err instanceof ValidationError) {
      const fieldErrors = (err.details as { fieldErrors?: Record<string, string[]> })
        ?.fieldErrors;
      if (fieldErrors) {
        return { fieldErrors };
      }
      return { error: err.message };
    }

    // Unexpected error — do not leak internals
    console.error('[activateAction] Unexpected error:', err);
    return {
      error: 'Ocorreu um erro inesperado ao ativar a conta. Por favor, tente novamente.',
    };
  }

  // ── Success: redirect to login with feedback flag ─────────────────────
  redirect('/login?activated=true');
}
