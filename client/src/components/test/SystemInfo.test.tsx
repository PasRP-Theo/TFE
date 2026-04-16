import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import SystemInfo from '../SystemInfo';

// On simule (mock) le hook useAppConfig car le composant en dépend
vi.mock('../../hooks/useAppConfig', () => {
  const mockConfig = {
    appName: 'SENTYS',
    showSystemVersion: true,
    systemVersion: 'v2.4.1'
  };
  return {
    useAppConfig: () => ({
      config: mockConfig
    })
  };
});

// On simule le hook useAuth car SystemInfo vérifie le rôle admin
vi.mock('../../hooks/useAuth', () => {
  return {
    useAuth: () => ({
      user: { id: 1, username: 'admin', role: 'admin' },
      token: 'fake-token'
    })
  };
});

describe('SystemInfo Component', () => {
  beforeEach(() => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          cpu: { manufacturer: 'Intel', model: 'Core i7', physicalCores: 4, cores: 8, speedGHz: 2.8, usagePercent: 15, temperature: 45 },
          ram: { totalGB: 16, usedGB: 8, freeGB: 8, usagePercent: 50 },
          disks: [],
          network: [],
          os: { distro: 'Ubuntu', release: '22.04', arch: 'x64', hostname: 'sentys-node', platform: 'linux', uptime: 3600 },
          battery: { hasBattery: false }
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

    // Vérifier que les données mockées sont bien affichées
    expect(screen.getByText(/Intel Core i7/i)).toBeDefined();
    expect(screen.getAllByText(/16.0 Go/i).length).toBeGreaterThan(0);
  });
});