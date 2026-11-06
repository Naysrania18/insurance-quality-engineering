import { fileURLToPath } from 'node:url';
import express, { type Express } from 'express';

export interface Upstreams {
  quoteUrl: string;
  policyUrl: string;
  claimsUrl: string;
}

/** Static UI + thin same-origin proxy to the three APIs (/api/quote, /api/policy, /api/claims). */
export function createWebApp(up: Upstreams): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.text({ type: '*/*', limit: '100kb' }));

  const proxy = (prefix: string, target: string) => {
    app.use(prefix, async (req, res) => {
      try {
        const hasBody = !['GET', 'HEAD'].includes(req.method) && typeof req.body === 'string';
        const upstream = await fetch(`${target}${req.url}`, {
          method: req.method,
          headers: hasBody ? { 'Content-Type': 'application/json' } : {},
          body: hasBody ? (req.body as string) : undefined,
          signal: AbortSignal.timeout(10_000),
        });
        res.status(upstream.status).type('application/json').send(await upstream.text());
      } catch {
        res.status(502).json({ error: { code: 'bad_gateway', message: 'Upstream unavailable' } });
      }
    });
  };
  proxy('/api/quote', up.quoteUrl);
  proxy('/api/policy', up.policyUrl);
  proxy('/api/claims', up.claimsUrl);

  app.use(express.static(fileURLToPath(new URL('./public', import.meta.url))));
  app.get('/health', (_req, res) => {
    res.json({ service: 'web', status: 'ok' });
  });
  return app;
}
