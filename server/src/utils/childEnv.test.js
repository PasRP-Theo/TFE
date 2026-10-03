import { describe, it, expect } from 'vitest';
import { buildChildEnv } from './childEnv.js';

describe('buildChildEnv', () => {
  it('ne transmet pas les secrets du serveur', () => {
    process.env.JWT_SECRET = 'x'.repeat(40);
    process.env.DB_PASSWORD = 'secret';
    process.env.VAPID_PRIVATE_KEY = 'secret';
    const env = buildChildEnv({ CAMERA_ID: '1' });
    expect(env.JWT_SECRET).toBeUndefined();
    expect(env.DB_PASSWORD).toBeUndefined();
    expect(env.VAPID_PRIVATE_KEY).toBeUndefined();
    expect(env.CAMERA_ID).toBe('1');
  });

  it('conserve PATH pour trouver python', () => {
    expect(buildChildEnv().PATH ?? buildChildEnv().Path).toBeDefined();
  });
});
