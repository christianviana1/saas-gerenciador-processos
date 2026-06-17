/**
 * POST /api/usuarios/mfa/confirm
 *
 * Confirms TOTP-based MFA setup for the authenticated user.
 * Expects a JSON body with { totpCode: string }.
 * On success, sets mfaEnabled = true and returns 200.
 *
 * Requirements: 5.4, 12.8
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth }                       from '@/auth';
import { setupMFAUseCase }            from '@/application/auth/SetupMFAUseCase';
import { NotFoundError, ValidationError } from '@/shared/errors/AppError';

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Require an active session
  const session = await auth();
  if (!session?.user?.userId) {
    return NextResponse.json(
      { code: 'UNAUTHORIZED', message: 'Autenticação necessária.' },
      { status: 401 },
    );
  }

  const { userId, tenantId } = session.user;

  // Parse and validate request body
  let totpCode: string;
  try {
    const body = await request.json() as { totpCode?: unknown };
    totpCode = typeof body.totpCode === 'string' ? body.totpCode.trim() : '';
  } catch {
    return NextResponse.json(
      { code: 'VALIDATION_ERROR', message: 'Corpo da requisição inválido ou ausente.' },
      { status: 400 },
    );
  }

  if (!/^\d{6}$/.test(totpCode)) {
    return NextResponse.json(
      { code: 'VALIDATION_ERROR', message: 'O código TOTP deve conter exatamente 6 dígitos numéricos.' },
      { status: 400 },
    );
  }

  try {
    await setupMFAUseCase.confirmMFA(userId, tenantId, totpCode);

    return NextResponse.json(
      { data: { mfaEnabled: true } },
      { status: 200 },
    );
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json(
        { code: 'MFA_INVALID_CODE', message: err.message },
        { status: 422 },
      );
    }

    if (err instanceof NotFoundError) {
      return NextResponse.json(
        { code: 'NOT_FOUND', message: err.message },
        { status: 404 },
      );
    }

    console.error('[POST /api/usuarios/mfa/confirm] Unexpected error:', err);
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Erro interno do servidor.' },
      { status: 500 },
    );
  }
}
