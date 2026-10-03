import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs';
import os from 'os';
import path from 'path';

let tmp;

beforeEach(() => {
  vi.resetModules();
  tmp = mkdtempSync(path.join(os.tmpdir(), 'sentys-secrets-'));
  process.env.SENTYS_SECRETS_FILE = path.join(tmp, 'secrets.json');
  delete process.env.TEST_SECRET;
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  delete process.env.SENTYS_SECRETS_FILE;
});

describe('loadSecret', () => {
  it('génère puis réutilise le même secret', async () => {
    const { loadSecret } = await import('./secrets.js');
    const first = loadSecret('TEST_SECRET');
    expect(Buffer.from(first, 'base64').length).toBeGreaterThanOrEqual(32);
    expect(loadSecret('TEST_SECRET')).toBe(first);
    expect(JSON.parse(readFileSync(process.env.SENTYS_SECRETS_FILE, 'utf8')).TEST_SECRET).toBe(first);
  });

  it('privilégie la variable d\'environnement sans écrire de fichier', async () => {
    process.env.TEST_SECRET = 'x'.repeat(48);
    const { loadSecret } = await import('./secrets.js');
    expect(loadSecret('TEST_SECRET')).toBe('x'.repeat(48));
    expect(existsSync(process.env.SENTYS_SECRETS_FILE)).toBe(false);
  });

  it('refuse les valeurs publiées dans l\'ancien README', async () => {
    process.env.TEST_SECRET = 'demo_TFE';
    const { loadSecret, WeakSecretError } = await import('./secrets.js');
    expect(() => loadSecret('TEST_SECRET')).toThrow(WeakSecretError);
  });

  it('refuse un secret trop court', async () => {
    process.env.TEST_SECRET = 'abcdefgh';
    const { loadSecret } = await import('./secrets.js');
    expect(() => loadSecret('TEST_SECRET')).toThrow(/trop court/);
  });
});
