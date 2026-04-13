import { describe, it, expect } from 'vitest';
import { apiUrl, readJsonResponse } from '../../lib/api';

describe('API Utilities', () => {
  describe('apiUrl()', () => {
    it('devrait ajouter un slash au début si manquant', () => {
      const result = apiUrl('auth/login');
      expect(result.endsWith('/auth/login')).toBe(true);
    });

    it('ne devrait pas doubler le slash si déjà présent', () => {
      const result = apiUrl('/api/system');
      expect(result.includes('//api')).toBe(false);
      expect(result.endsWith('/api/system')).toBe(true);
    });
  });

  describe('readJsonResponse()', () => {
    it('devrait rejeter la promesse si le content-type n\'est pas JSON', async () => {
      // Faux objet (duck-typing) pour éviter les ReferenceError dans JSDOM
      const fakeResponse = {
        status: 502,
        headers: { get: (key: string) => key.toLowerCase() === 'content-type' ? 'text/plain' : null },
        text: () => Promise.resolve('Bad Gateway')
      } as unknown as Response;

      await expect(readJsonResponse(fakeResponse)).rejects.toThrow(/Réponse API invalide/);
    });
  });
});