/**
 * Server Actions for the MFA setup page.
 *
 * `confirmMFAAction` — receives the 6-digit TOTP code from the form, delegates
 * to `SetupMFAUseCase.confirmMFA()`, and returns a typed form state.
 *
 * Requirements: 5.4, 12.8
 */

'use server';

import { setupMFAUseCase } from '@/application/auth/SetupMFAUseCase';
import { ValidationError }  from '@/shared/errors/AppError';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface FormState {
  error?:   string;
  success?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Action
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Confirm MFA setup by validating the TOTP code the user entered.
 *
 * This function is bound to `userId` and `tenantId` before being passed to the
 * Client Component, so the browser never has direct access to those values.
 *
 * @param userId   - Bound at call site in the Server Component.
 * @param tenantId - Bound at call site in the Server Component.
 * @param _prevState - Previous form state (required by `useActionState`).
 * @param formData - Submitted form data containing the `totpCode` field.
 */
export async function confirmMFAAction(
  userId:    string,
  tenantId:  string,
  _prevState: FormState,
  formData:   FormData,
): Promise<FormState> {
  const totpCode = String(formData.get('totpCode') ?? '').trim();

  // Basic format guard — the pattern attribute in the input already handles
  // client-side validation, but we double-check server-side.
  if (!/^\d{6}$/.test(totpCode)) {
    return { error: 'O código deve conter exatamente 6 dígitos numéricos.' };
  }

  try {
    await setupMFAUseCase.confirmMFA(userId, tenantId, totpCode);
    return { success: true };
  } catch (err) {
    if (err instanceof ValidationError) {
      return { error: err.message };
    }

    // Unexpected error — do not leak internal details to the client
    console.error('[confirmMFAAction] Unexpected error:', err);
    return { error: 'Ocorreu um erro inesperado. Por favor, tente novamente.' };
  }
}
