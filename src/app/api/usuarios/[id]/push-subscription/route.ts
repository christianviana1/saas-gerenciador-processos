/**
 * API Route: POST /api/usuarios/[id]/push-subscription
 *
 * Registra (ou substitui) a subscription VAPID de Push Notification
 * do usuário autenticado. A subscription é persistida no Redis com a
 * chave `push:sub:{userId}` sem TTL.
 *
 * Requirements: 10.1, 11.4
 */

import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { redisConnection } from '@/infrastructure/queues/queues';
import { handleApiError, AuthenticationError, ForbiddenError } from '@/shared/errors';

// ─────────────────────────────────────────────────────────────────────────────
// Zod Schema
// Mirrors the PushSubscription Web API shape: { endpoint, keys: { p256dh, auth } }
// ─────────────────────────────────────────────────────────────────────────────

const PushSubscriptionSchema = z.object({
  endpoint: z.string().url('endpoint deve ser uma URL válida'),
  keys: z.object({
    p256dh: z.string().min(1, 'Chave p256dh é obrigatória'),
    auth:   z.string().min(1, 'Chave auth é obrigatória'),
  }),
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/usuarios/[id]/push-subscription
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Recebe o objeto PushSubscription do cliente, valida e armazena no Redis.
 *
 * O usuário autenticado só pode registrar a própria subscription (userId === id).
 * A chave Redis é `push:sub:{userId}` e não possui TTL — persiste até ser
 * sobrescrita ou explicitamente removida.
 *
 * Requirements: 10.1, 11.4
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    // ── 1. Extrair contexto da sessão ─────────────────────────────────────────
    const tenantId = request.headers.get('x-tenant-id');
    const userId   = request.headers.get('x-user-id');

    if (!tenantId || !userId) {
      throw new AuthenticationError('Sessão inválida ou expirada.');
    }

    // ── 2. Verificar que o usuário só registra a própria subscription ─────────
    const { id: targetUserId } = await params;

    if (userId !== targetUserId) {
      throw new ForbiddenError(
        'Você só pode registrar a própria push subscription.',
        { userId, targetUserId },
      );
    }

    // ── 3. Validar corpo da requisição ────────────────────────────────────────
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json(
        { code: 'VALIDATION_ERROR', message: 'Corpo da requisição inválido.' },
        { status: 400 },
      );
    }

    const parsed = PushSubscriptionSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        {
          code:    'VALIDATION_ERROR',
          message: 'Dados de subscription inválidos.',
          details: parsed.error.flatten().fieldErrors,
        },
        { status: 400 },
      );
    }

    const subscription = parsed.data;

    // ── 4. Persistir no Redis sem TTL ─────────────────────────────────────────
    // Chave: push:sub:{userId}
    // Valor: JSON da PushSubscription
    const redisKey = `push:sub:${targetUserId}`;
    await redisConnection.set(redisKey, JSON.stringify(subscription));

    // ── 5. Responder ──────────────────────────────────────────────────────────
    return Response.json(
      { message: 'Push subscription registrada com sucesso.' },
      { status: 200 },
    );
  } catch (err) {
    return handleApiError(err);
  }
}
