/**
 * E2E Test: Create Process Flow
 *
 * Covers the process creation lifecycle:
 *   1. Admin authenticates → navigates to /processos/novo
 *   2. Fills valid CNJ → submits → verifies 201 and redirect to process list/detail
 *   3. Fills invalid CNJ format → verifies descriptive client-side validation error
 *   4. Creates the same CNJ twice (via API) → verifies 409 conflict error
 *
 * Requirements: 6.1, 6.2, 16.4
 *
 * Note: These tests run against a live Next.js server.
 * They are skipped automatically when the server is unreachable or
 * when the SKIP_E2E env variable is set to "true".
 *
 * API-level tests use:
 *   page.request.post('/api/processos', { data: {...}, headers: { Cookie } })
 *
 * Browser tests validate UI validation messages (client-side Zod schema).
 */

import { test, expect, type APIRequestContext } from '@playwright/test';

// ─────────────────────────────────────────────────────────────────────────────
// Constants / Fixtures
// ─────────────────────────────────────────────────────────────────────────────

/** Seed-data Super_Admin credentials (matches seed.ts). */
const ADMIN_EMAIL    = 'superadmin@plataforma.local';
const ADMIN_PASSWORD = 'SuperAdmin@1234!';

/** Valid CNJ number in the required format: NNNNNNN-DD.AAAA.J.TT.OOOO */
const VALID_CNJ = `000${Date.now().toString().slice(-4)}-56.2024.8.26.0100`;

/** Invalid CNJ — too short, no separators */
const INVALID_CNJ = '123';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers (same pattern as invite-and-login.spec.ts)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Authenticate as admin via Auth.js credentials endpoint.
 * Returns the cookie string for subsequent authenticated requests.
 *
 * Pattern: GET /api/auth/csrf → POST /api/auth/callback/credentials
 */
async function adminSignIn(request: APIRequestContext, baseURL: string): Promise<string> {
  // Step 1: Fetch CSRF token required by NextAuth
  const csrfRes = await request.get(`${baseURL}/api/auth/csrf`);
  if (!csrfRes.ok()) {
    throw new Error(`Failed to fetch CSRF token: ${csrfRes.status()}`);
  }
  const { csrfToken } = await csrfRes.json() as { csrfToken: string };

  // Step 2: POST credentials to the callback endpoint
  const signInRes = await request.post(`${baseURL}/api/auth/callback/credentials`, {
    form: {
      email:       ADMIN_EMAIL,
      password:    ADMIN_PASSWORD,
      csrfToken,
      callbackUrl: `${baseURL}/`,
      json:        'true',
    },
    maxRedirects: 0,
  });

  const rawCookies = signInRes.headers()['set-cookie'] ?? '';
  if (!rawCookies) {
    throw new Error(
      `Sign-in did not return cookies (status ${signInRes.status()}). ` +
      'Check ADMIN_EMAIL / ADMIN_PASSWORD and that the server is seeded.',
    );
  }

  // Collapse multi-value header into a single Cookie header string
  const cookieHeader = rawCookies
    .split('\n')
    .map((c) => c.split(';')[0])
    .join('; ');

  return cookieHeader;
}

/**
 * Resolve the admin user ID from the session endpoint.
 * Required to populate `responsibleUserIds` in process creation.
 */
async function getAdminUserId(
  request: APIRequestContext,
  baseURL: string,
  cookieHeader: string,
): Promise<string | null> {
  try {
    const res = await request.get(`${baseURL}/api/auth/session`, {
      headers: { Cookie: cookieHeader },
    });
    if (!res.ok()) return null;
    const session = await res.json() as { user?: { id?: string } };
    return session?.user?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Check whether the dev server is reachable; used to skip gracefully.
 */
async function isServerReachable(request: APIRequestContext, baseURL: string): Promise<boolean> {
  try {
    const res = await request.get(`${baseURL}/api/health`, { timeout: 5_000 });
    return res.ok();
  } catch {
    return false;
  }
}

/**
 * Build the minimal valid process payload for API tests.
 *
 * @param cnjNumber - CNJ number (validated by the API use case)
 * @param responsibleUserIds - must contain at least one active user ID in the tenant
 */
function buildProcessPayload(cnjNumber: string, responsibleUserIds: string[]) {
  return {
    cnjNumber,
    clientName:         'Cliente E2E Teste',
    processClass:       'Ação de Indenização',
    subject:            'Dano Moral',
    responsibleUserIds,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Test Suite
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Fluxo de Criação de Processo', () => {

  // Shared state
  let cookieHeader = '';
  let adminUserId: string | null = null;

  // ── Before-all: authenticate admin ────────────────────────────────────────
  test.beforeAll(async ({ request, baseURL }) => {
    const base = baseURL ?? 'http://localhost:3000';

    const reachable = await isServerReachable(request, base);
    if (!reachable || process.env.SKIP_E2E === 'true') {
      return; // Tests will skip individually via test.skip()
    }

    cookieHeader = await adminSignIn(request, base);
    adminUserId  = await getAdminUserId(request, base, cookieHeader);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 1 — Valid CNJ via API → 201 success
  // ─────────────────────────────────────────────────────────────────────────

  test('API: CNJ válido → 201 e processo retornado', async ({ request, baseURL }) => {
    const base = baseURL ?? 'http://localhost:3000';

    test.skip(
      !cookieHeader || process.env.SKIP_E2E === 'true',
      'Servidor não disponível ou autenticação falhou — teste ignorado.',
    );

    // responsibleUserIds requires at least one active user.
    // If we could not resolve the admin user ID, skip this test gracefully.
    test.skip(
      !adminUserId,
      'ID do usuário admin não disponível via sessão — teste ignorado.',
    );

    const res = await request.post(`${base}/api/processos`, {
      data:    buildProcessPayload(VALID_CNJ, [adminUserId!]),
      headers: {
        Cookie:         cookieHeader,
        'Content-Type': 'application/json',
      },
    });

    expect(res.status()).toBe(201);

    const body = await res.json() as { data?: { id?: string; cnjNumber?: string } };
    expect(body).toHaveProperty('data');
    expect(body.data).toHaveProperty('id');
    expect(body.data?.cnjNumber).toBe(VALID_CNJ);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 2 — Invalid CNJ via API → 400 with descriptive validation error
  // ─────────────────────────────────────────────────────────────────────────

  test('API: CNJ inválido → 400 VALIDATION_ERROR com mensagem descritiva', async ({
    request,
    baseURL,
  }) => {
    const base = baseURL ?? 'http://localhost:3000';

    test.skip(
      !cookieHeader || process.env.SKIP_E2E === 'true',
      'Servidor não disponível ou autenticação falhou — teste ignorado.',
    );

    const res = await request.post(`${base}/api/processos`, {
      data: buildProcessPayload(INVALID_CNJ, ['00000000-0000-0000-0000-000000000000']),
      headers: {
        Cookie:         cookieHeader,
        'Content-Type': 'application/json',
      },
    });

    // Could be 400 (Zod at API layer) or 400 (CnjNumber.parse ValidationError)
    expect(res.status()).toBe(400);

    const body = await res.json() as { code?: string; message?: string; details?: unknown };
    expect(body.code).toBe('VALIDATION_ERROR');

    // The error message or details must be descriptive (not empty)
    const hasDescriptiveError =
      (typeof body.message === 'string' && body.message.length > 0) ||
      body.details !== undefined;

    expect(hasDescriptiveError).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 3 — Duplicate CNJ via API → 409 CONFLICT
  // ─────────────────────────────────────────────────────────────────────────

  test('API: CNJ duplicado → 409 CONFLICT com mensagem descritiva', async ({
    request,
    baseURL,
  }) => {
    const base = baseURL ?? 'http://localhost:3000';

    test.skip(
      !cookieHeader || process.env.SKIP_E2E === 'true',
      'Servidor não disponível ou autenticação falhou — teste ignorado.',
    );

    test.skip(
      !adminUserId,
      'ID do usuário admin não disponível via sessão — teste ignorado.',
    );

    // Use a distinct CNJ for this test to avoid collisions with Test 1
    const duplicateCnj = `999${Date.now().toString().slice(-4)}-11.2024.8.26.0200`;
    const payload      = buildProcessPayload(duplicateCnj, [adminUserId!]);
    const headers      = { Cookie: cookieHeader, 'Content-Type': 'application/json' };

    // First creation — should succeed
    const first = await request.post(`${base}/api/processos`, { data: payload, headers });
    expect(first.status()).toBe(201);

    // Second creation with the same CNJ — must return 409
    const second = await request.post(`${base}/api/processos`, { data: payload, headers });
    expect(second.status()).toBe(409);

    const body = await second.json() as { code?: string; message?: string };
    expect(body.code).toBe('CONFLICT');

    // Message must be descriptive and non-empty (Req 6.8)
    expect(typeof body.message).toBe('string');
    expect((body.message as string).length).toBeGreaterThan(0);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 4 — Browser UI: Invalid CNJ format shows descriptive validation error
  // ─────────────────────────────────────────────────────────────────────────

  test('UI: CNJ inválido → erro de validação descritivo exibido no formulário', async ({
    page,
    baseURL,
  }) => {
    const base = baseURL ?? 'http://localhost:3000';

    test.skip(
      process.env.SKIP_E2E === 'true',
      'Servidor não disponível — teste ignorado.',
    );

    // ── Step 1: Navigate to the login page and authenticate ───────────────
    await page.goto(`${base}/login`);
    await expect(page.locator('input#email')).toBeVisible({ timeout: 10_000 });
    await page.fill('input#email',    ADMIN_EMAIL);
    await page.fill('input#password', ADMIN_PASSWORD);

    await Promise.all([
      page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15_000 }),
      page.click('button[type="submit"]'),
    ]);

    // ── Step 2: Navigate to the new process form ──────────────────────────
    await page.goto(`${base}/processos/novo`);
    await expect(page.locator('h1', { hasText: 'Novo processo' })).toBeVisible();

    // ── Step 3: Fill an invalid CNJ and attempt to submit ─────────────────
    await page.fill('#cnjNumber',     INVALID_CNJ);
    await page.fill('#clientName',    'Cliente Teste');
    await page.fill('#processClass',  'Ação Civil');
    await page.fill('#subject',       'Dano Moral');

    await page.click('button[type="submit"]');

    // ── Step 4: The page must stay on /processos/novo ─────────────────────
    await expect(page).toHaveURL(new RegExp('/processos/novo'));

    // ── Step 5: A descriptive error for the CNJ field must be visible ─────
    // The form renders: <p id="cnjNumber-error" role="alert">{error}</p>
    const cnjError = page.locator('#cnjNumber-error');
    await expect(cnjError).toBeVisible();

    const errorText = await cnjError.textContent();
    expect(errorText?.length).toBeGreaterThan(0);

    // The error should mention the expected format or explicitly say "inválido"
    expect(errorText).toMatch(/inválido|formato|NNNNNNN/i);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 5 — Browser UI: Valid CNJ → success (redirect away from form)
  // ─────────────────────────────────────────────────────────────────────────

  test('UI: CNJ válido → formulário submetido com sucesso e redirecionamento', async ({
    page,
    baseURL,
  }) => {
    const base = baseURL ?? 'http://localhost:3000';

    test.skip(
      process.env.SKIP_E2E === 'true',
      'Servidor não disponível — teste ignorado.',
    );

    // ── Step 1: Login ─────────────────────────────────────────────────────
    await page.goto(`${base}/login`);
    await expect(page.locator('input#email')).toBeVisible({ timeout: 10_000 });
    await page.fill('input#email',    ADMIN_EMAIL);
    await page.fill('input#password', ADMIN_PASSWORD);

    await Promise.all([
      page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15_000 }),
      page.click('button[type="submit"]'),
    ]);

    // ── Step 2: Navigate to the new process form ──────────────────────────
    await page.goto(`${base}/processos/novo`);
    await expect(page.locator('h1', { hasText: 'Novo processo' })).toBeVisible();

    // Use a unique CNJ for this browser-based test
    const uiCnj = `111${Date.now().toString().slice(-4)}-22.2024.8.26.0300`;

    // ── Step 3: Fill all required fields ─────────────────────────────────
    await page.fill('#cnjNumber',    uiCnj);
    await page.fill('#clientName',   'Cliente Browser Test');
    await page.fill('#processClass', 'Mandado de Segurança');
    await page.fill('#subject',      'Direito Administrativo');

    // ── Step 4: Submit and wait for navigation ────────────────────────────
    // On success, the form redirects to /processos/{id} (or /processos on error).
    // The page must NOT stay on /processos/novo.
    await Promise.all([
      page.waitForURL(
        (url) => !url.pathname.endsWith('/novo'),
        { timeout: 15_000 },
      ),
      page.click('button[type="submit"]'),
    ]);

    // Landed on process detail or list page — not the creation form
    expect(page.url()).not.toMatch(/\/processos\/novo$/);
    expect(page.url()).toMatch(/\/processos/);
  });

});
