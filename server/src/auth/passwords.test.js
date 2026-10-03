import { describe, it, expect } from 'vitest';
import bcrypt from 'bcryptjs';
import { hashPassword, verifyPassword, burnPasswordCheck } from './passwords.js';

describe('hachage des mots de passe', () => {
  it('produit un hachage poivré vérifiable', async () => {
    const hash = await hashPassword('une phrase de passe longue');
    expect(hash.startsWith('pep1:$2')).toBe(true);
    expect(await verifyPassword('une phrase de passe longue', hash)).toEqual({ valid: true, needsRehash: false });
    expect((await verifyPassword('autre chose', hash)).valid).toBe(false);
  });

  it('ne tronque pas au-delà de 72 octets', async () => {
    const base = 'x'.repeat(80);
    const hash = await hashPassword(`${base}A`);
    expect((await verifyPassword(`${base}B`, hash)).valid).toBe(false);
  });

  it('accepte l\'ancien format bcrypt et demande une migration', async () => {
    const legacy = await bcrypt.hash('ancien mot de passe', 4);
    expect(await verifyPassword('ancien mot de passe', legacy)).toEqual({ valid: true, needsRehash: true });
    expect(await verifyPassword('mauvais', legacy)).toEqual({ valid: false, needsRehash: false });
  });

  it('normalise l\'Unicode (NFKC)', async () => {
    const hash = await hashPassword('ﬁchier sécurisé longue');
    expect((await verifyPassword('fichier sécurisé longue', hash)).valid).toBe(true);
  });

  it('effectue une comparaison factice sans erreur', async () => {
    await expect(burnPasswordCheck('peu importe')).resolves.toBeUndefined();
  });
});
