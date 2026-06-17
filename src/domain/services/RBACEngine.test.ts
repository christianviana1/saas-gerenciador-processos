/**
 * Unit + Property-Based Tests for RBACEngine and PermissionMatrix
 *
 * Framework: Vitest 1.x + fast-check (PBT)
 * Requirements: 2.1, 2.2, 2.4, 2.8
 *
 * Test coverage:
 *  - Permission matrix: each role grants/denies the expected actions
 *  - Cross-tenant isolation
 *  - Privilege escalation (Requirement 2.8)
 *  - `can()` returns boolean, `enforce()` throws ForbiddenError on denial
 *  - Property 7: for every actor-level H and target role H' where H' ≥ H,
 *    user:role:change is always denied (P6/P7 from design.md)
 *
 * **Validates: Requirements 2.1, 2.2, 2.8**
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { RBACEngine, ForbiddenError } from './RBACEngine';
import type { Role, Action, RBACContext } from './RBACEngine';
import { ROLE_HIERARCHY, PERMISSION_MATRIX } from './PermissionMatrix';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const engine = new RBACEngine();

const TENANT_A = 'tenant-A';
const TENANT_B = 'tenant-B';
const USER_ID = 'user-1';

function ctx(
  role: Role,
  resourceTenantId = TENANT_A,
  targetRole?: Role,
): RBACContext {
  return {
    userId: USER_ID,
    tenantId: TENANT_A,
    role,
    resourceTenantId,
    targetRole,
  };
}

const ALL_ROLES: Role[] = [
  'READ_ONLY_USER',
  'INTERN',
  'LEGAL_ASSISTANT',
  'LAWYER',
  'OFFICE_ADMIN',
  'SUPER_ADMIN',
];

const ALL_ACTIONS: Action[] = [
  'process:read',
  'process:create',
  'process:update',
  'process:delete',
  'task:read',
  'task:create',
  'task:update',
  'task:delete',
  'user:invite',
  'user:deactivate',
  'user:role:change',
  'audit:read',
  'tenant:manage',
];

// ─────────────────────────────────────────────────────────────────────────────
// 1. Permission Matrix correctness
// ─────────────────────────────────────────────────────────────────────────────

describe('PermissionMatrix', () => {
  it('SUPER_ADMIN has all actions', () => {
    for (const action of ALL_ACTIONS) {
      expect(PERMISSION_MATRIX.SUPER_ADMIN.has(action)).toBe(true);
    }
  });

  it('OFFICE_ADMIN has all actions except tenant:manage', () => {
    for (const action of ALL_ACTIONS) {
      if (action === 'tenant:manage') {
        expect(PERMISSION_MATRIX.OFFICE_ADMIN.has(action)).toBe(false);
      } else {
        expect(PERMISSION_MATRIX.OFFICE_ADMIN.has(action)).toBe(true);
      }
    }
  });

  it('LAWYER has process:read/create/update, task:read/create/update, audit:read', () => {
    const allowed: Action[] = [
      'process:read', 'process:create', 'process:update',
      'task:read', 'task:create', 'task:update',
      'audit:read',
    ];
    const denied: Action[] = ALL_ACTIONS.filter((a) => !allowed.includes(a));

    for (const action of allowed) {
      expect(PERMISSION_MATRIX.LAWYER.has(action)).toBe(true);
    }
    for (const action of denied) {
      expect(PERMISSION_MATRIX.LAWYER.has(action)).toBe(false);
    }
  });

  it('LEGAL_ASSISTANT has same permissions as LAWYER', () => {
    for (const action of ALL_ACTIONS) {
      expect(PERMISSION_MATRIX.LEGAL_ASSISTANT.has(action)).toBe(
        PERMISSION_MATRIX.LAWYER.has(action),
      );
    }
  });

  it('INTERN can only task:read/create/update and process:read', () => {
    const allowed: Action[] = [
      'process:read', 'task:read', 'task:create', 'task:update',
    ];
    const denied: Action[] = ALL_ACTIONS.filter((a) => !allowed.includes(a));

    for (const action of allowed) {
      expect(PERMISSION_MATRIX.INTERN.has(action)).toBe(true);
    }
    for (const action of denied) {
      expect(PERMISSION_MATRIX.INTERN.has(action)).toBe(false);
    }
  });

  it('READ_ONLY_USER can only process:read and task:read', () => {
    const allowed: Action[] = ['process:read', 'task:read'];
    const denied: Action[] = ALL_ACTIONS.filter((a) => !allowed.includes(a));

    for (const action of allowed) {
      expect(PERMISSION_MATRIX.READ_ONLY_USER.has(action)).toBe(true);
    }
    for (const action of denied) {
      expect(PERMISSION_MATRIX.READ_ONLY_USER.has(action)).toBe(false);
    }
  });

  it('Role hierarchy values are strictly ordered', () => {
    expect(ROLE_HIERARCHY.READ_ONLY_USER).toBe(1);
    expect(ROLE_HIERARCHY.INTERN).toBe(2);
    expect(ROLE_HIERARCHY.LEGAL_ASSISTANT).toBe(3);
    expect(ROLE_HIERARCHY.LAWYER).toBe(4);
    expect(ROLE_HIERARCHY.OFFICE_ADMIN).toBe(5);
    expect(ROLE_HIERARCHY.SUPER_ADMIN).toBe(6);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Cross-tenant isolation
// ─────────────────────────────────────────────────────────────────────────────

describe('RBACEngine — cross-tenant isolation', () => {
  it('denies any action when resourceTenantId ≠ tenantId for non-SUPER_ADMIN', () => {
    const nonSuperAdminRoles: Role[] = ALL_ROLES.filter((r) => r !== 'SUPER_ADMIN');

    for (const role of nonSuperAdminRoles) {
      const result = engine.can(ctx(role, TENANT_B), 'process:read');
      expect(result).toBe(false);
    }
  });

  it('allows SUPER_ADMIN cross-tenant access for any action', () => {
    for (const action of ALL_ACTIONS) {
      const context: RBACContext = {
        userId: USER_ID,
        tenantId: TENANT_A,
        role: 'SUPER_ADMIN',
        resourceTenantId: TENANT_B,
        ...(action === 'user:role:change' ? { targetRole: 'READ_ONLY_USER' } : {}),
      };
      expect(engine.can(context, action)).toBe(true);
    }
  });

  it('enforce() throws ForbiddenError on cross-tenant access', () => {
    const context = ctx('LAWYER', TENANT_B);
    expect(() => engine.enforce(context, 'process:read')).toThrow(ForbiddenError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Privilege escalation (Requirement 2.8)
// ─────────────────────────────────────────────────────────────────────────────

describe('RBACEngine — privilege escalation guard (Req 2.8)', () => {
  it('denies user:role:change when targetRole level ≥ actor level', () => {
    // OFFICE_ADMIN (5) cannot assign OFFICE_ADMIN (5) or SUPER_ADMIN (6)
    expect(engine.can(ctx('OFFICE_ADMIN', TENANT_A, 'OFFICE_ADMIN'), 'user:role:change')).toBe(false);
    expect(engine.can(ctx('OFFICE_ADMIN', TENANT_A, 'SUPER_ADMIN'), 'user:role:change')).toBe(false);

    // LAWYER (4) cannot assign LAWYER (4)
    expect(engine.can(ctx('LAWYER', TENANT_A, 'LAWYER'), 'user:role:change')).toBe(false);
  });

  it('denies user:role:change when no targetRole is provided', () => {
    // Even if the role normally has user:role:change permission
    expect(engine.can(ctx('OFFICE_ADMIN', TENANT_A, undefined), 'user:role:change')).toBe(false);
    expect(engine.can(ctx('SUPER_ADMIN', TENANT_A, undefined), 'user:role:change')).toBe(false);
  });

  it('allows user:role:change when targetRole level < actor level', () => {
    // OFFICE_ADMIN (5) can assign LAWYER (4), LEGAL_ASSISTANT (3), INTERN (2), READ_ONLY_USER (1)
    expect(engine.can(ctx('OFFICE_ADMIN', TENANT_A, 'LAWYER'), 'user:role:change')).toBe(true);
    expect(engine.can(ctx('OFFICE_ADMIN', TENANT_A, 'LEGAL_ASSISTANT'), 'user:role:change')).toBe(true);
    expect(engine.can(ctx('OFFICE_ADMIN', TENANT_A, 'INTERN'), 'user:role:change')).toBe(true);
    expect(engine.can(ctx('OFFICE_ADMIN', TENANT_A, 'READ_ONLY_USER'), 'user:role:change')).toBe(true);

    // SUPER_ADMIN (6) can assign any role
    expect(engine.can(ctx('SUPER_ADMIN', TENANT_A, 'OFFICE_ADMIN'), 'user:role:change')).toBe(true);
    expect(engine.can(ctx('SUPER_ADMIN', TENANT_B, 'READ_ONLY_USER'), 'user:role:change')).toBe(true);
  });

  it('INTERN and READ_ONLY_USER are denied user:role:change entirely (not in matrix)', () => {
    expect(engine.can(ctx('INTERN', TENANT_A, 'READ_ONLY_USER'), 'user:role:change')).toBe(false);
    expect(engine.can(ctx('READ_ONLY_USER', TENANT_A, 'READ_ONLY_USER'), 'user:role:change')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. enforce() behaviour
// ─────────────────────────────────────────────────────────────────────────────

describe('RBACEngine — enforce()', () => {
  it('does not throw when can() returns true', () => {
    expect(() => engine.enforce(ctx('LAWYER'), 'process:read')).not.toThrow();
    expect(() => engine.enforce(ctx('SUPER_ADMIN', TENANT_B), 'tenant:manage')).not.toThrow();
  });

  it('throws ForbiddenError (not generic Error) on denial', () => {
    const context = ctx('READ_ONLY_USER');
    try {
      engine.enforce(context, 'process:delete');
      // Should never reach here
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenError);
      expect((err as ForbiddenError).code).toBe('FORBIDDEN');
      expect((err as ForbiddenError).statusCode).toBe(403);
    }
  });

  it('ForbiddenError message contains userId and action', () => {
    const context = ctx('INTERN');
    try {
      engine.enforce(context, 'audit:read');
    } catch (err) {
      const e = err as ForbiddenError;
      expect(e.message).toContain(USER_ID);
      expect(e.message).toContain('audit:read');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Property-Based Tests
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 2.1, 2.2, 2.8**
 *
 * Property 7 (design.md): For any user with hierarchy level H attempting
 * user:role:change to a target role with hierarchy H' where H' ≥ H,
 * the RBAC Engine MUST return false from can() and throw ForbiddenError from enforce().
 */
describe('RBACEngine — PBT: privilege escalation always blocked (Property 7)', () => {
  const roleArb = fc.constantFrom<Role>(...ALL_ROLES);

  it('can() always returns false when targetRole level ≥ actor level', () => {
    fc.assert(
      fc.property(
        roleArb,
        roleArb,
        (actorRole, targetRole) => {
          // Only test roles that have user:role:change in the matrix
          if (!PERMISSION_MATRIX[actorRole].has('user:role:change')) {
            return true; // vacuously true — matrix itself already blocks
          }

          const actorLevel = ROLE_HIERARCHY[actorRole];
          const targetLevel = ROLE_HIERARCHY[targetRole];

          if (actorLevel <= targetLevel) {
            const context: RBACContext = {
              userId: 'u1',
              tenantId: TENANT_A,
              role: actorRole,
              resourceTenantId: TENANT_A,
              targetRole,
            };
            return engine.can(context, 'user:role:change') === false;
          }

          // When actorLevel > targetLevel the operation may be allowed — skip assertion
          return true;
        },
      ),
      { numRuns: 500 },
    );
  });

  it('enforce() always throws ForbiddenError when targetRole level ≥ actor level', () => {
    fc.assert(
      fc.property(
        roleArb,
        roleArb,
        (actorRole, targetRole) => {
          if (!PERMISSION_MATRIX[actorRole].has('user:role:change')) {
            return true;
          }

          const actorLevel = ROLE_HIERARCHY[actorRole];
          const targetLevel = ROLE_HIERARCHY[targetRole];

          if (actorLevel <= targetLevel) {
            const context: RBACContext = {
              userId: 'u1',
              tenantId: TENANT_A,
              role: actorRole,
              resourceTenantId: TENANT_A,
              targetRole,
            };
            let threw = false;
            try {
              engine.enforce(context, 'user:role:change');
            } catch (e) {
              threw = e instanceof ForbiddenError;
            }
            return threw;
          }

          return true;
        },
      ),
      { numRuns: 500 },
    );
  });

  /**
   * **Validates: Requirements 2.1, 2.2**
   *
   * For any non-SUPER_ADMIN role, any action against a different tenant
   * must always be denied.
   */
  it('cross-tenant access is always denied for non-SUPER_ADMIN (any action)', () => {
    const nonSuperRoleArb = fc.constantFrom<Role>(
      'OFFICE_ADMIN', 'LAWYER', 'LEGAL_ASSISTANT', 'INTERN', 'READ_ONLY_USER',
    );
    const actionArb = fc.constantFrom<Action>(...ALL_ACTIONS);
    const tenantArb = fc.string({ minLength: 1, maxLength: 20 });

    fc.assert(
      fc.property(
        nonSuperRoleArb,
        actionArb,
        tenantArb,
        tenantArb,
        (role, action, tenantId, resourceTenantId) => {
          // Only test when tenants are different
          if (tenantId === resourceTenantId) return true;

          const context: RBACContext = {
            userId: 'u1',
            tenantId,
            role,
            resourceTenantId,
          };
          return engine.can(context, action) === false;
        },
      ),
      { numRuns: 1000 },
    );
  });
});
