import { readFileSync } from 'node:fs';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { ZodError } from 'zod';
import { ApiError } from './errors.js';

/** Express app with JSON parsing, security headers, /health, /openapi.yaml and error mapping. */
export function createBaseApp(
  service: string,
  openapiFile: URL,
): { app: Express; finish: () => void } {
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    next();
  });
  app.use(express.json({ limit: '100kb' }));
  app.get('/health', (_req, res) => {
    res.json({ service, status: 'ok' });
  });
  app.get('/openapi.yaml', (_req, res) => {
    res.type('application/yaml').send(readFileSync(openapiFile, 'utf8'));
  });

  /** Call after routes are registered. */
  const finish = () => {
    app.use((_req, res) => {
      res.status(404).json({ error: { code: 'not_found', message: 'Route not found' } });
    });
    app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
      if (err instanceof ApiError) {
        res.status(err.status).json({ error: { code: err.code, message: err.message } });
      } else if (err instanceof ZodError) {
        res.status(400).json({
          error: {
            code: 'validation_error',
            message: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
          },
        });
      } else if ((err as any)?.type === 'entity.parse.failed') {
        res.status(400).json({ error: { code: 'invalid_json', message: 'Malformed JSON body' } });
      } else {
        console.error(`[${service}]`, err);
        res.status(500).json({ error: { code: 'internal_error', message: 'Unexpected error' } });
      }
    });
  };
  return { app, finish };
}

export function isUniqueViolation(err: unknown): boolean {
  return (err as any)?.code === '23505';
}

export function shortRef(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
}
