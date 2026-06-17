/**
 * POST /api/push/subscribe
 *
 * Saves a browser Web Push subscription (PushSubscriptionJSON) for the
 * authenticated user. Subscriptions are persisted in Redis keyed by userId
 * so the `notificationWorker` can look them up at delivery time.
 *
 * Body: { subscription: PushSubscriptionJSON }
 *
 * The userId is resolved from the session injected by the middleware
 * (x-user-id / x-tenant-id request headers).
 *
 * Returns 201 on success.
 *
 * Requirements: 11.4, 10.9
 */

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { webPushService } from '@/infrastructure/push/WebPushService';
import { handleApiError, AuthenticationError } from '@/shared/errors';

// ─────────────────────────────────────────────────────────────────────────────
// Input validation schema
// ─────────────────────────────────────────────────────────────────────────────

const PushSubscriptionKeysSchema = z.object({
  p256dh: z.string().min(1),
  auth:   z.string().min(1),
});

const PushSubscriptionJSONSchema = z.object({
  endpoint:       z.string().url('O endpoint da subscription deve ser uma URL válida.'),
  expirationTime: z.number().nullable().optional(),
  keys:           PushSubscriptionKeysSchema,
});

const RequestBodySchema = z.object({
  subscription: PushSubscriptionJSONSchema,
});

// ─────────────────────────────────────────────────────────────────────────────
// Auth helper
// ─────────────────────────────────────────────────────────────────────────────

function readSession(request: NextRequest): { tenantId: string; userId: string } {
  const tenantId = request.headers.get('x-tenant-id');
  const userId   = request.headers.get('x-user-id');

  if (!tenantId || !userId) {
    throw new AuthenticationError('Sessão inválida ou expirada.');
  }

  return { tenantId, userId };
}

// ─────────────────────────────────────────────────────────────────────────────
// POST handler
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const { userId } = readSession(request);

    // Parse and validate body
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Corpo da requisição inválido ou ausente.' },
        { status: 400 },
      );
    }

    const parsed = RequestBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error:   'Dados de subscription inválidos.',
          details: parsed.error.flatten().fieldErrors,
        },
        { status: 422 },
      );
    }

    const { subscription } = parsed.data;

    // Persist subscription in Redis (idempotent — duplicates are ignored)
    await webPushService.saveSubscription(userId, subscription as PushSubscriptionJSON);

    return NextResponse.json(
      { message: 'Subscription registrada com sucesso.' },
      { status: 201 },
    );
  } catch (err) {
    return handleApiError(err) as NextResponse;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE handler — allows clients to remove a subscription (e.g. on unsubscribe)
// ─────────────────────────────────────────────────────────────────────────────

const DeleteBodySchema = z.object({
  endpoint: z.string().url(),
});

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  try {
    const { userId } = readSession(request);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Corpo da requisição inválido ou ausente.' },
        { status: 400 },
      );
    }

    const parsed = DeleteBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Endpoint inválido.' },
        { status: 422 },
      );
    }

    await webPushService.removeSubscription(userId, parsed.data.endpoint);

    return NextResponse.json(
      { message: 'Subscription removida com sucesso.' },
      { status: 200 },
    );
  } catch (err) {
    return handleApiError(err) as NextResponse;
  }
}
