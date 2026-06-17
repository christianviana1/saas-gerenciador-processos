import Redis from 'ioredis';

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export interface RateLimitConfig {
  /** Janela de tempo em milissegundos */
  windowMs: number;
  /** Máximo de requisições permitidas na janela */
  max: number;
  /** Prefixo da chave Redis */
  keyPrefix: string;
}

export interface RateLimitResult {
  /** Se a requisição é permitida */
  allowed: boolean;
  /** Requisições restantes na janela atual */
  remaining: number;
  /** Data/hora em que a janela reseta */
  resetAt: Date;
}

// ─────────────────────────────────────────────────────────────────
// Predefined Rate Limit Configs
// ─────────────────────────────────────────────────────────────────

/**
 * Configurações pré-definidas de rate limit por tipo de operação.
 *
 * - LOGIN_BY_IP: 20 tentativas por IP a cada 5 minutos
 * - LOGIN_BY_EMAIL: 5 tentativas por email a cada 5 minutos (proteção contra brute-force)
 * - API_BY_USER: 300 requisições por usuário autenticado por minuto
 * - API_BY_TENANT: 2000 requisições por tenant por minuto
 * - PUBLIC: 100 requisições por IP em endpoint público por minuto
 */
export const RATE_LIMITS = {
  LOGIN_BY_IP: {
    windowMs: 5 * 60 * 1000, // 5 minutos
    max: 20,
    keyPrefix: 'rl:login:ip:',
  } satisfies RateLimitConfig,

  LOGIN_BY_EMAIL: {
    windowMs: 5 * 60 * 1000, // 5 minutos
    max: 5,
    keyPrefix: 'rl:login:email:',
  } satisfies RateLimitConfig,

  API_BY_USER: {
    windowMs: 60 * 1000, // 1 minuto
    max: 300,
    keyPrefix: 'rl:api:user:',
  } satisfies RateLimitConfig,

  API_BY_TENANT: {
    windowMs: 60 * 1000, // 1 minuto
    max: 2000,
    keyPrefix: 'rl:api:tenant:',
  } satisfies RateLimitConfig,

  PUBLIC: {
    windowMs: 60 * 1000, // 1 minuto
    max: 100,
    keyPrefix: 'rl:pub:ip:',
  } satisfies RateLimitConfig,
} as const;

// ─────────────────────────────────────────────────────────────────
// Lockout Config
// ─────────────────────────────────────────────────────────────────

const LOCKOUT_CONFIG = {
  /** Número de falhas consecutivas antes do lockout */
  maxFailures: 5,
  /** Duração do lockout em milissegundos (15 minutos) */
  lockoutDurationMs: 15 * 60 * 1000,
  /** Prefixo da chave Redis para lockout */
  lockoutKeyPrefix: 'lockout:email:',
  /** Prefixo da chave Redis para contador de falhas */
  failuresKeyPrefix: 'failures:email:',
} as const;

// ─────────────────────────────────────────────────────────────────
// RateLimiter Class
// ─────────────────────────────────────────────────────────────────

export class RateLimiter {
  private readonly redis: Redis;

  constructor(redis?: Redis) {
    if (redis) {
      this.redis = redis;
    } else {
      this.redis = new Redis({
        host: process.env.REDIS_HOST ?? 'localhost',
        port: Number(process.env.REDIS_PORT ?? 6379),
        password: process.env.REDIS_PASSWORD ?? undefined,
        // Reconexão automática com backoff
        retryStrategy: (times) => Math.min(times * 100, 3000),
        // Não lança exceções ao perder conexão — falha aberta (permite tráfego)
        enableOfflineQueue: false,
        lazyConnect: true,
      });

      this.redis.on('error', (err) => {
        // Log silencioso — o rate limiter não deve derrubar a aplicação
        console.error('[RateLimiter] Redis connection error:', err.message);
      });
    }
  }

  /**
   * Verifica e registra uma requisição usando sliding window counter.
   *
   * Algoritmo: INCR na chave com TTL igual à janela.
   * Se a chave não existir, cria com EXPIRE.
   * Se o contador ultrapassar o limite, bloqueia.
   *
   * @param key - Identificador único da requisição (ex: IP, email, userId)
   * @param limit - Número máximo de requisições permitidas na janela
   * @param windowSeconds - Tamanho da janela em segundos
   */
  async check(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<RateLimitResult> {
    try {
      // Pipeline atômico: INCR + EXPIRE condicional
      const redisKey = key;
      const pipeline = this.redis.pipeline();
      pipeline.incr(redisKey);
      pipeline.ttl(redisKey);
      const results = await pipeline.exec();

      if (!results) {
        // Redis indisponível — fail open (permite a requisição)
        return this.buildOpenResult(limit, windowSeconds);
      }

      const [incrResult, ttlResult] = results;
      const count = incrResult?.[1] as number;
      const ttl = ttlResult?.[1] as number;

      // Se a chave é nova (TTL = -1 significa sem expiração), definir TTL
      if (ttl === -1 || ttl < 0) {
        await this.redis.expire(redisKey, windowSeconds);
      }

      // TTL restante para calcular o resetAt
      const currentTtl = ttl > 0 ? ttl : windowSeconds;
      const resetAt = new Date(Date.now() + currentTtl * 1000);
      const remaining = Math.max(0, limit - count);
      const allowed = count <= limit;

      return { allowed, remaining, resetAt };
    } catch {
      // Fail open — se Redis estiver indisponível, não bloqueia tráfego
      return this.buildOpenResult(limit, windowSeconds);
    }
  }

  /**
   * Verifica se um email está bloqueado por excesso de falhas de login.
   *
   * @param email - Email do usuário a verificar
   * @returns true se o email estiver em lockout
   */
  async isLockedOut(email: string): Promise<boolean> {
    try {
      const lockoutKey = `${LOCKOUT_CONFIG.lockoutKeyPrefix}${email.toLowerCase()}`;
      const exists = await this.redis.exists(lockoutKey);
      return exists === 1;
    } catch {
      // Fail open — se Redis indisponível, não bloqueia o usuário
      return false;
    }
  }

  /**
   * Registra uma falha de login para o email informado.
   * Após atingir `maxFailures` falhas, aplica lockout de 15 minutos.
   *
   * @param email - Email do usuário que falhou o login
   */
  async recordFailedLogin(email: string): Promise<void> {
    try {
      const normalizedEmail = email.toLowerCase();
      const failuresKey = `${LOCKOUT_CONFIG.failuresKeyPrefix}${normalizedEmail}`;
      const lockoutKey = `${LOCKOUT_CONFIG.lockoutKeyPrefix}${normalizedEmail}`;

      // Janela de contagem de falhas = duração do lockout
      const windowSeconds = Math.ceil(LOCKOUT_CONFIG.lockoutDurationMs / 1000);

      const pipeline = this.redis.pipeline();
      pipeline.incr(failuresKey);
      pipeline.ttl(failuresKey);
      const results = await pipeline.exec();

      if (!results) return;

      const failures = results[0]?.[1] as number;
      const ttl = results[1]?.[1] as number;

      // Se a chave de falhas é nova, definir TTL para a janela de lockout
      if (ttl === -1 || ttl < 0) {
        await this.redis.expire(failuresKey, windowSeconds);
      }

      // Aplicar lockout após atingir o limite de falhas
      if (failures >= LOCKOUT_CONFIG.maxFailures) {
        await this.redis.set(lockoutKey, '1', 'EX', windowSeconds);
      }
    } catch {
      // Falha silenciosa — o login ainda prosseguirá com tratamento normal
    }
  }

  /**
   * Limpa os contadores de falha de login para o email informado.
   * Deve ser chamado após login bem-sucedido.
   *
   * @param email - Email do usuário que fez login com sucesso
   */
  async clearFailedLogins(email: string): Promise<void> {
    try {
      const normalizedEmail = email.toLowerCase();
      const failuresKey = `${LOCKOUT_CONFIG.failuresKeyPrefix}${normalizedEmail}`;
      const lockoutKey = `${LOCKOUT_CONFIG.lockoutKeyPrefix}${normalizedEmail}`;

      await this.redis.del(failuresKey, lockoutKey);
    } catch {
      // Falha silenciosa
    }
  }

  /**
   * Retorna a contagem atual de falhas de login para o email informado.
   * Útil para logging e auditoria.
   *
   * @param email - Email a consultar
   */
  async getFailureCount(email: string): Promise<number> {
    try {
      const failuresKey = `${LOCKOUT_CONFIG.failuresKeyPrefix}${email.toLowerCase()}`;
      const value = await this.redis.get(failuresKey);
      return value ? parseInt(value, 10) : 0;
    } catch {
      return 0;
    }
  }

  /**
   * Aplica um config de rate limit pré-definido sobre uma chave.
   * Combina o keyPrefix do config com o identificador fornecido.
   *
   * @param config - Configuração de rate limit (use RATE_LIMITS.*)
   * @param identifier - Identificador da chave (IP, userId, tenantId, etc.)
   */
  async checkWithConfig(
    config: RateLimitConfig,
    identifier: string,
  ): Promise<RateLimitResult> {
    const key = `${config.keyPrefix}${identifier}`;
    const windowSeconds = Math.ceil(config.windowMs / 1000);
    return this.check(key, config.max, windowSeconds);
  }

  /**
   * Fecha a conexão Redis (usar em teardown de testes ou shutdown graceful).
   */
  async disconnect(): Promise<void> {
    await this.redis.quit();
  }

  // ─────────────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────────────

  private buildOpenResult(limit: number, windowSeconds: number): RateLimitResult {
    return {
      allowed: true,
      remaining: limit,
      resetAt: new Date(Date.now() + windowSeconds * 1000),
    };
  }
}

// ─────────────────────────────────────────────────────────────────
// Singleton
// ─────────────────────────────────────────────────────────────────

/**
 * Instância singleton do RateLimiter para uso em toda a aplicação.
 * A conexão Redis é inicializada de forma lazy (lazyConnect: true).
 */
export const rateLimiter = new RateLimiter();
