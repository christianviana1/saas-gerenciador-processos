/**
 * CreateTenantUseCase — Cria um novo tenant (escritório de advocacia) na plataforma.
 *
 * Fluxo:
 *  1. Verifica que o ator possui o papel SUPER_ADMIN (único que pode criar tenants)
 *  2. Valida o slug (formato único, letras minúsculas, dígitos e hífens)
 *  3. Verifica unicidade do slug no banco
 *  4. Persiste o Tenant via Prisma
 *  5. Enfileira evento de auditoria (fire-and-forget)
 *
 * Requisitos: 1.4, 3.1, 3.3
 */

import { prisma } from '@/infrastructure/database/prisma/client';
import { auditQueue } from '@/infrastructure/queues/queues';
import { ForbiddenError, ConflictError, ValidationError } from '@/shared/errors/AppError';
import { isValidTenantSlug } from '@/domain/entities/Tenant';
import type { TenantPlan } from '@/domain/entities/Tenant';
import type { Role } from '@/domain/services/RBACEngine';
import type { Tenant } from '@prisma/client';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateTenantInput {
  /** Nome do escritório / tenant */
  name: string;
  /** Slug único URL-safe (ex.: "costa-advogados") */
  slug: string;
  /** Plano de assinatura inicial (padrão: BASIC) */
  plan?: TenantPlan;
  /** Papel do ator que realiza a operação — deve ser SUPER_ADMIN */
  actorRole: Role;
  /** ID do ator (para trilha de auditoria) */
  actorUserId: string;
}

export type CreateTenantOutput = Tenant;

// ─────────────────────────────────────────────────────────────────────────────
// Use Case
// ─────────────────────────────────────────────────────────────────────────────

export class CreateTenantUseCase {
  /**
   * Executa a criação de um novo tenant.
   *
   * @throws {ForbiddenError}   quando o ator não é SUPER_ADMIN
   * @throws {ValidationError}  quando o slug é inválido
   * @throws {ConflictError}    quando o slug já está em uso
   */
  async execute(input: CreateTenantInput): Promise<CreateTenantOutput> {
    const { name, slug, plan = 'BASIC', actorRole, actorUserId } = input;

    // ── 1. Verificação de papel ──────────────────────────────────────────────
    // Somente SUPER_ADMIN pode criar tenants (Requisito 1.4)
    if (actorRole !== 'SUPER_ADMIN') {
      throw new ForbiddenError(
        'Somente Super Admin pode criar tenants.',
        { actorRole },
      );
    }

    // ── 2. Validação do slug ─────────────────────────────────────────────────
    const trimmedSlug = slug.trim().toLowerCase();
    if (!isValidTenantSlug(trimmedSlug)) {
      throw new ValidationError(
        'Slug inválido. Use apenas letras minúsculas, dígitos e hífens (3-100 caracteres, não pode começar ou terminar com hífen).',
        { slug },
      );
    }

    // ── 3. Verificar unicidade do slug ───────────────────────────────────────
    const existing = await prisma.tenant.findUnique({
      where: { slug: trimmedSlug },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictError(
        `Já existe um tenant com o slug '${trimmedSlug}'.`,
        { slug: trimmedSlug },
      );
    }

    // ── 4. Persistir tenant no banco ─────────────────────────────────────────
    const tenant = await prisma.tenant.create({
      data: {
        name: name.trim(),
        slug: trimmedSlug,
        plan,
        status: 'ACTIVE',
      },
    });

    // ── 5. Enfileirar evento de auditoria (fire-and-forget) ─────────────────
    // Requisito 3.1: registrar criação de tenant no Audit_Service
    // Requisito 3.3: latência adicional < 50ms — não aguardar
    void auditQueue.add('audit-create-tenant', {
      tenantId: tenant.id,
      userId: actorUserId,
      action: 'tenant:created',
      resourceType: 'Tenant',
      resourceId: tenant.id,
      ipAddress: '0.0.0.0',  // Sobrescrito pela camada de apresentação
      userAgent: 'server',   // Sobrescrito pela camada de apresentação
      payloadAfter: {
        name: tenant.name,
        slug: tenant.slug,
        plan: tenant.plan,
        status: tenant.status,
      },
    }).catch((err: unknown) => {
      console.error('[CreateTenantUseCase] Falha ao enfileirar evento de auditoria:', err);
    });

    return tenant;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton
// ─────────────────────────────────────────────────────────────────────────────

/** Singleton para uso na camada de aplicação. */
export const createTenantUseCase = new CreateTenantUseCase();
