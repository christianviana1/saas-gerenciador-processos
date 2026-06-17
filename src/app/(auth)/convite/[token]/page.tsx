/**
 * Invitation Activation Page — `src/app/(auth)/convite/[token]/page.tsx`
 *
 * Server Component that:
 *  1. Reads the `[token]` param from the URL.
 *  2. Validates the token against the database (not expired, not used, not revoked).
 *  3. On invalid token: shows an error card with instructions to contact the admin (Req 4.4).
 *  4. On valid token: shows:
 *       a. Privacy Policy summary in Portuguese (Req 13.2)
 *       b. Terms of Use summary in Portuguese (Req 13.2)
 *       c. `ActivationForm` Client Component (name, password, confirm, consent checkbox)
 *  5. `activateAction` (Server Action) is bound with the token before passing
 *     to the Client Component, keeping the token server-side only.
 *
 * Requirements: 4.3, 4.4, 4.5, 4.6, 13.1, 13.2
 */

import { Metadata }   from 'next';
import { prisma }     from '@/infrastructure/database/prisma/client';
import { activateAction } from './actions';
import { POLICY_VERSION } from './constants';
import ActivationForm from './ActivationForm';

// ─────────────────────────────────────────────────────────────────────────────
// Metadata
// ─────────────────────────────────────────────────────────────────────────────

export const metadata: Metadata = {
  title: 'Ativar Conta — Sistema Jurídico',
  description: 'Conclua o cadastro na Plataforma Jurídica SaaS.',
};

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

interface PageProps {
  params: Promise<{ token: string }>;
}

export default async function ConvitePage({ params }: PageProps) {
  const { token } = await params;

  // ── Step 1: Validate the token ──────────────────────────────────────────
  const now        = new Date();
  const invitation = await prisma.invitationToken.findFirst({
    where: {
      token,
      usedAt:    null,
      revokedAt: null,
      expiresAt: { gt: now },
    },
    select: {
      email:    true,
      tenantId: true,
    },
  });

  // ── Step 2: Invalid / expired token ─────────────────────────────────────
  if (!invitation) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-50 px-4 py-12">
        <div className="w-full max-w-md">
          <div className="rounded-2xl border border-red-200 bg-white shadow-sm">
            {/* Header */}
            <div className="border-b border-red-100 px-8 py-6">
              <div className="mb-4 flex justify-center">
                <span
                  className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-100 text-red-600 text-lg font-bold select-none"
                  aria-hidden="true"
                >
                  !
                </span>
              </div>
              <h1 className="text-center text-xl font-semibold text-slate-900">
                Link inválido ou expirado
              </h1>
            </div>

            {/* Body */}
            <div className="px-8 py-6 space-y-4 text-sm text-slate-600">
              <p>
                Este link de convite é inválido ou já expirou. Links de ativação
                são válidos por <strong className="font-medium text-slate-800">72 horas</strong>
                {' '}e podem ser usados apenas uma vez.
              </p>
              <p>
                Para receber um novo convite, entre em contato com o administrador
                do seu escritório.
              </p>
            </div>

            {/* Footer */}
            <div className="border-t border-slate-100 px-8 py-4">
              <a
                href="/login"
                className="block w-full rounded-md bg-slate-900 px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-slate-800 transition-colors"
              >
                Ir para o login
              </a>
            </div>
          </div>

          <p className="mt-6 text-center text-xs text-slate-400">
            Dúvidas?{' '}
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

  // ── Step 3: Valid token — bind the action with the token ─────────────────
  const boundActivateAction = activateAction.bind(null, token);

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-12">
      <div className="mx-auto w-full max-w-2xl space-y-6">

        {/* ── Brand / header ────────────────────────────────────────────── */}
        <div className="text-center">
          <span
            className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-slate-900 text-white text-xl font-bold select-none"
            aria-hidden="true"
          >
            J
          </span>
          <h1 className="mt-4 text-2xl font-semibold text-slate-900">
            Bem-vindo à Plataforma Jurídica
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Convite para:{' '}
            <span className="font-medium text-slate-700">{invitation.email}</span>
          </p>
        </div>

        {/* ── Privacy Policy ────────────────────────────────────────────── */}
        <section
          aria-labelledby="privacy-policy-heading"
          className="rounded-2xl border border-slate-200 bg-white shadow-sm"
        >
          <div className="border-b border-slate-100 px-6 py-4">
            <h2
              id="privacy-policy-heading"
              className="text-base font-semibold text-slate-900"
            >
              Política de Privacidade
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">Versão {POLICY_VERSION}</p>
          </div>

          <div className="px-6 py-4 space-y-3 text-sm text-slate-600 leading-relaxed">
            <p>
              <strong className="font-medium text-slate-800">1. Dados coletados.</strong>{' '}
              Coletamos dados pessoais fornecidos por você (nome, e-mail, senha) e dados
              de uso da plataforma (endereço IP, User-Agent, data e hora de acesso) para
              operar e proteger os serviços contratados pelo seu escritório.
            </p>
            <p>
              <strong className="font-medium text-slate-800">2. Finalidade do tratamento.</strong>{' '}
              Seus dados são usados para autenticação, controle de acesso, registro de
              auditoria, comunicações operacionais e conformidade com obrigações legais,
              incluindo a Lei Geral de Proteção de Dados (LGPD — Lei nº 13.709/2018).
            </p>
            <p>
              <strong className="font-medium text-slate-800">3. Base legal.</strong>{' '}
              O tratamento é realizado com base no seu consentimento expresso (art. 7º,
              I, LGPD) e na execução de contrato com o escritório ao qual você está
              vinculado (art. 7º, V, LGPD).
            </p>
            <p>
              <strong className="font-medium text-slate-800">4. Armazenamento e segurança.</strong>{' '}
              Senhas são armazenadas exclusivamente como hash Argon2id. Dados sensíveis
              em repouso são protegidos com AES-256. A plataforma não vende dados a
              terceiros.
            </p>
            <p>
              <strong className="font-medium text-slate-800">5. Direitos do titular.</strong>{' '}
              Você pode solicitar acesso, correção, exportação e exclusão dos seus dados
              pessoais a qualquer momento pelo painel da plataforma ou pelo e-mail
              privacidade@sistemajuridico.com.br.
            </p>
            <p>
              <strong className="font-medium text-slate-800">6. Retenção.</strong>{' '}
              Dados pessoais identificáveis são retidos pelo prazo necessário à
              prestação do serviço e excluídos em até 30 dias após solicitação de
              exclusão, respeitados os prazos legais de retenção de registros
              processuais.
            </p>
          </div>
        </section>

        {/* ── Terms of Use ──────────────────────────────────────────────── */}
        <section
          aria-labelledby="terms-heading"
          className="rounded-2xl border border-slate-200 bg-white shadow-sm"
        >
          <div className="border-b border-slate-100 px-6 py-4">
            <h2
              id="terms-heading"
              className="text-base font-semibold text-slate-900"
            >
              Termos de Uso
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">Versão {POLICY_VERSION}</p>
          </div>

          <div className="px-6 py-4 space-y-3 text-sm text-slate-600 leading-relaxed">
            <p>
              <strong className="font-medium text-slate-800">1. Aceitação.</strong>{' '}
              Ao ativar sua conta, você confirma que tem capacidade legal para celebrar
              este contrato e que utilizará a plataforma exclusivamente para fins
              profissionais lícitos relacionados à atividade jurídica do seu escritório.
            </p>
            <p>
              <strong className="font-medium text-slate-800">2. Responsabilidades do usuário.</strong>{' '}
              Você é responsável por manter suas credenciais em sigilo, por todas as
              ações realizadas com sua conta e por notificar imediatamente o administrador
              em caso de acesso não autorizado.
            </p>
            <p>
              <strong className="font-medium text-slate-800">3. Uso aceitável.</strong>{' '}
              É vedado utilizar a plataforma para armazenar conteúdo ilegal, realizar
              engenharia reversa, tentar burlar controles de segurança ou acessar dados
              de outros escritórios.
            </p>
            <p>
              <strong className="font-medium text-slate-800">4. Disponibilidade.</strong>{' '}
              A plataforma é fornecida com SLA definido no contrato do escritório.
              Manutenções programadas serão notificadas com antecedência mínima de 24 horas.
            </p>
            <p>
              <strong className="font-medium text-slate-800">5. Propriedade intelectual.</strong>{' '}
              O software, sua interface e código-fonte são propriedade exclusiva da
              desenvolvedora. O usuário recebe licença limitada, intransferível e
              revogável de uso.
            </p>
            <p>
              <strong className="font-medium text-slate-800">6. Vigência e rescisão.</strong>{' '}
              Estes termos vigoram enquanto sua conta estiver ativa. O administrador
              pode revogar seu acesso a qualquer momento, encerrando todos os direitos
              concedidos.
            </p>
          </div>
        </section>

        {/* ── Activation form card ──────────────────────────────────────── */}
        <section
          aria-labelledby="activation-heading"
          className="rounded-2xl border border-slate-200 bg-white shadow-sm"
        >
          <div className="border-b border-slate-100 px-6 py-4">
            <h2
              id="activation-heading"
              className="text-base font-semibold text-slate-900"
            >
              Criar sua conta
            </h2>
            <p className="mt-0.5 text-sm text-slate-500">
              Defina seu nome e senha para completar a ativação.
            </p>
          </div>

          <div className="px-6 py-6">
            <ActivationForm boundAction={boundActivateAction} />
          </div>
        </section>

        {/* ── Footer ────────────────────────────────────────────────────── */}
        <p className="text-center text-xs text-slate-400 pb-4">
          Problemas com o convite?{' '}
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
