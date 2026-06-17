/**
 * Static permission matrix mapping each Role to the set of Actions it may perform.
 *
 * Permission rules (Requirements 2.1, 2.2, 2.4):
 *
 * SUPER_ADMIN     — all actions (including tenant:manage)
 * OFFICE_ADMIN    — all actions except tenant:manage; can manage users within their tenant
 * LAWYER          — process:read/create/update, task:read/create/update, audit:read
 * LEGAL_ASSISTANT — same as LAWYER
 * INTERN          — task:read/create/update, process:read only
 * READ_ONLY_USER  — process:read, task:read only
 *
 * Note: `user:role:change` is listed here for roles that have the general permission,
 * but the RBACEngine enforces the additional hierarchy constraint (Requirement 2.8).
 */

import type { Action, Role } from './RBACEngine';

/** The complete set of all defined actions. */
export const ALL_ACTIONS: readonly Action[] = [
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
] as const;

/**
 * Maps each role to the set of actions it is allowed to perform.
 * This is a pure data structure — no cross-tenant or hierarchy logic here.
 */
export const PERMISSION_MATRIX: Readonly<Record<Role, ReadonlySet<Action>>> = {
  SUPER_ADMIN: new Set<Action>(ALL_ACTIONS),

  OFFICE_ADMIN: new Set<Action>([
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
    // NOTE: 'tenant:manage' is intentionally excluded
  ]),

  LAWYER: new Set<Action>([
    'process:read',
    'process:create',
    'process:update',
    'task:read',
    'task:create',
    'task:update',
    'audit:read',
  ]),

  LEGAL_ASSISTANT: new Set<Action>([
    'process:read',
    'process:create',
    'process:update',
    'task:read',
    'task:create',
    'task:update',
    'audit:read',
  ]),

  INTERN: new Set<Action>([
    'process:read',
    'task:read',
    'task:create',
    'task:update',
  ]),

  READ_ONLY_USER: new Set<Action>([
    'process:read',
    'task:read',
  ]),
};

/**
 * Role hierarchy levels for privilege-escalation checks.
 *
 * Hierarchy: READ_ONLY_USER(1) < INTERN(2) < LEGAL_ASSISTANT(3) < LAWYER(4) < OFFICE_ADMIN(5) < SUPER_ADMIN(6)
 *
 * Requirement 2.8: A user can only assign a role whose level is STRICTLY LESS than their own.
 */
export const ROLE_HIERARCHY: Readonly<Record<Role, number>> = {
  READ_ONLY_USER: 1,
  INTERN: 2,
  LEGAL_ASSISTANT: 3,
  LAWYER: 4,
  OFFICE_ADMIN: 5,
  SUPER_ADMIN: 6,
};
