import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RateLimiter, RATE_LIMITS } from './RateLimiter';

// ─────────────────────────────────────────────────────────────────
// Mock Redis
// ─────────────────────────────────────────────────────────────────

/**
 * Cria um mock de cliente Redis em memória para testes unitários.
 * Simula INCR, TTL, EXPIRE, EXISTS, SET, GET, DEL e pipeline.
 */
function createMockRedis() {
  const store = new Map<string, { value: string; expiresAt: number | null }>();

  const getEntry = (key: string) => {
    const entry = store.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      store.delete(key);
      return null;
    }
    return entry;
  };

  const redis = {
    store,

    async incr(key: string): Promise<number> {
      const entry = getEntry(key);
      const current = entry ? parseInt(entry.value, 10) : 0;
      const newValue = current + 1;
      store.set(key, {
        value: String(newValue),
        expiresAt: entry?.expiresAt ?? null,
      });
      return newValue;
    },

    async ttl(key: string): Promise<number> {
      const entry = getEntry(key);
      if (!entry) return -2; // key does not exist
      if (entry.expiresAt === null) return -1; // no expiry
      return Math.ceil((entry.expiresAt - Date.now()) / 1000);
    },

    async expire(key: string, seconds: number): Promise<number> {
      const entry = store.get(key);
      if (!entry) return 0;
      store.set(key, { ...entry, expiresAt: Date.now() + seconds * 1000 });
      return 1;
    },

    async exists(key: string): Promise<number> {
      return getEntry(key) ? 1 : 0;
    },

    async set(key: string, value: string, mode?: string, ttlSeconds?: number): Promise<string> {
      const expiresAt = mode === 'EX' && ttlSeconds ? Date.now() + ttlSeconds * 1000 : null;
      store.set(key, { value, expiresAt });
      return 'OK';
    },

    async get(key: string): Promise<string | null> {
      const entry = getEntry(key);
      return entry?.value ?? null;
    },

    async del(...keys: string[]): Promise<number> {
      let count = 0;
      for (const key of keys) {
        if (store.delete(key)) count++;
      }
      return count;
    },

    pipeline() {
      const commands: Array<() => Promise<unknown>> = [];

      const pipe = {
        incr: (key: string) => {
          commands.push(() => redis.incr(key));
          return pipe;
        },
        ttl: (key: string) => {
          commands.push(() => redis.ttl(key));
          return pipe;
        },
        async exec(): Promise<Array<[null, unknown]>> {
          const results: Array<[null, unknown]> = [];
          for (const cmd of commands) {
            const result = await cmd();
            results.push([null, result]);
          }
          return results;
        },
      };

      return pipe;
    },

    on: vi.fn(),

    async quit(): Promise<string> {
      return 'OK';
    },
  };

  return redis;
}

// ─────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────

describe('RATE_LIMITS constants', () => {
  it('deve exportar todas as configurações pré-definidas', () => {
    expect(RATE_LIMITS.LOGIN_BY_IP).toBeDefined();
    expect(RATE_LIMITS.LOGIN_BY_EMAIL).toBeDefined();
    expect(RATE_LIMITS.API_BY_USER).toBeDefined();
    expect(RATE_LIMITS.API_BY_TENANT).toBeDefined();
    expect(RATE_LIMITS.PUBLIC).toBeDefined();
  });

  it('LOGIN_BY_IP deve ter janela de 5 min e limite 20', () => {
    expect(RATE_LIMITS.LOGIN_BY_IP.windowMs).toBe(5 * 60 * 1000);
    expect(RATE_LIMITS.LOGIN_BY_IP.max).toBe(20);
    expect(RATE_LIMITS.LOGIN_BY_IP.keyPrefix).toBe('rl:login:ip:');
  });

  it('LOGIN_BY_EMAIL deve ter janela de 5 min e limite 5', () => {
    expect(RATE_LIMITS.LOGIN_BY_EMAIL.windowMs).toBe(5 * 60 * 1000);
    expect(RATE_LIMITS.LOGIN_BY_EMAIL.max).toBe(5);
    expect(RATE_LIMITS.LOGIN_BY_EMAIL.keyPrefix).toBe('rl:login:email:');
  });

  it('API_BY_USER deve ter janela de 1 min e limite 300', () => {
    expect(RATE_LIMITS.API_BY_USER.windowMs).toBe(60 * 1000);
    expect(RATE_LIMITS.API_BY_USER.max).toBe(300);
    expect(RATE_LIMITS.API_BY_USER.keyPrefix).toBe('rl:api:user:');
  });

  it('API_BY_TENANT deve ter janela de 1 min e limite 2000', () => {
    expect(RATE_LIMITS.API_BY_TENANT.windowMs).toBe(60 * 1000);
    expect(RATE_LIMITS.API_BY_TENANT.max).toBe(2000);
    expect(RATE_LIMITS.API_BY_TENANT.keyPrefix).toBe('rl:api:tenant:');
  });

  it('PUBLIC deve ter janela de 1 min e limite 100', () => {
    expect(RATE_LIMITS.PUBLIC.windowMs).toBe(60 * 1000);
    expect(RATE_LIMITS.PUBLIC.max).toBe(100);
    expect(RATE_LIMITS.PUBLIC.keyPrefix).toBe('rl:pub:ip:');
  });
});

describe('RateLimiter.check()', () => {
  let limiter: RateLimiter;
  let mockRedis: ReturnType<typeof createMockRedis>;

  beforeEach(() => {
    mockRedis = createMockRedis();
    limiter = new RateLimiter(mockRedis as never);
  });

  it('deve permitir a primeira requisição', async () => {
    const result = await limiter.check('key:test', 5, 60);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
  });

  it('deve decrementar remaining a cada chamada', async () => {
    for (let i = 1; i <= 4; i++) {
      const result = await limiter.check('key:seq', 5, 60);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(5 - i);
    }
  });

  it('deve bloquear quando o limite for atingido', async () => {
    for (let i = 0; i < 5; i++) {
      await limiter.check('key:block', 5, 60);
    }
    const result = await limiter.check('key:block', 5, 60);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('deve retornar resetAt no futuro', async () => {
    const before = Date.now();
    const result = await limiter.check('key:reset', 5, 60);
    expect(result.resetAt.getTime()).toBeGreaterThan(before);
  });

  it('deve usar chaves independentes para IPs diferentes', async () => {
    await limiter.check('ip:1.2.3.4', 2, 60);
    await limiter.check('ip:1.2.3.4', 2, 60);
    const blockedResult = await limiter.check('ip:1.2.3.4', 2, 60);

    const otherResult = await limiter.check('ip:9.9.9.9', 2, 60);

    expect(blockedResult.allowed).toBe(false);
    expect(otherResult.allowed).toBe(true);
  });
});

describe('RateLimiter.checkWithConfig()', () => {
  let limiter: RateLimiter;
  let mockRedis: ReturnType<typeof createMockRedis>;

  beforeEach(() => {
    mockRedis = createMockRedis();
    limiter = new RateLimiter(mockRedis as never);
  });

  it('deve prefixar a chave com keyPrefix do config', async () => {
    await limiter.checkWithConfig(RATE_LIMITS.LOGIN_BY_IP, '192.168.0.1');
    const storedKey = [...mockRedis.store.keys()][0];
    expect(storedKey).toBe('rl:login:ip:192.168.0.1');
  });

  it('deve respeitar o max do config', async () => {
    // LOGIN_BY_EMAIL tem max=5
    for (let i = 0; i < 5; i++) {
      const r = await limiter.checkWithConfig(RATE_LIMITS.LOGIN_BY_EMAIL, 'user@test.com');
      expect(r.allowed).toBe(true);
    }
    const blocked = await limiter.checkWithConfig(RATE_LIMITS.LOGIN_BY_EMAIL, 'user@test.com');
    expect(blocked.allowed).toBe(false);
  });
});

describe('RateLimiter.isLockedOut()', () => {
  let limiter: RateLimiter;
  let mockRedis: ReturnType<typeof createMockRedis>;

  beforeEach(() => {
    mockRedis = createMockRedis();
    limiter = new RateLimiter(mockRedis as never);
  });

  it('deve retornar false para email sem lockout', async () => {
    expect(await limiter.isLockedOut('user@test.com')).toBe(false);
  });

  it('deve retornar true após 5 falhas de login', async () => {
    for (let i = 0; i < 5; i++) {
      await limiter.recordFailedLogin('user@test.com');
    }
    expect(await limiter.isLockedOut('user@test.com')).toBe(true);
  });

  it('deve normalizar email para lowercase', async () => {
    for (let i = 0; i < 5; i++) {
      await limiter.recordFailedLogin('User@Test.COM');
    }
    // Consultar com capitalização diferente deve ainda detectar lockout
    expect(await limiter.isLockedOut('user@test.com')).toBe(true);
  });
});

describe('RateLimiter.recordFailedLogin()', () => {
  let limiter: RateLimiter;
  let mockRedis: ReturnType<typeof createMockRedis>;

  beforeEach(() => {
    mockRedis = createMockRedis();
    limiter = new RateLimiter(mockRedis as never);
  });

  it('não deve gerar lockout com menos de 5 falhas', async () => {
    for (let i = 0; i < 4; i++) {
      await limiter.recordFailedLogin('user@test.com');
    }
    expect(await limiter.isLockedOut('user@test.com')).toBe(false);
  });

  it('deve gerar lockout exatamente na 5ª falha', async () => {
    for (let i = 0; i < 5; i++) {
      await limiter.recordFailedLogin('user@test.com');
    }
    expect(await limiter.isLockedOut('user@test.com')).toBe(true);
  });

  it('deve incrementar contador de falhas', async () => {
    await limiter.recordFailedLogin('user@test.com');
    await limiter.recordFailedLogin('user@test.com');
    const count = await limiter.getFailureCount('user@test.com');
    expect(count).toBe(2);
  });

  it('deve manter lockout independente entre emails', async () => {
    for (let i = 0; i < 5; i++) {
      await limiter.recordFailedLogin('user1@test.com');
    }
    expect(await limiter.isLockedOut('user1@test.com')).toBe(true);
    expect(await limiter.isLockedOut('user2@test.com')).toBe(false);
  });
});

describe('RateLimiter.clearFailedLogins()', () => {
  let limiter: RateLimiter;
  let mockRedis: ReturnType<typeof createMockRedis>;

  beforeEach(() => {
    mockRedis = createMockRedis();
    limiter = new RateLimiter(mockRedis as never);
  });

  it('deve remover lockout existente', async () => {
    for (let i = 0; i < 5; i++) {
      await limiter.recordFailedLogin('user@test.com');
    }
    expect(await limiter.isLockedOut('user@test.com')).toBe(true);

    await limiter.clearFailedLogins('user@test.com');
    expect(await limiter.isLockedOut('user@test.com')).toBe(false);
  });

  it('deve zerar o contador de falhas', async () => {
    await limiter.recordFailedLogin('user@test.com');
    await limiter.recordFailedLogin('user@test.com');
    await limiter.clearFailedLogins('user@test.com');
    expect(await limiter.getFailureCount('user@test.com')).toBe(0);
  });

  it('não deve lançar erro se não houver lockout para limpar', async () => {
    await expect(limiter.clearFailedLogins('nobody@test.com')).resolves.not.toThrow();
  });

  it('deve normalizar email para lowercase ao limpar', async () => {
    for (let i = 0; i < 5; i++) {
      await limiter.recordFailedLogin('User@Test.COM');
    }
    await limiter.clearFailedLogins('USER@TEST.COM');
    expect(await limiter.isLockedOut('user@test.com')).toBe(false);
  });
});

describe('RateLimiter — lockout flow de login (Requirement 5.5)', () => {
  let limiter: RateLimiter;
  let mockRedis: ReturnType<typeof createMockRedis>;

  beforeEach(() => {
    mockRedis = createMockRedis();
    limiter = new RateLimiter(mockRedis as never);
  });

  it('deve seguir o fluxo completo: falhas → lockout → limpeza → sem lockout', async () => {
    const email = 'advogado@escritorio.com.br';

    // Sem lockout no início
    expect(await limiter.isLockedOut(email)).toBe(false);

    // 4 falhas — ainda não em lockout
    for (let i = 0; i < 4; i++) {
      await limiter.recordFailedLogin(email);
    }
    expect(await limiter.isLockedOut(email)).toBe(false);

    // 5ª falha — lockout ativado
    await limiter.recordFailedLogin(email);
    expect(await limiter.isLockedOut(email)).toBe(true);

    // Login bem-sucedido — limpa o lockout
    await limiter.clearFailedLogins(email);
    expect(await limiter.isLockedOut(email)).toBe(false);
    expect(await limiter.getFailureCount(email)).toBe(0);
  });
});
