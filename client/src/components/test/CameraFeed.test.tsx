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

// vraies réponses HTTP : le composant lit le corps en texte (pas de rendu si rien n'a changé)
const jsonResponse = (body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } }));

describe('CameraFeed Component', () => {
  beforeEach(() => {
    global.fetch = vi.fn(() => jsonResponse([])) as unknown as typeof fetch; // aucune caméra
  });

  it('affiche le header et l\'état vide quand il n\'y a pas de caméras', async () => {
    render(<CameraFeed />);
    await waitFor(() => {
      expect(screen.getByText(/Aucune caméra configurée/i)).toBeDefined();
    });
  });

  it('affiche les caméras récupérées par l\'API', async () => {
    global.fetch = vi.fn(() => jsonResponse([
      { id: 1, name: 'Caméra Salon', status: 'running', recording: false, rtsp_url: 'rtsp://test' }
    ])) as unknown as typeof fetch;

    render(<CameraFeed />);
    await waitFor(() => {
      expect(screen.getByText('Caméra Salon')).toBeDefined();
    });
  });
});