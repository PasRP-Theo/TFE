import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import CameraFeed from '../CameraFeed';

vi.mock('../../hooks/useAppConfig', () => {
  const mockConfig = {
    cameraRefreshSeconds: 10,
    showOfflineCameras: true,
    cameraCardSize: 'standard',
    defaultCameraAddMode: 'node',
    cameraDiscoveryIntervalSeconds: 10
  };
  return {
    useAppConfig: () => ({
      config: mockConfig
    })
  };
});

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 1, username: 'testadmin', role: 'admin' },
    token: 'fake-token'
  })
}));

vi.mock('../../hooks/useVirtualKeyboard', () => ({
  useVirtualKeyboard: () => ({
    showKeyboard: vi.fn(),
    hideKeyboard: vi.fn(),
    isKeyboardVisible: false,
    isKeyboardEnabled: false,
  })
}));

describe('CameraFeed Component', () => {
  beforeEach(() => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve([]) // Retourne un tableau vide de caméras
      })
    ) as unknown as typeof fetch;
  });

  it('affiche le header et l\'état vide quand il n\'y a pas de caméras', async () => {
    render(<CameraFeed />);
    await waitFor(() => {
      expect(screen.getByText(/Aucune caméra configurée/i)).toBeDefined();
    });
  });

  it('affiche les caméras récupérées par l\'API', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve([
          { id: 1, name: 'Caméra Salon', status: 'running', recording: false, rtsp_url: 'rtsp://test' }
        ])
      })
    ) as unknown as typeof fetch;

    render(<CameraFeed />);
    await waitFor(() => {
      expect(screen.getByText('Caméra Salon')).toBeDefined();
    });
  });
});