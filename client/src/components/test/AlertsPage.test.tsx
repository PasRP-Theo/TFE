import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import AlertsPage from '../AlertsPage';

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ token: 'fake-token' })
}));

describe('AlertsPage Component', () => {
  beforeEach(() => {
    global.fetch = vi.fn((url: string) => {
      const defaultHeaders = { get: (key: string) => key.toLowerCase() === 'content-type' ? 'application/json' : null };
      if (url.includes('/summary')) {
        return Promise.resolve({
          ok: true,
          headers: defaultHeaders,
          json: () => Promise.resolve({ pending_count: 2, critical_pending_count: 1, last_24h_count: 5 })
        });
      }
      if (url.includes('/analytics')) {
        return Promise.resolve({
          ok: true,
          headers: defaultHeaders,
          json: () => Promise.resolve({ overview: { totalAlerts24h: 5 }, topActiveCameras: [], hourlyActivity: [] })
        });
      }
      return Promise.resolve({
        ok: true,
        headers: defaultHeaders,
        json: () => Promise.resolve({ 
          alerts: [{ id: 99, title: 'Détection Intrusion', message: 'Mouvement détecté', level: 'critical', status: 'new', created_at: new Date().toISOString() }], 
          total: 1 
        })
      });
    }) as unknown as typeof fetch;
  });

  it('monte le composant et affiche les données du résumé (summary)', async () => {
    render(<AlertsPage />);
    expect(screen.getByText("CENTRE D'ALERTES")).toBeDefined();
    
    // On attend que les useEffects terminent leurs requêtes fetch mockées
    await waitFor(() => {
      expect(screen.getByText('Critiques')).toBeDefined();
    });

    // Vérifier que l'alerte mockée est rendue dans la liste
    expect(screen.getByText('Détection Intrusion')).toBeDefined();
  });
});