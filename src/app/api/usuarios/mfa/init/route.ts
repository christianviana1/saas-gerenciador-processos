/**
 * POST /api/usuarios/mfa/init
 *
 * Initialises TOTP-based MFA for the authenticated user.
 * Returns { qrUri, secret } — the secret is used to generate TOTP codes
 * and to build the QR code URI; it must not be stored by the client.
 *
 * Requirements: 5.4, 12.8
 */

import { NextResponse }       from 'next/server';
import { auth }               from '@/auth';
import { setupMFAUseCase }    from '@/application/auth/SetupMFAUseCase';
import { NotFoundError }      from '@/shared/errors/AppError';

export async function POST(): Promise<NextResponse> {
  // Require an active session
  const session = await auth();
  if (!session?.user?.userId) {
    return NextResponse.json(
      { code: 'UNAUTHORIZED', message: 'Autenticação necessária.' },
      { status: 401 },
    );
  }

  const { userId, tenantId } = session.user;

  try {
    const result = await setupMFAUseCase.initMFA(userId, tenantId);

    return NextResponse.json(
      { data: { qrUri: result.qrUri, secret: result.secret } },
      { status: 200 },
    );
  } catch (err) {
    if (err instanceof NotFoundError) {
      return NextResponse.json(
        { code: 'NOT_FOUND', message: err.message },
        { status: 404 },
      );
    }

    console.error('[POST /api/usuarios/mfa/init] Unexpected error:', err);
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Erro interno do servidor.' },
      { status: 500 },
    );
  }
}
