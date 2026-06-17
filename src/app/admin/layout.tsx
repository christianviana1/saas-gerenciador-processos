/**
 * Admin Layout — Protege todas as rotas /admin
 *
 * Verifica sessão e papel SUPER_ADMIN server-side.
 * Redireciona usuários não autorizados para /dashboard.
 *
 * Requirements: 1.4, 2.1
 */

import { redirect } from 'next/navigation';
import { auth } from '@/auth';

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  // Sem sessão → redireciona para login
  if (!session?.user) {
    redirect('/login');
  }

  // Somente SUPER_ADMIN pode acessar o painel administrativo (Requisito 1.4 / 2.1)
  if (session.user.role !== 'SUPER_ADMIN') {
    redirect('/dashboard');
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Barra de navegação administrativa */}
      <nav className="bg-gray-900 text-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-6">
              <span className="text-lg font-semibold tracking-tight">
                Painel Super Admin
              </span>
              <a
                href="/admin"
                className="text-sm text-gray-300 hover:text-white transition-colors"
              >
                Tenants
              </a>
            </div>
            <div className="text-sm text-gray-400">
              {session.user.email}
            </div>
          </div>
        </div>
      </nav>

      {/* Conteúdo da página */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
    </div>
  );
}
