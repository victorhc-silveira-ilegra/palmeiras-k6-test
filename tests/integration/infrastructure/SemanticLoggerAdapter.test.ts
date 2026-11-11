import { describe, expect, it } from 'vitest';
import {
  SemanticLoggerAdapter,
  logEvent,
  sanitizeLogFields,
} from '../../../src/infrastructure/logging/SemanticLoggerAdapter.ts';

describe('SemanticLoggerAdapter', () => {
  it('sanitiza segredos, tokens Bearer, cookies e payloads longos', () => {
    const longBody = 'a'.repeat(300);
    const sanitized = sanitizeLogFields({
      authorization: 'Bearer abc123',
      Cookie: 'wordpress_logged_in=xyz',
      nested: { api_key: 'secret-value', publicTag: 'ok' },
      endpointUrl: 'https://hml.example.com?token=secret123&q=palmeiras',
      bearerText: 'Bearer my-secret-jwt-token',
      payload: longBody,
      count: 3,
      items: ['tok', 'a'.repeat(280)],
    });

    expect(sanitized.authorization).toBe('[REDACTED]');
    expect(sanitized.Cookie).toBe('[REDACTED]');
    expect(sanitized.nested).toEqual({ api_key: '[REDACTED]', publicTag: 'ok' });
    expect(sanitized.endpointUrl).toBe('https://hml.example.com?token=[REDACTED]&q=palmeiras');
    expect(sanitized.bearerText).toBe('Bearer [REDACTED]');
    expect(String(sanitized.payload).endsWith('[TRUNCATED]')).toBe(true);
    expect(sanitized.count).toBe(3);
    expect((sanitized.items as unknown[])[1]).toContain('[TRUNCATED]');
  });

  it('filtra por nivel minimo, logErrors, sampleRate e formata JSON estruturado', () => {
    const lines: { level: string; msg: string }[] = [];
    const sink = {
      info: (msg: string): void => {
        lines.push({ level: 'INFO', msg });
      },
      warn: (msg: string): void => {
        lines.push({ level: 'WARN', msg });
      },
      error: (msg: string): void => {
        lines.push({ level: 'ERROR', msg });
      },
    };

    const logger = new SemanticLoggerAdapter(sink, {
      minLevel: 'INFO',
      logErrors: true,
      sampleRate: 1,
      nowIso: (): string => '2026-11-11T22:00:00.000Z',
      random: (): number => 0.5,
    });

    logger.emit('DEBUG', 'k6.debug.ignored', { step: 1 });
    logger.emit('INFO', 'k6.cycle.started', { scenario: 'smoke' });
    logger.emit('WARN', 'k6.guardrail.prod_blocked', { authorization: 'secret' });
    logger.emit('ERROR', 'k6.journey.failed');

    expect(lines).toHaveLength(3);
    expect(lines[0]?.level).toBe('INFO');
    expect(JSON.parse(lines[0]?.msg ?? '{}')).toEqual({
      ts: '2026-11-11T22:00:00.000Z',
      level: 'INFO',
      event: 'k6.cycle.started',
      scenario: 'smoke',
    });
    expect(JSON.parse(lines[1]?.msg ?? '{}').authorization).toBe('[REDACTED]');

    logEvent(sink, 'WARN', 'k6.direct.event', { ok: true }, { minLevel: 'WARN', logErrors: false });
    expect(lines).toHaveLength(3);

    logEvent(
      sink,
      'WARN',
      'k6.sampled.out',
      {},
      { minLevel: 'DEBUG', logErrors: true, sampleRate: 0.1, random: () => 0.9 }
    );
    expect(lines).toHaveLength(3);

    logEvent(sink, 'INFO', 'k6.default.options');
    expect(lines).toHaveLength(4);

    logEvent(sink, 'WARN', 'k6.default.random', {}, { sampleRate: 0.99 });
    expect(lines.length).toBeGreaterThanOrEqual(4);

    const defaultOptsLogger = new SemanticLoggerAdapter(sink);
    defaultOptsLogger.emit('INFO', 'k6.adapter.default');
    expect(lines.length).toBeGreaterThanOrEqual(5);
  });
});
