/**
 * ListProcessesUseCase — Lista processos judiciais de um tenant com filtros e paginação.
 *
 * Fluxo:
 *  1. Verifica permissão RBAC (process:read) — lança ForbiddenError se negado
 *  2. Aplica filtros e paginação via processRepository.findMany()
 *     - pageSize máximo: 50 registros (Requisito 6.6)
 *  3. Retorna resultado paginado
 *
 * Filtros suportados (Requisito 6.6):
 *  - status: ProcessStatus (ACTIVE, ARCHIVED, DELETED)
 *  - responsibleUserId: ID de um usuário responsável
 *  - currentCourt: nome/código do tribunal (busca parcial)
 *  - tags: lista de tags (match em qualquer tag)
 *  - createdFrom / createdTo: intervalo de período de criação
 *  - search: texto livre em clientName, subject, processClass, cnjNumber
 *  - page / pageSize: paginação (máx 50 por página)
 *
 * Requisitos: 6.5, 6.6, 2.2
 */

import { rbacEngine } from '@/domain/services/RBACEngine';
import { processRepository } from '@/infrastructure/database/repositories/ProcessRepository';
import type { Role } from '@/domain/services/RBACEngine';
import type { Process, ProcessStatus } from '@/domain/entities/Process';
import type { PaginatedResult } from '@/domain/repositories/IProcessRepository';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Requisito 6.6: paginação máxima de 50 registros por página. */
const MAX_PAGE_SIZE = 50;
const DEFAULT_PAGE_SIZE = 20;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ListProcessesFilters {
  /** Filtrar por status do processo */
  status?: ProcessStatus;
  /** Filtrar por usuário responsável (ID) */
  responsibleUserId?: string;
  /** Filtrar por tribunal (busca parcial, case-insensitive) */
  currentCourt?: string;
  /** Filtrar por tags (match em qualquer tag da lista) */
  tags?: string[];
  /** Filtrar processos criados a partir desta data (inclusive) */
  createdFrom?: Date;
  /** Filtrar processos criados até esta data (inclusive) */
  createdTo?: Date;
  /** Busca em texto livre: clientName, subject, processClass, cnjNumber */
  search?: string;
  /** Número da página (padrão: 1) */
  page?: number;
  /** Registros por página (padrão: 20, máximo: 50) */
  pageSize?: number;
}

export interface ListProcessesInput {
  /** Tenant cujos processos serão listados */
  tenantId: string;
  /** ID do usuário que está executando a ação */
  actorUserId: string;
  /** Papel do ator para verificação RBAC */
  actorRole: Role;
  /** Filtros de busca e paginação */
  filters?: ListProcessesFilters;
}

// ─────────────────────────────────────────────────────────────────────────────
// Use Case
// ─────────────────────────────────────────────────────────────────────────────

export class ListProcessesUseCase {
  /**
   * Executa o fluxo de listagem de processos com filtros e paginação.
   *
   * @throws {ForbiddenError} quando o ator não tem permissão `process:read`
   */
  async execute(input: ListProcessesInput): Promise<PaginatedResult<Process>> {
    const { tenantId, actorUserId, actorRole, filters = {} } = input;

    // ── 1. Verificação RBAC ──────────────────────────────────────────────────
    // Lança ForbiddenError automaticamente se a permissão for negada.
    // Requisito 2.2: avaliar permissões antes de executar qualquer ação de leitura.
    rbacEngine.enforce(
      {
        userId: actorUserId,
        tenantId,
        role: actorRole,
        resourceTenantId: tenantId,
      },
      'process:read',
    );

    // ── 2. Normalizar paginação ───────────────────────────────────────────────
    // Requisito 6.6: paginação máxima de 50 registros por página.
    // O repositório já aplica o limite, mas normalizamos aqui para clareza.
    const normalizedFilters = {
      ...filters,
      page: Math.max(1, filters.page ?? 1),
      pageSize: Math.min(
        MAX_PAGE_SIZE,
        Math.max(1, filters.pageSize ?? DEFAULT_PAGE_SIZE),
      ),
    };

    // ── 3. Delegar consulta ao repositório ───────────────────────────────────
    // processRepository.findMany() aplica WHERE tenant_id = tenantId obrigatoriamente
    // e exclui processos com deletedAt != null automaticamente.
    // Requisito 1.7: toda query inclui filtro tenant_id.
    return processRepository.findMany(normalizedFilters, tenantId);
  }
}

/** Singleton para uso na camada de aplicação e Server Actions. */
export const listProcessesUseCase = new ListProcessesUseCase();
