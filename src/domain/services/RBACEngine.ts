/**
 * RBACEngine — Role-Based Access Control evaluation engine.
 *
 * Implements Requirements 2.1, 2.2, 2.4, 2.8:
 *  - 2.1: Supports hierarchical roles: SUPER_ADMIN > OFFICE_ADMIN > LAWYER >
 *          LEGAL_ASSISTANT > INTERN > READ_ONLY_USER
 *  - 2.2: Evaluates permissions on every action before executing read/create/update/delete
 *  - 2.4: Office_Admin can configure granular permissions per role within their tenant
 *  - 2.8: Prohibits privilege escalation — a user cannot change the role of anyone at
 *          equal or higher hierarchy level, and cannot assign a role ≥ their own level
 *
 * Cross-tenant access: always denied unless the actor is SUPER_ADMIN.
 * Privilege escalation (user:role:change): only allowed if actor's hierarchy level
 * is STRICTLY GREATER than the target role being assigned.
 *
 * ForbiddenError is defined inline here to avoid circular dependencies with
 * src/shared/errors/ (task 7.4 will later create the canonical ForbiddenError).
 */

import { PERMISSION_MATRIX, ROLE_HIERARCHY } from './PermissionMatrix';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type Role =
  | 'SUPER_ADMIN'
  | 'OFFICE_ADMIN'
  | 'LAWYER'
  | 'LEGAL_ASSISTANT'
  | 'INTERN'
  | 'READ_ONLY_USER';

export type Action =
  | 'process:read'
  | 'process:create'
  | 'process:update'
  | 'process:delete'
  | 'task:read'
  | 'task:create'
  | 'task:update'
  | 'task:delete'
  | 'user:invite'
  | 'user:deactivate'
  | 'user:role:change'
  | 'audit:read'
  | 'tenant:manage';

/** Context passed to the RBAC engine for every permission check. */
export interface RBACContext {
  /** ID of the authenticated user making the request. */
  userId: string;
  /** Tenant the authenticated user belongs to. */
  tenantId: string;
  /** Role of the authenticated user. */
  role: Role;
  /** Tenant that owns the resource being accessed. */
  resourceTenantId: string;
  /**
   * When the action is `user:role:change`, this field specifies the target
   * role to be assigned. Used for the privilege-escalation check (Req 2.8).
   */
  targetRole?: Role;
}

export interface IRBACEngine {
  /**
   * Returns `true` if the actor described by `context` is allowed to perform
   * `action`; `false` otherwise. Never throws.
   */
  can(context: RBACContext, action: Action): boolean;

  /**
   * Same as `can`, but throws `ForbiddenError` instead of returning `false`.
   * Use this in application-layer use cases where a denial must be an error.
   *
   * @throws {ForbiddenError} when the action is not permitted
   */
  enforce(context: RBACContext, action: Action): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Minimal ForbiddenError (will be superseded by src/shared/errors/ForbiddenError
// once task 7.4 is implemented — avoid circular dependency for now)
// ─────────────────────────────────────────────────────────────────────────────

export class ForbiddenError extends Error {
  readonly code: string = 'FORBIDDEN';
  readonly statusCode: number = 403;

  constructor(
    message: string = 'Access denied',
    readonly details?: {
      userId?: string;
      tenantId?: string;
      action?: Action;
      reason?: string;
    },
  ) {
    super(message);
    this.name = 'ForbiddenError';
    // Restore prototype chain (required when extending built-in Error in TypeScript)
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// RBACEngine implementation
// ─────────────────────────────────────────────────────────────────────────────

export class RBACEngine implements IRBACEngine {
  /**
   * Evaluates whether the actor is allowed to perform the action.
   *
   * Decision order:
   *  1. Cross-tenant isolation: deny if resourceTenantId ≠ tenantId, unless SUPER_ADMIN.
   *  2. Matrix check: deny if the role's permission set does not include the action.
   *  3. Privilege-escalation check for `user:role:change`: deny if targetRole hierarchy
   *     level ≥ actor hierarchy level (Requirement 2.8).
   */
  can(context: RBACContext, action: Action): boolean {
    const { role, tenantId, resourceTenantId, targetRole } = context;

    // ── 1. Cross-tenant isolation ────────────────────────────────────────────
    // SUPER_ADMIN can access resources across all tenants.
    if (role !== 'SUPER_ADMIN' && resourceTenantId !== tenantId) {
      return false;
    }

    // ── 2. Permission matrix check ───────────────────────────────────────────
    const allowedActions = PERMISSION_MATRIX[role];
    if (!allowedActions.has(action)) {
      return false;
    }

    // ── 3. Privilege-escalation guard (Requirement 2.8) ──────────────────────
    // Applies only to the `user:role:change` action.
    // The actor's hierarchy level must be STRICTLY GREATER than the target role's level.
    if (action === 'user:role:change') {
      const actorLevel = ROLE_HIERARCHY[role];
      const targetLevel = targetRole !== undefined ? ROLE_HIERARCHY[targetRole] : undefined;

      if (targetLevel === undefined) {
        // No targetRole supplied — deny by default to avoid silent escalations.
        return false;
      }

      if (actorLevel <= targetLevel) {
        return false;
      }
    }

    return true;
  }

  /**
   * Enforces the permission check, throwing `ForbiddenError` on denial.
   * Suitable for use in application-layer use cases.
   *
   * @throws {ForbiddenError}
   */
  enforce(context: RBACContext, action: Action): void {
    if (!this.can(context, action)) {
      const reason = this._denyReason(context, action);
      throw new ForbiddenError(
        `User "${context.userId}" is not allowed to perform "${action}": ${reason}`,
        {
          userId: context.userId,
          tenantId: context.tenantId,
          action,
          reason,
        },
      );
    }
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private _denyReason(context: RBACContext, action: Action): string {
    const { role, tenantId, resourceTenantId, targetRole } = context;

    if (role !== 'SUPER_ADMIN' && resourceTenantId !== tenantId) {
      return `cross-tenant access denied (actor tenant: ${tenantId}, resource tenant: ${resourceTenantId})`;
    }

    if (!PERMISSION_MATRIX[role].has(action)) {
      return `role "${role}" does not have permission for action "${action}"`;
    }

    if (action === 'user:role:change') {
      const actorLevel = ROLE_HIERARCHY[role];
      const targetLevel = targetRole !== undefined ? ROLE_HIERARCHY[targetRole] : undefined;

      if (targetLevel === undefined) {
        return 'targetRole must be specified for user:role:change';
      }

      return (
        `privilege escalation blocked: actor level ${actorLevel} (${role}) ` +
        `cannot assign role "${targetRole}" at level ${targetLevel}`
      );
    }

    return 'permission denied';
  }
}

/** Singleton instance for use throughout the application layer. */
export const rbacEngine = new RBACEngine();
