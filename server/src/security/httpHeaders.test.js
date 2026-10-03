import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import cors from 'cors';
import { securityHeaders, spaCsp, buildCorsOptions } from './httpHeaders.js';

let server;
let base;

beforeAll(async () => {
  const app = express();
  const corsOptions = buildCorsOptions(['https://sentys.vercel.app']);
  app.use(securityHeaders);
  app.use(cors(corsOptions));
  app.get('/api/data', (_req, res) => res.json({ ok: true }));
  app.get('/', spaCsp, (_req, res) => res.send('<html></html>'));
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => server?.close());

describe('en-têtes de sécurité', () => {
  it('pose les en-têtes de base et no-store sur l\'API', async () => {
    const res = await fetch(`${base}/api/data`);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(res.headers.get('x-powered-by')).toBeNull();
  });

  it('pose HSTS uniquement derrière HTTPS', async () => {
    expect((await fetch(`${base}/api/data`)).headers.get('strict-transport-security')).toBeNull();
    const https = await fetch(`${base}/api/data`, { headers: { 'x-forwarded-proto': 'https' } });
    expect(https.headers.get('strict-transport-security')).toContain('max-age=63072000');
  });

  it('utilise une CSP stricte pour l\'interface', async () => {
    const csp = (await fetch(`${base}/`)).headers.get('content-security-policy');
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain('unsafe-inline');
  });
});

describe('CORS', () => {
  it('autorise l\'origine Vercel', async () => {
    const res = await fetch(`${base}/api/data`, { headers: { origin: 'https://sentys.vercel.app' } });
    expect(res.headers.get('access-control-allow-origin')).toBe('https://sentys.vercel.app');
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
  });

  it('n\'autorise pas une autre origine, y compris en préflight', async () => {
    const res = await fetch(`${base}/api/data`, { headers: { origin: 'https://evil.example' } });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    const preflight = await fetch(`${base}/api/data`, {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'DELETE' },
    });
    expect(preflight.headers.get('access-control-allow-origin')).toBeNull();
  });
});
