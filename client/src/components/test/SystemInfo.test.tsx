import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import SystemInfo from '../SystemInfo';

// On simule (mock) le hook useAppConfig car le composant en dépend
vi.mock('../../hooks/useAppConfig', () => ({
  useAppConfig: () => ({
    config: {
      appName: 'SENTYS',
      showSystemVersion: true,
      systemVersion: 'v2.4.1'
    }
  })
}));

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

  it('affiche l\'état de chargement au montage initial', async () => {
    render(<SystemInfo />);
    expect(screen.getByText(/Récupération des infos système/i)).toBeDefined();

    // Attendre que la requête API se termine pour éviter l'avertissement "act(...)"
    await waitFor(() => {
      expect(screen.queryByText(/Récupération des infos système/i)).toBeNull();
    });
  });
});