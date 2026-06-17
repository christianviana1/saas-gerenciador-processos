/**
 * InviteUserUseCase — Convida um novo usuário para um tenant via email.
 *
 * Fluxo:
 *  1. Verifica permissão RBAC (user:invite) do ator — lança ForbiddenError se negado
 *  2. Verifica se o email já está ativo no tenant — lança ConflictError se duplicado
 *  3. Verifica se já existe convite pendente (não expirado, não usado, não revogado)
 *  4. Gera token criptograficamente seguro via TokenGenerator
 *  5. Persiste InvitationToken no banco com expiresAt = now + 72h
 *  6. Enfileira job de email (template 'invitation') via emailQueue
 *  7. Enfileira evento de auditoria via auditQueue
 *
 * Requisitos: 4.1, 4.2, 4.7
 */

import { prisma } from '@/infrastructure/database/prisma/client';
import { rbacEngine } from '@/domain/services/RBACEngine';
import { tokenGenerator } from '@/domain/services/TokenGenerator';
import { emailQueue, auditQueue } from '@/infrastructure/queues/queues';
import { ConflictError } from '@/shared/errors/AppError';
import type { Role } from '@/domain/services/RBACEngine';
import type { UserRole } from '@prisma/client';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface InviteUserInput {
  /** Email do usuário a ser convidado */
  email: string;
  /** Papel a ser atribuído ao usuário convidado */
  role: UserRole;
  /** Tenant ao qual o convite pertence */
  tenantId: string;
  /** ID do usuário que está realizando o convite */
  invitedById: string;
  /** Papel do ator que está realizando a ação (para verificação RBAC) */
  actorRole: Role;
  /** Tenant do ator (para verificação RBAC de isolamento cross-tenant) */
  actorTenantId: string;
}

export interface InviteUserOutput {
  /** ID do InvitationToken gerado */
  invitationId: string;
  /** Token gerado (hex de 64 caracteres) */
  token: string;
  /** Data/hora de expiração do convite (now + 72h) */
  expiresAt: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Validade do convite em milissegundos: 72 horas */
const INVITATION_TTL_MS = 72 * 60 * 60 * 1000;

// ─────────────────────────────────────────────────────────────────────────────
// Use Case
// ─────────────────────────────────────────────────────────────────────────────

export class InviteUserUseCase {
  /**
   * Executa o fluxo de convite de usuário.
   *
   * @throws {ForbiddenError} quando o ator não tem permissão `user:invite`
   * @throws {ConflictError} quando o email já está ativo no tenant
   * @throws {ConflictError} quando já existe convite pendente para o mesmo email
   */
  async execute(input: InviteUserInput): Promise<InviteUserOutput> {
    const { email, role, tenantId, invitedById, actorRole, actorTenantId } = input;

    // ── 1. Verificação RBAC ──────────────────────────────────────────────────
    // Lança ForbiddenError automaticamente se a permissão for negada.
    // Requirement 2.2, 4.7
    rbacEngine.enforce(
      {
        userId: invitedById,
        tenantId: actorTenantId,
        role: actorRole,
        resourceTenantId: tenantId,
      },
      'user:invite',
    );

    // ── 2. Verificar email não duplicado no tenant (usuário ativo) ────────────
    // Exclui registros com soft-delete (deletedAt != null).
    // Requirement 4.1 — impede convite para email já cadastrado e ativo.
    const existingUser = await prisma.user.findFirst({
      where: {
        email,
        tenantId,
        deletedAt: null,
      },
      select: { id: true },
    });

    if (existingUser) {
      throw new ConflictError(
        `Um usuário com o email '${email}' já está ativo neste tenant.`,
        { email, tenantId },
      );
    }

    // ── 3. Verificar convite pendente válido para o mesmo email ──────────────
    // Considera pendente: não expirado, não usado, não revogado.
    // Requirement 4.1 — evita convites duplicados em aberto.
    const pendingInvitation = await prisma.invitationToken.findFirst({
      where: {
        email,
        tenantId,
        usedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    });

    if (pendingInvitation) {
      throw new ConflictError(
        `Já existe um convite pendente para o email '${email}' neste tenant.`,
        { email, tenantId, existingInvitationId: pendingInvitation.id },
      );
    }

    // ── 4. Gerar token criptograficamente seguro ─────────────────────────────
    // Requirement 4.1: token único, criptograficamente seguro (256 bits de entropia).
    const token = tokenGenerator.generateInvitationToken();

    // ── 5. Calcular expiração e persistir InvitationToken ────────────────────
    // Requirement 4.1: validade de 72 horas.
    const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);

    const invitation = await prisma.invitationToken.create({
      data: {
        tenantId,
        email,
        role,
        token,
        invitedById,
        expiresAt,
      },
      select: {
        id: true,
        invitedBy: {
          select: { name: true },
        },
      },
    });

    const invitedByName = invitation.invitedBy.name;

    // ── 6. Enfileirar job de envio de email ──────────────────────────────────
    // Requirement 4.2: enviar link de ativação imediatamente após criação do convite.
    // Fire-and-forget: não aguarda a conclusão do job.
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.example.com';
    const invitationLink = `${baseUrl}/convite/${token}`;

    await emailQueue.add(
      'send-invitation',
      {
        type: 'invitation',
        to: email,
        subject: 'Você foi convidado para a plataforma jurídica',
        template: 'invitation',
        data: {
          invitationLink,
          email,
          invitedByName,
        },
        tenantId,
      },
      {
        // Job ID único para evitar duplicatas acidentais
        jobId: `invitation:${invitation.id}`,
      },
    );

    // ── 7. Registrar evento de auditoria ─────────────────────────────────────
    // Requirement 3.1: registrar envio de convite no Audit_Service.
    // Fire-and-forget: não aguarda persistência.
    void auditQueue.add('audit-invite-user', {
      tenantId,
      userId: invitedById,
      action: 'invitation:sent',
      resourceType: 'InvitationToken',
      resourceId: invitation.id,
      ipAddress: '0.0.0.0', // Será sobrescrito pela camada de apresentação
      userAgent: 'server',  // Será sobrescrito pela camada de apresentação
      payloadAfter: {
        email,
        role,
        expiresAt: expiresAt.toISOString(),
      },
    });

    // ── 8. Retornar resultado ─────────────────────────────────────────────────
    return {
      invitationId: invitation.id,
      token,
      expiresAt,
    };
  }
}

/** Singleton para uso na camada de aplicação. */
export const inviteUserUseCase = new InviteUserUseCase();
