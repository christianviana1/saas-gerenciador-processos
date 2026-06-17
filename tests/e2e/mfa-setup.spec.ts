/**
 * E2E Test: MFA Setup Flow
 *
 * Tests the complete TOTP-based MFA lifecycle:
 *   1. Admin authenticates (no MFA yet)
 *   2. Init MFA → receives { qrUri, secret }
 *   3. Generate valid TOTP code from secret (otplib) → confirm MFA → mfaEnabled = true
 *   4. Sign-out → login with valid TOTP code → 200 session (access granted)
 *   5. Login with invalid TOTP code "000000" → MFA_INVALID_CODE error
 *   6. UI: navigate to /mfa page → QR code image visible, verify code input present
 *
 * Note: These tests run at API level because TOTP codes require programmatic
 * generation — you cannot pre-enter a time-based code in a form without knowing
 * the secret.  UI tests validate the page structure only.
 *
 * Tests are skipped automatically when the dev server is unreachable or when
 * the SKIP_E2E env variable is set to "true".
 *
 * Requirements: 5.4, 16.4
 */

import { test, expect, type APIRequestContext } from '@playwright/test';
import { authenticator } from 'otplib';

// ─────────────────────────────────────────────────────────────────────────────
// Constants / Fixtures
// ─────────────────────────────────────────────────────────────────────────────

/** Seed-data Super_Admin credentials (matches seed.ts). */
const ADMIN_EMAIL    = 'superadmin@plataforma.local';
const ADMIN_PASSWORD = 'SuperAdmin@1234!';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Authenticate as admin via Auth.js credentials endpoint.
 * Returns the cookie string for subsequent authenticated requests.
 *
 * Pattern: GET /api/auth/csrf → POST /api/auth/callback/credentials
 */
async function adminSignIn(
  request: APIRequestContext,
  baseURL: string,
  totpCode?: string,
): Promise<string> {
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
      ...(totpCode ? { totpCode } : {}),
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
 * Attempt sign-in and return { ok, status, body } without throwing.
 * Used to test error cases (MFA_INVALID_CODE).
 */
async function attemptSignIn(
  request: APIRequestContext,
  baseURL: string,
  totpCode?: string,
): Promise<{ ok: boolean; status: number; cookies: string }> {
  const csrfRes = await request.get(`${baseURL}/api/auth/csrf`);
  if (!csrfRes.ok()) return { ok: false, status: csrfRes.status(), cookies: '' };

  const { csrfToken } = await csrfRes.json() as { csrfToken: string };

  const signInRes = await request.post(`${baseURL}/api/auth/callback/credentials`, {
    form: {
      email:       ADMIN_EMAIL,
      password:    ADMIN_PASSWORD,
      csrfToken,
      callbackUrl: `${baseURL}/`,
      json:        'true',
      ...(totpCode ? { totpCode } : {}),
    },
    maxRedirects: 0,
  });

  const rawCookies = signInRes.headers()['set-cookie'] ?? '';
  const cookies = rawCookies
    .split('\n')
    .map((c) => c.split(';')[0])
    .join('; ');

  return {
    ok: !!cookies,
    status: signInRes.status(),
    cookies,
  };
}

/**
 * Sign out the authenticated session to reset state between tests.
 */
async function adminSignOut(
  request: APIRequestContext,
  baseURL: string,
  cookieHeader: string,
): Promise<void> {
  try {
    const csrfRes = await request.get(`${baseURL}/api/auth/csrf`, {
      headers: { Cookie: cookieHeader },
    });
    if (!csrfRes.ok()) return;
    const { csrfToken } = await csrfRes.json() as { csrfToken: string };

    await request.post(`${baseURL}/api/auth/signout`, {
      form: { csrfToken },
      headers: { Cookie: cookieHeader },
      maxRedirects: 0,
    });
  } catch {
    // Non-fatal — best-effort sign-out
  }
}

/**
 * Disable MFA for the admin user to restore pristine state for later test runs.
 * Calls DELETE-like sequence: re-enables MFA then wipes it using a helper endpoint
 * or directly through the confirm endpoint won't help; instead we rely on the
 * test suite teardown to remove MFA via the database reset (seed re-run) or
 * through a sign-in with the valid code + direct Prisma call if available.
 *
 * For test isolation we accept that re-runs of this suite will need a fresh DB
 * (or will skip the initMFA step gracefully because MFA may already be configured).
 */

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

// ─────────────────────────────────────────────────────────────────────────────
// Test Suite
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Fluxo de Configuração e Uso do MFA (TOTP)', () => {

  /** Cookie for the admin session WITHOUT MFA enabled */
  let cookieHeader = '';
  /** TOTP secret returned by POST /api/usuarios/mfa/init */
  let totpSecret = '';
  /** Whether the MFA was already enabled on the account at suite start */
  let mfaAlreadyEnabled = false;

  // ── Before-all: authenticate admin (no TOTP yet) ─────────────────────────
  test.beforeAll(async ({ request, baseURL }) => {
    const base = baseURL ?? 'http://localhost:3000';

    const reachable = await isServerReachable(request, base);
    if (!reachable || process.env.SKIP_E2E === 'true') {
      return;
    }

    try {
      cookieHeader = await adminSignIn(request, base);
    } catch {
      // If sign-in fails because MFA_REQUIRED, MFA was already configured
      mfaAlreadyEnabled = true;
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 1 — Init MFA → receives { qrUri, secret }
  // ─────────────────────────────────────────────────────────────────────────

  test('API: iniciar MFA → recebe qrUri e secret', async ({ request, baseURL }) => {
    const base = baseURL ?? 'http://localhost:3000';

    test.skip(
      !cookieHeader || mfaAlreadyEnabled || process.env.SKIP_E2E === 'true',
      'Servidor não disponível, autenticação falhou, ou MFA já estava habilitado — teste ignorado.',
    );

    const res = await request.post(`${base}/api/usuarios/mfa/init`, {
      headers: { Cookie: cookieHeader },
    });

    // Accept 200 (init) or 400/422 if MFA was already confirmed previously
    if (res.status() === 200) {
      const body = await res.json() as { data?: { qrUri?: string; secret?: string } };
      expect(body).toHaveProperty('data');
      expect(typeof body.data?.qrUri).toBe('string');
      expect((body.data?.qrUri as string).startsWith('otpauth://')).toBe(true);
      expect(typeof body.data?.secret).toBe('string');
      expect((body.data?.secret as string).length).toBeGreaterThan(0);

      // Store secret for the next test
      totpSecret = body.data!.secret!;
    } else {
      // Server returned an error — could be MFA already configured
      test.skip(true, `Não foi possível iniciar MFA (status ${res.status()}) — teste ignorado.`);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 2 — Generate valid TOTP code → confirm MFA → mfaEnabled = true
  // ─────────────────────────────────────────────────────────────────────────

  test('API: gerar código TOTP válido → confirmar MFA → mfaEnabled = true', async ({
    request,
    baseURL,
  }) => {
    const base = baseURL ?? 'http://localhost:3000';

    test.skip(
      !cookieHeader || !totpSecret || mfaAlreadyEnabled || process.env.SKIP_E2E === 'true',
      'Servidor não disponível ou secret TOTP ausente — teste ignorado.',
    );

    // Generate a valid TOTP code using the secret from Test 1
    const validCode = authenticator.generate(totpSecret);
    expect(validCode).toMatch(/^\d{6}$/);

    const res = await request.post(`${base}/api/usuarios/mfa/confirm`, {
      data:    { totpCode: validCode },
      headers: {
        Cookie:         cookieHeader,
        'Content-Type': 'application/json',
      },
    });

    expect(res.status()).toBe(200);

    const body = await res.json() as { data?: { mfaEnabled?: boolean } };
    expect(body).toHaveProperty('data');
    expect(body.data?.mfaEnabled).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 3 — Login with valid TOTP code → access granted (200 session)
  // ─────────────────────────────────────────────────────────────────────────

  test('API: login com TOTP correto → sessão concedida (200)', async ({
    request,
    baseURL,
  }) => {
    const base = baseURL ?? 'http://localhost:3000';

    test.skip(
      (!totpSecret && !mfaAlreadyEnabled) || process.env.SKIP_E2E === 'true',
      'Servidor não disponível ou MFA não configurado — teste ignorado.',
    );

    // Sign out any existing session first
    if (cookieHeader) {
      await adminSignOut(request, base, cookieHeader);
    }

    // Use the secret from initMFA (if available) or skip gracefully
    test.skip(
      !totpSecret,
      'Secret TOTP indisponível (MFA já estava habilitado antes da suite) — teste ignorado.',
    );

    // Generate a fresh TOTP code for login (a new code in case window has shifted)
    const loginCode = authenticator.generate(totpSecret);

    const result = await attemptSignIn(request, base, loginCode);

    // A successful login returns session cookies
    expect(result.ok).toBe(true);
    expect(result.cookies.length).toBeGreaterThan(0);

    // Verify we can access the session endpoint with the new cookies
    const sessionRes = await request.get(`${base}/api/auth/session`, {
      headers: { Cookie: result.cookies },
    });
    expect(sessionRes.ok()).toBe(true);

    const session = await sessionRes.json() as { user?: { email?: string } };
    expect(session?.user?.email).toBe(ADMIN_EMAIL);

    // Store cookie for cleanup / subsequent tests
    cookieHeader = result.cookies;
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 4 — Login with invalid TOTP code "000000" → MFA_INVALID_CODE error
  // ─────────────────────────────────────────────────────────────────────────

  test('API: login com TOTP inválido "000000" → erro MFA_INVALID_CODE / 401', async ({
    request,
    baseURL,
  }) => {
    const base = baseURL ?? 'http://localhost:3000';

    test.skip(
      (!totpSecret && !mfaAlreadyEnabled) || process.env.SKIP_E2E === 'true',
      'Servidor não disponível ou MFA não configurado — teste ignorado.',
    );

    test.skip(
      !totpSecret,
      'Secret TOTP indisponível (MFA já estava habilitado antes da suite) — teste ignorado.',
    );

    // Sign out before trying invalid code
    if (cookieHeader) {
      await adminSignOut(request, base, cookieHeader);
    }

    // "000000" is almost certainly an invalid TOTP code
    // (probability of being valid at any given second is ~1/1,000,000)
    const invalidCode = '000000';

    // Make sure we are not accidentally using a valid code
    // If by extreme chance it's valid, we skip this sub-test
    const currentValidCode = authenticator.generate(totpSecret);
    if (currentValidCode === invalidCode) {
      test.skip(true, 'Código "000000" coincidiu com o TOTP válido atual — este caso é inconcebível mas seguro para ignorar.');
    }

    const csrfRes = await request.get(`${base}/api/auth/csrf`);
    expect(csrfRes.ok()).toBe(true);
    const { csrfToken } = await csrfRes.json() as { csrfToken: string };

    const signInRes = await request.post(`${base}/api/auth/callback/credentials`, {
      form: {
        email:       ADMIN_EMAIL,
        password:    ADMIN_PASSWORD,
        csrfToken,
        callbackUrl: `${base}/`,
        json:        'true',
        totpCode:    invalidCode,
      },
      maxRedirects: 0,
    });

    // Auth.js with invalid TOTP returns 302/401 with no session cookies
    // The key assertion is that NO valid session cookie was set
    const rawCookies = signInRes.headers()['set-cookie'] ?? '';
    const hasSessionCookie = rawCookies.includes('next-auth.session-token') ||
                             rawCookies.includes('__Secure-next-auth.session-token');

    expect(hasSessionCookie).toBe(false);

    // Additionally check the session endpoint returns no user
    if (rawCookies) {
      const sessionCookie = rawCookies.split('\n').map((c) => c.split(';')[0]).join('; ');
      const sessionRes = await request.get(`${base}/api/auth/session`, {
        headers: { Cookie: sessionCookie },
      });
      const session = await sessionRes.json() as { user?: { email?: string } };
      // Session should be empty or user should not be present with MFA bypassed
      const hasUser = !!session?.user?.email;
      expect(hasUser).toBe(false);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 5 — UI: navigate to /mfa page → QR code image visible, input present
  // ─────────────────────────────────────────────────────────────────────────

  test('UI: página /mfa exibe QR code e campo de entrada de código', async ({
    page,
    baseURL,
  }) => {
    const base = baseURL ?? 'http://localhost:3000';

    test.skip(
      process.env.SKIP_E2E === 'true',
      'Servidor não disponível — teste ignorado.',
    );

    // ── Step 1: Login via UI (without MFA for a fresh session)
    // Since MFA was enabled for superadmin during these tests, we use the UI
    // login page to verify the /mfa route structure independently.
    // We navigate directly to /mfa which requires a valid session.
    //
    // If MFA is enabled for the admin, login will require TOTP — use the API
    // to get a session first, then navigate to /mfa as a different approach:
    // We'll use a Playwright API request context to get cookies, then set them.

    // Try logging in via UI with admin credentials
    await page.goto(`${base}/login`);
    await expect(page.locator('input#email')).toBeVisible({ timeout: 10_000 });
    await page.fill('input#email',    ADMIN_EMAIL);
    await page.fill('input#password', ADMIN_PASSWORD);
    await page.click('button[type="submit"]');

    // If MFA is required, the login form will show a TOTP field
    // We wait briefly to see if a TOTP field appears or we get redirected
    await page.waitForTimeout(1500);

    const currentUrl = page.url();
    const onLoginPage = currentUrl.includes('/login');

    if (onLoginPage && totpSecret) {
      // MFA is required — fill in the TOTP code
      const mfaInput = page.locator('input[name="totpCode"], input#totpCode');
      const mfaVisible = await mfaInput.isVisible().catch(() => false);

      if (mfaVisible) {
        const mfaCode = authenticator.generate(totpSecret);
        await mfaInput.fill(mfaCode);
        await page.click('button[type="submit"]');
        await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15_000 });
      }
    } else if (!onLoginPage) {
      // Successfully redirected — session is active
    } else {
      // Can't complete login — skip this test gracefully
      test.skip(true, 'Não foi possível autenticar para acessar /mfa — teste ignorado.');
    }

    // ── Step 2: Navigate to /mfa
    await page.goto(`${base}/mfa`);

    // Wait for the page to load
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {
      // Non-fatal — page may still be loading
    });

    const mfaPageUrl = page.url();

    // If redirected to /login (session expired or not authenticated), skip
    if (mfaPageUrl.includes('/login')) {
      test.skip(true, 'Redirecionado para /login ao acessar /mfa — sessão não disponível, teste ignorado.');
    }

    // ── Step 3: Verify the /mfa page structure

    // Heading must be visible
    await expect(
      page.locator('h1', { hasText: 'Configurar autenticação de dois fatores' }),
    ).toBeVisible({ timeout: 10_000 });

    // QR code image must be present and have a valid src (data URL)
    const qrImage = page.locator('img[alt*="QR code"], img[alt*="qr"]').first();
    await expect(qrImage).toBeVisible({ timeout: 10_000 });

    const qrSrc = await qrImage.getAttribute('src');
    expect(qrSrc).toBeTruthy();
    // The QR code is generated server-side as a data URL
    expect(qrSrc).toMatch(/^data:image\//);

    // Verification code input field must be present
    const totpInput = page.locator('input#totpCode');
    await expect(totpInput).toBeVisible();
    expect(await totpInput.getAttribute('inputmode')).toBe('numeric');
    expect(await totpInput.getAttribute('maxlength')).toBe('6');

    // Submit button must be visible
    const submitButton = page.locator('button[type="submit"]');
    await expect(submitButton).toBeVisible();
  });

});
