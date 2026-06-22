/**
 * Novo Processo — Formulário de criação de processo judicial.
 *
 * Client Component com validação Zod client-side.
 * Submete via POST /api/processos e redireciona ao processo criado.
 *
 * Campos: número CNJ, nome do cliente, classe processual, assunto,
 *         descrição (opcional), tags (opcional), responsáveis (UUIDs, opcional na UI)
 *
 * Requirements: 6.1, 6.2, 6.3, 8.4
 */

'use client';
export const dynamic = 'force-dynamic';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// Zod schema — espelha o CreateProcessSchema da API
// ─────────────────────────────────────────────────────────────────────────────

/** CNJ pattern: NNNNNNN-DD.AAAA.J.TT.OOOO (Requirement 6.1) */
const CNJ_PATTERN = /^\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}$/;

const CreateProcessFormSchema = z.object({
  cnjNumber: z
    .string()
    .min(1, 'Número CNJ é obrigatório')
    .regex(
      CNJ_PATTERN,
      'Número CNJ inválido. Formato esperado: NNNNNNN-DD.AAAA.J.TT.OOOO (ex.: 0000001-01.2024.8.26.0001)',
    ),
  clientName: z
    .string()
    .min(1, 'Nome do cliente é obrigatório')
    .max(255, 'Nome do cliente deve ter no máximo 255 caracteres'),
  processClass: z
    .string()
    .min(1, 'Classe processual é obrigatória')
    .max(255, 'Classe processual deve ter no máximo 255 caracteres'),
  subject: z
    .string()
    .min(1, 'Assunto é obrigatório')
    .max(500, 'Assunto deve ter no máximo 500 caracteres'),
  description: z.string().max(5000).optional(),
  tagsRaw: z.string().optional(), // comma-separated string, parsed below
});

type FormValues = z.infer<typeof CreateProcessFormSchema>;
type FieldErrors = Partial<Record<keyof FormValues, string>>;

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function NovoProcessoPage() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Form state
  const [values, setValues] = useState<FormValues>({
    cnjNumber: '',
    clientName: '',
    processClass: '',
    subject: '',
    description: '',
    tagsRaw: '',
  });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);

  // ── Field change handler ───────────────────────────────────────────────────
  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) {
    const { name, value } = e.target;
    setValues((prev) => ({ ...prev, [name]: value }));
    // Clear field error on change
    if (fieldErrors[name as keyof FieldErrors]) {
      setFieldErrors((prev) => ({ ...prev, [name]: undefined }));
    }
  }

  // ── Submit handler ─────────────────────────────────────────────────────────
  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setServerError(null);

    // Client-side validation
    const parsed = CreateProcessFormSchema.safeParse(values);
    if (!parsed.success) {
      const errors: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as keyof FieldErrors;
        if (field && !errors[field]) {
          errors[field] = issue.message;
        }
      }
      setFieldErrors(errors);
      return;
    }

    const { tagsRaw, ...rest } = parsed.data;
    const tags = tagsRaw
      ? tagsRaw
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
      : [];

    startTransition(async () => {
      try {
        const response = await fetch('/api/processos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...rest,
            tags: tags.length > 0 ? tags : undefined,
            // Temporary: use session user as the single responsible user.
            // In a full implementation, a user-picker component would populate this.
            responsibleUserIds: [],
          }),
        });

        if (!response.ok) {
          const payload = (await response.json()) as {
            code?: string;
            message?: string;
            details?: Record<string, string[]>;
          };

          if (payload.code === 'VALIDATION_ERROR' && payload.details) {
            const errors: FieldErrors = {};
            for (const [field, msgs] of Object.entries(payload.details)) {
              errors[field as keyof FieldErrors] = Array.isArray(msgs)
                ? msgs[0]
                : String(msgs);
            }
            setFieldErrors(errors);
            return;
          }

          setServerError(
            payload.message ?? `Erro ao criar processo (HTTP ${response.status})`,
          );
          return;
        }

        const { data } = (await response.json()) as { data: { id: string } };
        router.push(`/processos/${data.id}`);
      } catch {
        setServerError(
          'Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.',
        );
      }
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Render helpers
  // ─────────────────────────────────────────────────────────────────────────

  function inputClass(hasError: boolean) {
    return [
      'block w-full rounded-md border px-3 py-2.5 text-sm text-gray-900',
      'placeholder:text-gray-400',
      'focus:outline-none focus:ring-2 focus:ring-offset-0',
      'disabled:cursor-not-allowed disabled:opacity-50',
      hasError
        ? 'border-red-400 focus:ring-red-400 focus:border-red-400 bg-red-50'
        : 'border-gray-300 focus:ring-blue-500 focus:border-blue-500',
    ].join(' ');
  }

  function labelClass() {
    return 'block text-sm font-medium text-gray-700 mb-1';
  }

  function errorClass() {
    return 'mt-1 text-xs text-red-600';
  }

  // ─────────────────────────────────────────────────────────────────────────
  // JSX
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-2xl mx-auto">
      {/* Breadcrumb */}
      <nav className="text-sm text-gray-500 mb-6" aria-label="Breadcrumb">
        <a href="/processos" className="hover:text-gray-700">
          Processos
        </a>
        <span className="mx-2" aria-hidden="true">/</span>
        <span className="text-gray-900 font-medium">Novo processo</span>
      </nav>

      {/* Cabeçalho */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Novo processo</h1>
        <p className="text-sm text-gray-500 mt-1">
          Preencha os dados abaixo para cadastrar um novo processo judicial.
        </p>
      </div>

      {/* Erro de servidor */}
      {serverError && (
        <div
          role="alert"
          aria-live="assertive"
          className="mb-6 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {serverError}
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        noValidate
        aria-label="Formulário de criação de processo"
        className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 space-y-6"
      >
        {/* Número CNJ */}
        <div>
          <label htmlFor="cnjNumber" className={labelClass()}>
            Número CNJ{' '}
            <span className="text-red-500" aria-hidden="true">*</span>
          </label>
          <input
            id="cnjNumber"
            name="cnjNumber"
            type="text"
            required
            value={values.cnjNumber}
            onChange={handleChange}
            disabled={isPending}
            placeholder="0000001-01.2024.8.26.0001"
            className={inputClass(!!fieldErrors.cnjNumber)}
            aria-describedby={fieldErrors.cnjNumber ? 'cnjNumber-error' : 'cnjNumber-hint'}
            aria-invalid={!!fieldErrors.cnjNumber}
          />
          <p id="cnjNumber-hint" className="mt-1 text-xs text-gray-500">
            Formato: NNNNNNN-DD.AAAA.J.TT.OOOO
          </p>
          {fieldErrors.cnjNumber && (
            <p id="cnjNumber-error" role="alert" className={errorClass()}>
              {fieldErrors.cnjNumber}
            </p>
          )}
        </div>

        {/* Nome do cliente */}
        <div>
          <label htmlFor="clientName" className={labelClass()}>
            Nome do cliente{' '}
            <span className="text-red-500" aria-hidden="true">*</span>
          </label>
          <input
            id="clientName"
            name="clientName"
            type="text"
            required
            value={values.clientName}
            onChange={handleChange}
            disabled={isPending}
            placeholder="Ex.: João da Silva"
            className={inputClass(!!fieldErrors.clientName)}
            aria-describedby={fieldErrors.clientName ? 'clientName-error' : undefined}
            aria-invalid={!!fieldErrors.clientName}
          />
          {fieldErrors.clientName && (
            <p id="clientName-error" role="alert" className={errorClass()}>
              {fieldErrors.clientName}
            </p>
          )}
        </div>

        {/* Classe processual */}
        <div>
          <label htmlFor="processClass" className={labelClass()}>
            Classe processual{' '}
            <span className="text-red-500" aria-hidden="true">*</span>
          </label>
          <input
            id="processClass"
            name="processClass"
            type="text"
            required
            value={values.processClass}
            onChange={handleChange}
            disabled={isPending}
            placeholder="Ex.: Ação de Indenização"
            className={inputClass(!!fieldErrors.processClass)}
            aria-describedby={fieldErrors.processClass ? 'processClass-error' : undefined}
            aria-invalid={!!fieldErrors.processClass}
          />
          {fieldErrors.processClass && (
            <p id="processClass-error" role="alert" className={errorClass()}>
              {fieldErrors.processClass}
            </p>
          )}
        </div>

        {/* Assunto */}
        <div>
          <label htmlFor="subject" className={labelClass()}>
            Assunto{' '}
            <span className="text-red-500" aria-hidden="true">*</span>
          </label>
          <input
            id="subject"
            name="subject"
            type="text"
            required
            value={values.subject}
            onChange={handleChange}
            disabled={isPending}
            placeholder="Ex.: Dano Moral"
            className={inputClass(!!fieldErrors.subject)}
            aria-describedby={fieldErrors.subject ? 'subject-error' : undefined}
            aria-invalid={!!fieldErrors.subject}
          />
          {fieldErrors.subject && (
            <p id="subject-error" role="alert" className={errorClass()}>
              {fieldErrors.subject}
            </p>
          )}
        </div>

        {/* Descrição (opcional) */}
        <div>
          <label htmlFor="description" className={labelClass()}>
            Descrição{' '}
            <span className="text-xs text-gray-400 font-normal">(opcional)</span>
          </label>
          <textarea
            id="description"
            name="description"
            rows={4}
            value={values.description ?? ''}
            onChange={handleChange}
            disabled={isPending}
            placeholder="Descreva detalhes relevantes do processo…"
            className={inputClass(!!fieldErrors.description)}
            aria-describedby={fieldErrors.description ? 'description-error' : undefined}
            aria-invalid={!!fieldErrors.description}
          />
          {fieldErrors.description && (
            <p id="description-error" role="alert" className={errorClass()}>
              {fieldErrors.description}
            </p>
          )}
        </div>

        {/* Tags (opcional) */}
        <div>
          <label htmlFor="tagsRaw" className={labelClass()}>
            Tags{' '}
            <span className="text-xs text-gray-400 font-normal">(opcional)</span>
          </label>
          <input
            id="tagsRaw"
            name="tagsRaw"
            type="text"
            value={values.tagsRaw ?? ''}
            onChange={handleChange}
            disabled={isPending}
            placeholder="Ex.: trabalhista, urgente, recurso"
            className={inputClass(!!fieldErrors.tagsRaw)}
            aria-describedby="tagsRaw-hint"
          />
          <p id="tagsRaw-hint" className="mt-1 text-xs text-gray-500">
            Separe múltiplas tags com vírgula.
          </p>
        </div>

        {/* Aviso sobre responsáveis */}
        <div className="rounded-md bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-700">
          Os usuários responsáveis poderão ser atribuídos após a criação do processo.
        </div>

        {/* Ações */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <a
            href="/processos"
            className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-50 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2"
          >
            Cancelar
          </a>
          <button
            type="submit"
            disabled={isPending}
            aria-busy={isPending}
            className="px-6 py-2 bg-blue-600 text-white text-sm font-semibold rounded-md hover:bg-blue-700 active:bg-blue-800 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isPending ? 'Salvando…' : 'Criar processo'}
          </button>
        </div>
      </form>
    </div>
  );
}
