import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Imports des composants et utilitaires
import { apiUrl, readJsonResponse } from './lib/api';
import SystemInfo from './components/SystemInfo';
import BrandLogo from './components/BrandLogo';

// On simule (mock) le hook useAppConfig car les composants en dépendent
vi.mock('./hooks/useAppConfig', () => ({
  useAppConfig: () => ({
    config: {
      appName: 'SENTYS',
      showSystemVersion: true,
      systemVersion: 'v2.4.1'
    }
  })
}));

describe('Tous les tests de l\'application', () => {
  
  describe('API Utilities (api.ts)', () => {
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
        const fakeResponse = {
          status: 502,
          headers: { get: (key: string) => key.toLowerCase() === 'content-type' ? 'text/plain' : null },
          text: () => Promise.resolve('Bad Gateway')
        } as unknown as Response;

        await expect(readJsonResponse(fakeResponse)).rejects.toThrow(/Réponse API invalide/);
      });
    });
  });

  describe('BrandLogo Component', () => {
    it('affiche l\'image par défaut au rendu initial', () => {
      const { container } = render(<BrandLogo wrapperClassName="wrap" imageClassName="img" fallbackClassName="fall" />);
      const img = container.querySelector('img');
      expect(img).toBeDefined();
      expect(img).not.toBeNull();
    });

    it('bascule sur le texte de secours (fallback) en cas d\'erreur de l\'image', () => {
      const { container } = render(<BrandLogo wrapperClassName="wrap" imageClassName="img" fallbackClassName="fall" fallbackText="S" />);
      const img = container.querySelector('img');
      fireEvent.error(img!);
      expect(screen.getByText('S')).toBeDefined();
    });
  });

  describe('SystemInfo Component', () => {
    beforeEach(() => {
      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            cpu: {}, ram: {}, disks: [], network: [], os: {}, battery: {}
          })
        })
      ) as unknown as typeof fetch;
    });

    it('affiche l\'état de chargement au montage initial', () => {
      render(<SystemInfo />);
      expect(screen.getByText(/Récupération des infos système/i)).toBeDefined();
    });
  });
});