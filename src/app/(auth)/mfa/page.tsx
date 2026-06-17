/**
 * MFA Setup Page — `src/app/(auth)/mfa/page.tsx`
 *
 * Renders the TOTP setup flow:
 *  1. Calls `SetupMFAUseCase.initMFA()` to generate a fresh secret.
 *  2. Uses the `qrcode` package to produce a data-URL image from the otpauth URI.
 *  3. Displays the QR code and the plain-text secret (for manual entry).
 *  4. Accepts a 6-digit TOTP code via a form, which submits to the
 *     `confirmMFAAction` Server Action that calls `SetupMFAUseCase.confirmMFA()`.
 *
 * Requirements: 5.4, 12.8
 */

import { redirect }           from 'next/navigation';
import { auth }               from '@/auth';
import { setupMFAUseCase }    from '@/application/auth/SetupMFAUseCase';
import QRCode                 from 'qrcode';
import MFASetupForm           from './MFASetupForm';

// ─────────────────────────────────────────────────────────────────────────────
// Page — Server Component
// ─────────────────────────────────────────────────────────────────────────────

export default async function MFASetupPage() {
  // Require an active session
  const session = await auth();
  if (!session?.user?.userId) {
    redirect('/login');
  }

  const { userId, tenantId } = session.user;

  // Initialise MFA — generates (or regenerates) the TOTP secret and returns
  // the plaintext secret + qrUri.  mfaEnabled is NOT set yet.
  const { qrUri, secret } = await setupMFAUseCase.initMFA(userId, tenantId);

  // Render the QR code as a data-URL image (server-side, no external requests)
  const qrDataUrl = await QRCode.toDataURL(qrUri, {
    width: 240,
    margin: 2,
    errorCorrectionLevel: 'M',
    color: { dark: '#0f172a', light: '#ffffff' },
  });

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-sm">
        {/* Card header */}
        <div className="border-b border-slate-100 px-8 py-6">
          <h1 className="text-xl font-semibold text-slate-900">
            Configurar autenticação de dois fatores
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Escaneie o QR code com o seu aplicativo autenticador (Google
            Authenticator, Authy etc.) e insira o código gerado para confirmar a
            configuração.
          </p>
        </div>

        {/* Card content */}
        <div className="px-8 py-6 space-y-6">
          {/* QR Code */}
          <div className="flex flex-col items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qrDataUrl}
              alt="QR code para configurar o autenticador TOTP"
              width={240}
              height={240}
              className="rounded-lg border border-slate-200"
            />
            <p className="text-xs text-slate-400 text-center">
              Não consegue escanear? Use a chave manual abaixo.
            </p>
          </div>

          {/* Manual entry secret */}
          <div>
            <p className="mb-1 text-xs font-medium text-slate-600 uppercase tracking-wide">
              Chave de configuração manual
            </p>
            <code className="block w-full rounded-md bg-slate-100 px-4 py-2 text-center font-mono text-sm text-slate-800 break-all select-all">
              {secret}
            </code>
          </div>

          {/* Verification form (Client Component) */}
          <MFASetupForm userId={userId} tenantId={tenantId} />
        </div>
      </div>
    </div>
  );
}
