/**
 * Structured JSON Logger — Plataforma Jurídica SaaS
 *
 * Utiliza `pino` para emissão de logs estruturados em formato JSON com os
 * campos obrigatórios definidos no Requirement 14.1:
 *   timestamp, level, service, tenantId, userId, action, durationMs,
 *   statusCode, errorMessage, requestId
 *
 * - Em desenvolvimento: pretty print via pino-pretty
 * - Em produção: JSON puro para ingestão por ferramentas de observabilidade
 *
 * Requirements: 14.1, 14.2, 14.3
 */

import pino, { type Logger as PinoLogger } from 'pino';
import type { NextRequest } from 'next/server';

// ─────────────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────────────

/** Campos obrigatórios de cada log estruturado (Req 14.1) */
export interface LogFields {
  /** Identificador do tenant (isolamento por tenant) */
  tenantId?: string;
  /** Identificador do usuário autenticado */
  userId?: string;
  /** Nome da ação sendo executada (ex: 'process:create') */
  action?: string;
  /** Duração da operação em milissegundos (Req 14.3) */
  durationMs?: number;
  /** HTTP status code da resposta */
  statusCode?: number;
  /** Mensagem de erro, se houver (Req 14.2) */
  errorMessage?: string;
  /** Identificador único da requisição para correlação de logs */
  requestId?: string;
}

/** Opções para o helper logRequest */
export type LogRequestOptions = LogFields;

/** Logger com o campo `service` pré-configurado */
export type ServiceLogger = PinoLogger;

// ─────────────────────────────────────────────────────────────────────────────
// Configuração do pino
// ─────────────────────────────────────────────────────────────────────────────

const isDevelopment = process.env.NODE_ENV !== 'production';
const logLevel      = process.env.LOG_LEVEL ?? 'info';

/**
 * Cria a configuração base do pino.
 * Timestamp em ISO 8601 para facilitar leitura e ordenação.
 */
const baseOptions: pino.LoggerOptions = {
  level: logLevel,
  formatters: {
    level(label) {
      // Emite `level` como string legível em vez de número inteiro
      return { level: label };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  // Renomeia o campo padrão `time` para `timestamp` conforme Req 14.1
  messageKey: 'message',
};

/**
 * Destino do log:
 * - Development: pino-pretty para saída humanamente legível no terminal
 * - Production: stdout em JSON puro
 */
function createDestination(): pino.DestinationStream | undefined {
  if (isDevelopment) {
    try {
      // pino-pretty é carregado dinamicamente para evitar dependência em prod
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pretty = require('pino-pretty');
      return pretty({
        colorize:        true,
        translateTime:   'SYS:standard',
        ignore:          'pid,hostname',
        messageKey:      'message',
        levelFirst:      true,
        singleLine:      false,
      });
    } catch {
      // Se pino-pretty não estiver disponível, cai para stdout JSON
      return undefined;
    }
  }
  return undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory pública
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cria um logger filho com o campo `service` fixado.
 * Use este factory para criar loggers específicos de cada módulo/worker.
 *
 * @example
 * const log = createLogger('datajud-worker');
 * log.info({ action: 'sync:start', tenantId }, 'Iniciando sync DataJud');
 */
export function createLogger(service: string): ServiceLogger {
  const destination = createDestination();

  const instance = destination
    ? pino({ ...baseOptions }, destination)
    : pino(baseOptions);

  // Retorna um child logger com `service` pré-definido
  return instance.child({ service });
}

// ─────────────────────────────────────────────────────────────────────────────
// Logger padrão (service: 'app')
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Instância padrão para uso geral na aplicação.
 * Prefira `createLogger('nome-do-modulo')` para contextos específicos.
 */
const logger = createLogger('app');

export default logger;

// ─────────────────────────────────────────────────────────────────────────────
// Helper — logRequest
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Helper tipado para log estruturado de requisições HTTP e operações.
 * Emite um log INFO com todos os campos obrigatórios do Req 14.1.
 * Emite log WARN se `durationMs` superar 2000ms (Req 14.3).
 *
 * @example
 * logRequest(serviceLogger, {
 *   tenantId:    session.tenantId,
 *   userId:      session.userId,
 *   action:      'process:create',
 *   durationMs:  145,
 *   statusCode:  201,
 *   requestId:   requestId,
 * });
 */
export function logRequest(
  log: ServiceLogger,
  options: LogRequestOptions,
): void {
  const {
    tenantId,
    userId,
    action,
    durationMs,
    statusCode,
    errorMessage,
    requestId,
  } = options;

  const fields: Record<string, unknown> = {
    ...(tenantId      !== undefined && { tenantId }),
    ...(userId        !== undefined && { userId }),
    ...(action        !== undefined && { action }),
    ...(durationMs    !== undefined && { durationMs }),
    ...(statusCode    !== undefined && { statusCode }),
    ...(errorMessage  !== undefined && { errorMessage }),
    ...(requestId     !== undefined && { requestId }),
  };

  // Req 14.3: alerta quando duração supera 2000ms
  if (durationMs !== undefined && durationMs > 2000) {
    log.warn(fields, `Operação lenta detectada: ${durationMs}ms${action ? ` [${action}]` : ''}`);
    return;
  }

  // Req 14.2: erros são registrados como ERROR
  if (errorMessage || (statusCode !== undefined && statusCode >= 500)) {
    log.error(fields, errorMessage ?? `Erro HTTP ${statusCode}`);
    return;
  }

  log.info(fields, action ?? 'request');
}

// ─────────────────────────────────────────────────────────────────────────────
// Middleware — requestLoggingMiddleware
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tipo de handler de API Route do Next.js.
 * Compatível com a assinatura de `export async function GET(req, ctx)`.
 */
export type NextApiHandler<C = unknown> = (
  req: NextRequest,
  ctx?: C,
) => Promise<Response> | Response;

/**
 * HOF que envolve um handler de API Route do Next.js adicionando:
 * - Geração automática de `requestId` (via crypto.randomUUID)
 * - Extração de `tenantId` e `userId` dos headers da sessão
 * - Medição de `durationMs`
 * - Log estruturado automático ao início e ao fim de cada requisição
 * - Log de alerta para requisições lentas (> 2000ms — Req 14.3)
 * - Log de erro para respostas 4xx/5xx com `errorMessage`
 *
 * @example
 * export const GET = requestLoggingMiddleware(
 *   async (req) => { ... },
 *   { service: 'tenants-api', action: 'tenant:list' },
 * );
 */
export function requestLoggingMiddleware<C = unknown>(
  handler: NextApiHandler<C>,
  options: {
    service?: string;
    action?: string;
  } = {},
): NextApiHandler<C> {
  const serviceLogger = createLogger(options.service ?? 'api');

  return async (req: NextRequest, ctx?: C): Promise<Response> => {
    const startMs    = Date.now();
    const requestId  = crypto.randomUUID();
    const tenantId   = req.headers.get('x-tenant-id')  ?? undefined;
    const userId     = req.headers.get('x-user-id')    ?? undefined;
    const action     = options.action ?? `${req.method} ${new URL(req.url).pathname}`;

    serviceLogger.info(
      { requestId, tenantId, userId, action },
      'Requisição recebida',
    );

    let response: Response;
    let errorMessage: string | undefined;

    try {
      response = await handler(req, ctx);
    } catch (err) {
      const durationMs = Date.now() - startMs;
      errorMessage = err instanceof Error ? err.message : String(err);

      logRequest(serviceLogger, {
        requestId,
        tenantId,
        userId,
        action,
        durationMs,
        statusCode:   500,
        errorMessage,
      });

      // Re-lança para o handler de erro global tratar
      throw err;
    }

    const durationMs = Date.now() - startMs;
    const statusCode = response.status;

    // Para respostas de erro (4xx/5xx), tenta extrair a mensagem do corpo
    if (statusCode >= 400 && !errorMessage) {
      try {
        // Clona a resposta para não consumir o body original
        const cloned = response.clone();
        const body   = await cloned.json() as { message?: string; code?: string };
        errorMessage = body.message ?? body.code;
      } catch {
        // Ignora erros ao parsear o corpo — pode não ser JSON
      }
    }

    logRequest(serviceLogger, {
      requestId,
      tenantId,
      userId,
      action,
      durationMs,
      statusCode,
      errorMessage,
    });

    return response;
  };
}
