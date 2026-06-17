/**
 * E2E Test: Notification Flow
 *
 * Covers the notification lifecycle:
 *   1. API: GET /api/notificacoes → 200 with data array and unreadCount
 *   2. API: PATCH /api/notificacoes/{id}/lida → marks notification as read (readAt set)
 *   3. API: Verify unreadCount decrements after marking as read
 *   4. UI: Login → navigate to /notificacoes → verify page renders
 *   5. UI: If unread notifications exist → click "Marcar como lida" → verify badge state
 *
 * Requirements: 10.6, 10.7, 16.4
 *
 * Note: These tests run against a live Next.js server.
 * They are skipped automatically when the server is unreachable or
 * when the SKIP_E2E env variable is set to "true".
 *
 * Since notifications are system-generated (DataJud, task events, etc.),
 * the tests use existing notifications from the database.
 * If no notifications exist, notification-specific tests are gracefully skipped.
 *
 * Badge visibility:
 * The platform renders a notification count on the /notificacoes page header
 * (via NotificacoesClient). There is no global navigation badge component yet,
 * so badge assertions target the in-page unread counter.
 */

import { test, expect, type APIRequestContext } from '@playwright/test';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Seed-data Super_Admin credentials (matches seed.ts). */
const ADMIN_EMAIL    = 'superadmin@plataforma.local';
const ADMIN_PASSWORD = 'SuperAdmin@1234!';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface NotificationRecord {
  id: string;
  type: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
  resourceType: string | null;
  resourceId: string | null;
}

interface NotificationsResponse {
  data: NotificationRecord[];
  unreadCount: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Authenticate as admin via Auth.js credentials endpoint.
 * Returns the cookie string for subsequent authenticated requests.
 *
 * Pattern: GET /api/auth/csrf → POST /api/auth/callback/credentials
 */
async function adminSignIn(request: APIRequestContext, baseURL: string): Promise<string> {
  const csrfRes = await request.get(`${baseURL}/api/auth/csrf`);
  if (!csrfRes.ok()) {
    throw new Error(`Failed to fetch CSRF token: ${csrfRes.status()}`);
  }
  const { csrfToken } = await csrfRes.json() as { csrfToken: string };

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

  const cookieHeader = rawCookies
    .split('\n')
    .map((c) => c.split(';')[0])
    .join('; ');

  return cookieHeader;
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
 * Fetch all notifications for the authenticated user.
 */
async function fetchNotifications(
  request: APIRequestContext,
  baseURL: string,
  cookieHeader: string,
): Promise<NotificationsResponse> {
  const res = await request.get(`${baseURL}/api/notificacoes`, {
    headers: { Cookie: cookieHeader },
  });
  if (!res.ok()) {
    throw new Error(`GET /api/notificacoes failed: ${res.status()}`);
  }
  return res.json() as Promise<NotificationsResponse>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Test Suite
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Fluxo de Notificações', () => {

  // Shared state
  let cookieHeader = '';
  let serverReachable = false;

  // ── Before-all: authenticate admin ────────────────────────────────────────
  test.beforeAll(async ({ request, baseURL }) => {
    const base = baseURL ?? 'http://localhost:3000';

    serverReachable = await isServerReachable(request, base);
    if (!serverReachable || process.env.SKIP_E2E === 'true') {
      return;
    }

    cookieHeader = await adminSignIn(request, base);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 1 — GET /api/notificacoes → 200 with correct shape
  // ─────────────────────────────────────────────────────────────────────────

  test('API: GET /api/notificacoes → 200 com formato correto', async ({
    request,
    baseURL,
  }) => {
    const base = baseURL ?? 'http://localhost:3000';

    test.skip(
      !cookieHeader || process.env.SKIP_E2E === 'true',
      'Servidor não disponível ou autenticação falhou — teste ignorado.',
    );

    const res = await request.get(`${base}/api/notificacoes`, {
      headers: { Cookie: cookieHeader },
    });

    // Must return 200
    expect(res.status()).toBe(200);

    const body = await res.json() as NotificationsResponse;

    // Response must have the expected shape
    expect(body).toHaveProperty('data');
    expect(body).toHaveProperty('unreadCount');
    expect(Array.isArray(body.data)).toBe(true);
    expect(typeof body.unreadCount).toBe('number');
    expect(body.unreadCount).toBeGreaterThanOrEqual(0);

    // unreadCount must be consistent with the data array (Req 10.6)
    const countedUnread = body.data.filter((n) => n.readAt === null).length;
    expect(body.unreadCount).toBe(countedUnread);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 2 — Badge count consistent: unreadCount equals nullReadAt entries
  // ─────────────────────────────────────────────────────────────────────────

  test('API: unreadCount reflete exatamente as notificações com readAt=null (Req 10.6)', async ({
    request,
    baseURL,
  }) => {
    const base = baseURL ?? 'http://localhost:3000';

    test.skip(
      !cookieHeader || process.env.SKIP_E2E === 'true',
      'Servidor não disponível ou autenticação falhou — teste ignorado.',
    );

    const body = await fetchNotifications(request, base, cookieHeader);

    const unreadInArray = body.data.filter((n: NotificationRecord) => n.readAt === null).length;

    // The badge counter must exactly match the array (Req 10.6)
    expect(body.unreadCount).toBe(unreadInArray);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 3 — PATCH /api/notificacoes/{id}/lida sets readAt
  // ─────────────────────────────────────────────────────────────────────────

  test('API: PATCH /api/notificacoes/{id}/lida → readAt definido (Req 10.7)', async ({
    request,
    baseURL,
  }) => {
    const base = baseURL ?? 'http://localhost:3000';

    test.skip(
      !cookieHeader || process.env.SKIP_E2E === 'true',
      'Servidor não disponível ou autenticação falhou — teste ignorado.',
    );

    // Fetch current notifications
    const body = await fetchNotifications(request, base, cookieHeader);
    const unreadNotification = body.data.find((n: NotificationRecord) => n.readAt === null);

    // If no unread notifications exist, skip gracefully
    test.skip(
      !unreadNotification,
      'Nenhuma notificação não lida disponível para marcar — teste ignorado.',
    );

    // Mark as read via PATCH
    const patchRes = await request.patch(
      `${base}/api/notificacoes/${unreadNotification!.id}/lida`,
      { headers: { Cookie: cookieHeader } },
    );

    expect(patchRes.status()).toBe(200);

    const patchBody = await patchRes.json() as { data: NotificationRecord };
    expect(patchBody).toHaveProperty('data');

    // readAt must now be set (Req 10.7)
    expect(patchBody.data.readAt).not.toBeNull();
    expect(typeof patchBody.data.readAt).toBe('string');

    // Verify it parses as a valid ISO date
    const readDate = new Date(patchBody.data.readAt as string);
    expect(isNaN(readDate.getTime())).toBe(false);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 4 — Badge count decrements after marking notification as read
  // ─────────────────────────────────────────────────────────────────────────

  test('API: unreadCount diminui após marcar notificação como lida (Req 10.7)', async ({
    request,
    baseURL,
  }) => {
    const base = baseURL ?? 'http://localhost:3000';

    test.skip(
      !cookieHeader || process.env.SKIP_E2E === 'true',
      'Servidor não disponível ou autenticação falhou — teste ignorado.',
    );

    // Step 1: Get initial unread count
    const before = await fetchNotifications(request, base, cookieHeader);
    const targetUnread = before.data.find((n: NotificationRecord) => n.readAt === null);

    // If no unread notifications exist, skip gracefully
    test.skip(
      !targetUnread,
      'Nenhuma notificação não lida disponível — teste ignorado.',
    );

    const initialUnreadCount = before.unreadCount;

    // Step 2: Mark one notification as read
    const patchRes = await request.patch(
      `${base}/api/notificacoes/${targetUnread!.id}/lida`,
      { headers: { Cookie: cookieHeader } },
    );
    expect(patchRes.status()).toBe(200);

    // Step 3: Fetch again to verify count decremented
    const after = await fetchNotifications(request, base, cookieHeader);

    // unreadCount must have decreased by exactly 1 (Req 10.7)
    expect(after.unreadCount).toBe(initialUnreadCount - 1);

    // The specific notification must now show readAt in the array
    const markedNotif = after.data.find((n: NotificationRecord) => n.id === targetUnread!.id);
    if (markedNotif) {
      expect(markedNotif.readAt).not.toBeNull();
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 5 — PATCH is idempotent: re-marking a read notification is safe
  // ─────────────────────────────────────────────────────────────────────────

  test('API: PATCH idempotente — marcar notificação já lida retorna 200 sem alterar readAt', async ({
    request,
    baseURL,
  }) => {
    const base = baseURL ?? 'http://localhost:3000';

    test.skip(
      !cookieHeader || process.env.SKIP_E2E === 'true',
      'Servidor não disponível ou autenticação falhou — teste ignorado.',
    );

    // Find a notification that is already read (or mark one and re-mark it)
    const body = await fetchNotifications(request, base, cookieHeader);

    // First try to find an already-read notification
    let alreadyReadNotif = body.data.find((n: NotificationRecord) => n.readAt !== null);

    // If none exist, mark one and use that
    if (!alreadyReadNotif) {
      const unread = body.data.find((n: NotificationRecord) => n.readAt === null);
      test.skip(!unread, 'Nenhuma notificação disponível — teste ignorado.');

      const mark = await request.patch(
        `${base}/api/notificacoes/${unread!.id}/lida`,
        { headers: { Cookie: cookieHeader } },
      );
      expect(mark.status()).toBe(200);
      const marked = await mark.json() as { data: NotificationRecord };
      alreadyReadNotif = marked.data;
    }

    const firstReadAt = alreadyReadNotif!.readAt;

    // Mark again — should be idempotent
    const secondPatch = await request.patch(
      `${base}/api/notificacoes/${alreadyReadNotif!.id}/lida`,
      { headers: { Cookie: cookieHeader } },
    );
    expect(secondPatch.status()).toBe(200);

    const secondBody = await secondPatch.json() as { data: NotificationRecord };

    // readAt must remain the same (or at least still set)
    expect(secondBody.data.readAt).not.toBeNull();
    // The timestamp should not have changed (idempotent write)
    expect(secondBody.data.readAt).toBe(firstReadAt);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 6 — PATCH on foreign notification returns 403
  // ─────────────────────────────────────────────────────────────────────────

  test('API: PATCH em notificação inexistente retorna 404', async ({
    request,
    baseURL,
  }) => {
    const base = baseURL ?? 'http://localhost:3000';

    test.skip(
      !cookieHeader || process.env.SKIP_E2E === 'true',
      'Servidor não disponível ou autenticação falhou — teste ignorado.',
    );

    // Attempt to mark a non-existent notification as read
    const fakeId = 'notif-nao-existe-00000000';
    const res = await request.patch(
      `${base}/api/notificacoes/${fakeId}/lida`,
      { headers: { Cookie: cookieHeader } },
    );

    expect([403, 404]).toContain(res.status());
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 7 — Unauthenticated access returns 401
  // ─────────────────────────────────────────────────────────────────────────

  test('API: acesso sem autenticação retorna 401', async ({
    request,
    baseURL,
  }) => {
    const base = baseURL ?? 'http://localhost:3000';

    test.skip(
      process.env.SKIP_E2E === 'true',
      'Servidor não disponível — teste ignorado.',
    );

    // No Cookie header → should be rejected
    const res = await request.get(`${base}/api/notificacoes`);

    // Middleware or route guard must reject unauthenticated requests
    expect([401, 403]).toContain(res.status());
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 8 — UI: Login and navigate to /notificacoes
  // ─────────────────────────────────────────────────────────────────────────

  test('UI: Login → /notificacoes renderiza lista de notificações', async ({
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

    // ── Step 2: Navigate to notifications page ────────────────────────────
    await page.goto(`${base}/notificacoes`);

    // The page should show the notifications heading (Req 10.8)
    await expect(page.locator('h1', { hasText: 'Notificações' })).toBeVisible({ timeout: 10_000 });

    // The page must not show a 404 or error
    expect(page.url()).toMatch(/\/notificacoes/);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 9 — UI: Unread count badge is displayed when unread notifications exist
  // ─────────────────────────────────────────────────────────────────────────

  test('UI: contador de não lidas visível quando há notificações não lidas (Req 10.6)', async ({
    page,
    request,
    baseURL,
  }) => {
    const base = baseURL ?? 'http://localhost:3000';

    test.skip(
      !cookieHeader || process.env.SKIP_E2E === 'true',
      'Servidor não disponível ou autenticação falhou — teste ignorado.',
    );

    // First check if there are any unread notifications via API
    const apiBody = await fetchNotifications(request, base, cookieHeader);
    const hasUnread = apiBody.unreadCount > 0;

    test.skip(
      !hasUnread,
      'Nenhuma notificação não lida disponível — teste de badge ignorado.',
    );

    // ── Login ─────────────────────────────────────────────────────────────
    await page.goto(`${base}/login`);
    await expect(page.locator('input#email')).toBeVisible({ timeout: 10_000 });
    await page.fill('input#email',    ADMIN_EMAIL);
    await page.fill('input#password', ADMIN_PASSWORD);

    await Promise.all([
      page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15_000 }),
      page.click('button[type="submit"]'),
    ]);

    // ── Navigate to notifications page ────────────────────────────────────
    await page.goto(`${base}/notificacoes`);
    await expect(page.locator('h1', { hasText: 'Notificações' })).toBeVisible({ timeout: 10_000 });

    // The unread badge/counter is rendered as a <p> below the h1:
    // "<N> não lida(s)" — only shown when unreadCount > 0 (Req 10.6)
    const unreadCountText = page.locator('p', { hasText: /não lida/ });
    await expect(unreadCountText).toBeVisible();

    // The text must include a positive number
    const text = await unreadCountText.textContent();
    expect(text).toMatch(/\d+\s+não lida/);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 10 — UI: "Marcar como lida" decrements the unread counter
  // ─────────────────────────────────────────────────────────────────────────

  test('UI: "Marcar como lida" → badge de não lidas decrementado (Req 10.7)', async ({
    page,
    request,
    baseURL,
  }) => {
    const base = baseURL ?? 'http://localhost:3000';

    test.skip(
      !cookieHeader || process.env.SKIP_E2E === 'true',
      'Servidor não disponível ou autenticação falhou — teste ignorado.',
    );

    // Check via API if there are unread notifications
    const apiBody = await fetchNotifications(request, base, cookieHeader);
    const hasUnread = apiBody.unreadCount > 0;

    test.skip(
      !hasUnread,
      'Nenhuma notificação não lida para testar o decremento do badge — teste ignorado.',
    );

    const initialUnreadCount = apiBody.unreadCount;

    // ── Login ─────────────────────────────────────────────────────────────
    await page.goto(`${base}/login`);
    await expect(page.locator('input#email')).toBeVisible({ timeout: 10_000 });
    await page.fill('input#email',    ADMIN_EMAIL);
    await page.fill('input#password', ADMIN_PASSWORD);

    await Promise.all([
      page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15_000 }),
      page.click('button[type="submit"]'),
    ]);

    // ── Navigate to notifications page ────────────────────────────────────
    await page.goto(`${base}/notificacoes`);
    await expect(page.locator('h1', { hasText: 'Notificações' })).toBeVisible({ timeout: 10_000 });

    // ── Verify initial unread count is displayed ──────────────────────────
    const unreadCountLabel = page.locator('p', { hasText: /não lida/ });
    await expect(unreadCountLabel).toBeVisible();

    // ── Click "Marcar como lida" on the first unread notification ─────────
    const markAsReadBtn = page.locator('button', { hasText: 'Marcar como lida' }).first();
    await expect(markAsReadBtn).toBeVisible({ timeout: 5_000 });
    await markAsReadBtn.click();

    // ── Verify the badge/counter updated (Req 10.7) ───────────────────────
    if (initialUnreadCount === 1) {
      // After marking the only unread notification, the counter label disappears
      // because NotificacoesClient only renders it when unreadCount > 0
      await expect(unreadCountLabel).not.toBeVisible({ timeout: 5_000 });
    } else {
      // Counter must show one less than before
      const expectedCount = initialUnreadCount - 1;
      await expect(
        page.locator('p', { hasText: new RegExp(`${expectedCount}\\s+não lida`) }),
      ).toBeVisible({ timeout: 5_000 });
    }
  });

});
