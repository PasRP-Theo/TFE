import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { WebRTCPlayer } from '../WebRTCPlayer';

vi.mock('../../lib/api', () => ({
  apiUrl: (path: string) => path,
  apiFetch: vi.fn(),
}));

import { apiFetch } from '../../lib/api';

// Stub RTCPeerConnection (absent de jsdom)
vi.stubGlobal('RTCPeerConnection', vi.fn().mockImplementation(() => ({
  addTransceiver: vi.fn(),
  createOffer: vi.fn().mockResolvedValue({ sdp: 'mock-offer', type: 'offer' }),
  setLocalDescription: vi.fn().mockResolvedValue(undefined),
  setRemoteDescription: vi.fn().mockResolvedValue(undefined),
  close: vi.fn(),
  ontrack: null,
  onconnectionstatechange: null,
  iceGatheringState: 'complete',
  localDescription: { sdp: 'mock-offer', type: 'offer' },
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
})));

describe('WebRTCPlayer Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rend un élément <video>', () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ available: true }),
      text: () => Promise.resolve('v=0\r\n'),
    } as unknown as Response);

    const { container } = render(<WebRTCPlayer cameraId={1} onError={vi.fn()} />);
    expect(container.querySelector('video')).not.toBeNull();
  });

  it('affiche l\'indicateur "WebRTC..." pendant la connexion', () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ available: true }),
      text: () => Promise.resolve('v=0\r\n'),
    } as unknown as Response);

    render(<WebRTCPlayer cameraId={1} onError={vi.fn()} />);
    expect(screen.getByText('WebRTC...')).toBeDefined();
  });

  it('appelle onError si go2rtc retourne available: false', async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ available: false }),
    } as unknown as Response);

    const onError = vi.fn();
    render(<WebRTCPlayer cameraId={1} onError={onError} />);
    await waitFor(() => expect(onError).toHaveBeenCalled());
  });

  it('appelle onError si l\'échange SDP échoue', async () => {
    vi.mocked(apiFetch)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ available: true }),
      } as unknown as Response)
      .mockRejectedValueOnce(new Error('SDP exchange failed'));

    const onError = vi.fn();
    render(<WebRTCPlayer cameraId={1} onError={onError} />);
    await waitFor(() => expect(onError).toHaveBeenCalled());
  });
});
