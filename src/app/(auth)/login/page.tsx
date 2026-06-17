/**
 * Login Page — `src/app/(auth)/login/page.tsx`
 *
 * Server Component shell: renders a centred card layout and embeds the
 * `LoginForm` Client Component inside it.
 *
 * Registered as the custom sign-in page via `authConfig.pages.signIn = '/login'`
 * in `src/auth.ts`.
 *
 * Requirements: 5.1, 5.4
 */

import { Metadata } from 'next';
import LoginForm    from './LoginForm';

// ─────────────────────────────────────────────────────────────────────────────
// Metadata
// ─────────────────────────────────────────────────────────────────────────────

export const metadata: Metadata = {
  title: 'Entrar — Sistema Jurídico',
  description: 'Faça login na plataforma jurídica.',
};

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default function LoginPage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-md">
        {/* Card */}
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          {/* Card header */}
          <div className="border-b border-slate-100 px-8 py-6">
            {/* Logo / brand mark */}
            <div className="mb-4 flex justify-center">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 text-white text-lg font-bold select-none">
                J
              </span>
            </div>
            <h1 className="text-center text-xl font-semibold text-slate-900">
              Acesse sua conta
            </h1>
            <p className="mt-1 text-center text-sm text-slate-500">
              Plataforma Jurídica SaaS
            </p>
          </div>

          {/* Card body */}
          <div className="px-8 py-6">
            <LoginForm />
          </div>
        </div>

        {/* Footer note */}
        <p className="mt-6 text-center text-xs text-slate-400">
          Problemas para acessar?{' '}
          <a
            href="mailto:suporte@sistemajuridico.com.br"
            className="font-medium text-slate-600 underline underline-offset-2 hover:text-slate-900 transition-colors"
          >
            Entre em contato com o suporte
          </a>
          .
        </p>
      </div>
    </main>
  );
}
