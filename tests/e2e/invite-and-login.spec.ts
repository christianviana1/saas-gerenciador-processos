/**
 * E2E Test: Invite and Login Flow
 *
 * Covers the full invitation lifecycle:
 *   1. Office_Admin authenticates via API
 *   2. Office_Admin creates an invitation via POST /api/usuarios
 *   3. Invited user accesses /convite/{token}
 *   4. Fills name, password (meeting policy) and accepts terms
 *   5. Submits → redirected to /login
 *   6. Logs in with new credentials
 *   7. Verifies dashboard loads
 *
 * Requirements: 4.1, 4.2, 4.3, 16.4
 *
 * Note: These tests run against a live Next.js server.
 * They are skipped automatically when the server is unreachable or
 * when the SKIP_E2E env variable is set to "true".
 */

import { test, expect, type Page, type APIRequestContext } from '@playwright/test';

// ─────────────────────────────────────────────────────────────────────────────
// Constants / Fixtures
// ─────────────────────────────────────────────────────────────────────────────

/** Seed-data Office_Admin credentials. Adjust if your seed differs. */
const ADMIN_EMAIL    = 'superadmin@plataforma.local';
const ADMIN_PASSWORD = 'SuperAdmin@1234!';

/** New invited user — generated per-run to avoid collisions. */
const timestamp      = Date.now();
const INVITED_EMAIL  = `e2e.convidado.${timestamp}@exemplo.com.br`;
const INVITED_NAME   = 'Usuário E2E Convidado';

/**
 * Strong password that satisfies the platform policy:
 *   ≥ 12 chars · uppercase · lowercase · digit · special char (Req 4.5)
 */
const INVITED_PASSWORD = 'E2eTeste@2024#';

/** Roles accepted by POST /api/usuarios */
const INVITED_ROLE = 'LAWYER';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Authenticate the admin user via the Auth.js credentials endpoint and
 * return the cookie string so subsequent API calls are authenticated.
 *
 * Auth.js v5 uses POST /api/auth/callback/credentials for sign-in.
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
      email:      ADMIN_EMAIL,
      password:   ADMIN_PASSWORD,
      csrfToken,
      callbackUrl: `${baseURL}/`,
      json:        'true',
    },
    maxRedirects: 0,
  });

  // Auth.js v5 returns 302 on success — cookies are in the response headers
  const rawCookies = signInRes.headers()['set-cookie'] ?? '';
  if (!rawCookies) {
    throw new Error(
      `Sign-in did not return cookies (status ${signInRes.status()}). ` +
      'Check ADMIN_EMAIL / ADMIN_PASSWORD and that the server is seeded.',
    );
  }

  // Collapse multi-value header into a single string for the Cookie header
  const cookieHeader = rawCookies
    .split('\n')
    .map((c) => c.split(';')[0])
    .join('; ');

  return cookieHeader;
}

/**
 * Create an invitation via POST /api/usuarios and return the token.
 * The token is read from the response body (InviteUserUseCase returns it).
 */
async function createInvitation(
  request: APIRequestContext,
  baseURL: string,
  cookieHeader: string,
): Promise<string> {
  const res = await request.post(`${baseURL}/api/usuarios`, {
    data:    { email: INVITED_EMAIL, role: INVITED_ROLE },
    headers: { Cookie: cookieHeader, 'Content-Type': 'application/json' },
  });

  if (!res.ok()) {
    const body = await res.text();
    throw new Error(`Failed to create invitation (${res.status()}): ${body}`);
  }

  const body = await res.json() as { token?: string; invitationId?: string };

  if (!body.token) {
    throw new Error(`Invitation response missing "token" field: ${JSON.stringify(body)}`);
  }

  return body.token;
}

/**
 * Check whether the dev server is reachable; used to skip gracefully in CI
 * environments where no server is running.
 */
async function isServerReachable(request: APIRequestContext, baseURL: string): Promise<boolean> {
  try {
    const res = await request.get(`${baseURL}/api/health`, { timeout: 5_000 });
    return res.ok();
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Test Suite
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Fluxo de Convite e Login', () => {

  // Shared state within the describe block
  let invitationToken = '';
  let cookieHeader    = '';

  // ── Before-all: authenticate admin and create invitation ─────────────────
  test.beforeAll(async ({ request, baseURL }) => {
    const base = baseURL ?? 'http://localhost:3000';

    // Skip gracefully if the server is not available
    const reachable = await isServerReachable(request, base);
    if (!reachable || process.env.SKIP_E2E === 'true') {
      // Signal all tests to skip via a special flag
      return;
    }

    // Authenticate as admin
    cookieHeader = await adminSignIn(request, base);

    // Create invitation — token returned in response body
    invitationToken = await createInvitation(request, base, cookieHeader);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 1 — Happy path: full flow end-to-end
  // ─────────────────────────────────────────────────────────────────────────

  test('Office_Admin cria convite → usuário acessa link → define senha → login → dashboard', async ({
    page,
    baseURL,
  }) => {
    const base = baseURL ?? 'http://localhost:3000';

    // Skip if no server or token was not obtained
    test.skip(
      !invitationToken || process.env.SKIP_E2E === 'true',
      'Servidor não disponível ou token de convite ausente — teste ignorado.',
    );

    // ── Step 1: Navigate to the invitation link ──────────────────────────
    await page.goto(`${base}/convite/${invitationToken}`);

    // The page should show the activation form (valid token)
    await expect(page.locator('h2', { hasText: 'Criar sua conta' })).toBeVisible();
    await expect(page.locator('h2', { hasText: 'Política de Privacidade' })).toBeVisible();
    await expect(page.locator('h2', { hasText: 'Termos de Uso' })).toBeVisible();

    // The invited email should appear on the page
    await expect(page.locator(`text=${INVITED_EMAIL}`)).toBeVisible();

    // ── Step 2: Fill in the activation form ─────────────────────────────
    await page.fill('#name',            INVITED_NAME);
    await page.fill('#password',        INVITED_PASSWORD);
    await page.fill('#confirmPassword', INVITED_PASSWORD);

    // Accept the consent checkbox (Req 13.1, 13.2)
    await page.check('#consent');

    // ── Step 3: Submit and wait for redirect to /login ───────────────────
    await Promise.all([
      page.waitForURL(/\/login/),
      page.click('button[type="submit"]'),
    ]);

    // Should land on the login page with activation confirmation
    await expect(page).toHaveURL(/\/login/);

    // ── Step 4: Login with the newly created credentials ─────────────────
    await loginWithCredentials(page, INVITED_EMAIL, INVITED_PASSWORD);

    // ── Step 5: Verify dashboard loads ───────────────────────────────────
    await page.waitForURL(/\/(dashboard|processos|tarefas)/);
    await expect(page).toHaveURL(/\/(dashboard|processos|tarefas)/);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 2 — Expired / invalid token shows error page
  // ─────────────────────────────────────────────────────────────────────────

  test('Token inválido exibe mensagem de erro e link para login', async ({
    page,
    baseURL,
  }) => {
    const base = baseURL ?? 'http://localhost:3000';

    test.skip(
      process.env.SKIP_E2E === 'true',
      'Servidor não disponível — teste ignorado.',
    );

    const invalidToken = 'token-invalido-nao-existe-no-banco-00000000';
    await page.goto(`${base}/convite/${invalidToken}`);

    // Should show the invalid/expired token error UI
    await expect(page.locator('h1', { hasText: 'Link inválido ou expirado' })).toBeVisible();

    // Must offer a path back to login (Req 4.4)
    const loginLink = page.locator('a', { hasText: 'Ir para o login' });
    await expect(loginLink).toBeVisible();
    await expect(loginLink).toHaveAttribute('href', '/login');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 3 — Password policy is enforced on the activation form
  // ─────────────────────────────────────────────────────────────────────────

  test('Senha fraca é rejeitada com mensagem descritiva', async ({
    page,
    baseURL,
    request,
  }) => {
    const base = baseURL ?? 'http://localhost:3000';

    test.skip(
      process.env.SKIP_E2E === 'true',
      'Servidor não disponível — teste ignorado.',
    );

    // Need a separate (fresh) invitation token for this test
    let weakPasswordToken = '';
    try {
      const freshEmail = `e2e.weak.${Date.now()}@exemplo.com.br`;
      const freshCookie = cookieHeader || await adminSignIn(request, base);
      const res = await request.post(`${base}/api/usuarios`, {
        data:    { email: freshEmail, role: INVITED_ROLE },
        headers: { Cookie: freshCookie, 'Content-Type': 'application/json' },
      });
      if (res.ok()) {
        const body = await res.json() as { token?: string };
        weakPasswordToken = body.token ?? '';
      }
    } catch {
      // If we can't create an extra invite, skip
    }

    test.skip(!weakPasswordToken, 'Não foi possível criar convite auxiliar — teste ignorado.');

    await page.goto(`${base}/convite/${weakPasswordToken}`);
    await expect(page.locator('h2', { hasText: 'Criar sua conta' })).toBeVisible();

    // Fill a weak password (too short, no special chars)
    await page.fill('#name',            'Usuário Teste');
    await page.fill('#password',        'curta');
    await page.fill('#confirmPassword', 'curta');
    await page.check('#consent');

    await page.click('button[type="submit"]');

    // Should stay on the activation page and show a password error
    await expect(page).toHaveURL(new RegExp(`/convite/${weakPasswordToken}`));

    // Error message should mention the password policy
    const errorArea = page.locator('[role="alert"], #password-hint');
    await expect(errorArea.first()).toBeVisible();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 4 — Mismatched passwords are rejected client-side / server-side
  // ─────────────────────────────────────────────────────────────────────────

  test('Senhas divergentes mostram erro de confirmação', async ({
    page,
    baseURL,
    request,
  }) => {
    const base = baseURL ?? 'http://localhost:3000';

    test.skip(
      process.env.SKIP_E2E === 'true',
      'Servidor não disponível — teste ignorado.',
    );

    let mismatchToken = '';
    try {
      const freshEmail = `e2e.mismatch.${Date.now()}@exemplo.com.br`;
      const freshCookie = cookieHeader || await adminSignIn(request, base);
      const res = await request.post(`${base}/api/usuarios`, {
        data:    { email: freshEmail, role: INVITED_ROLE },
        headers: { Cookie: freshCookie, 'Content-Type': 'application/json' },
      });
      if (res.ok()) {
        const body = await res.json() as { token?: string };
        mismatchToken = body.token ?? '';
      }
    } catch {
      // skip
    }

    test.skip(!mismatchToken, 'Não foi possível criar convite auxiliar — teste ignorado.');

    await page.goto(`${base}/convite/${mismatchToken}`);
    await expect(page.locator('h2', { hasText: 'Criar sua conta' })).toBeVisible();

    await page.fill('#name',            'Usuário Mismatch');
    await page.fill('#password',        'SenhaForte@2024!');
    await page.fill('#confirmPassword', 'SenhaForte@2024_diferente');
    await page.check('#consent');

    await page.click('button[type="submit"]');

    // Should stay on the activation page
    await expect(page).toHaveURL(new RegExp(`/convite/${mismatchToken}`));

    // There should be a confirmation-error message
    const confirmError = page.locator('#confirm-error, [role="alert"]');
    await expect(confirmError.first()).toBeVisible();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 5 — Token cannot be reused after activation (Req 4.3)
  // ─────────────────────────────────────────────────────────────────────────

  test('Token já utilizado é inválido em segundo acesso', async ({
    page,
    baseURL,
  }) => {
    const base = baseURL ?? 'http://localhost:3000';

    test.skip(
      !invitationToken || process.env.SKIP_E2E === 'true',
      'Servidor não disponível ou token ausente — teste ignorado.',
    );

    // The invitation token was consumed in Test 1.
    // Navigating to it again must show the "invalid/expired" page.
    await page.goto(`${base}/convite/${invitationToken}`);

    await expect(page.locator('h1', { hasText: 'Link inválido ou expirado' })).toBeVisible();
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// Sub-helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fills the login form and submits.
 * Waits for the server action to complete and for the URL to change.
 */
async function loginWithCredentials(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  // Make sure we are on the login page
  await expect(page.locator('input#email')).toBeVisible({ timeout: 10_000 });

  await page.fill('input#email',    email);
  await page.fill('input#password', password);

  await Promise.all([
    // Wait for navigation away from /login
    page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15_000 }),
    page.click('button[type="submit"]'),
  ]);
}
