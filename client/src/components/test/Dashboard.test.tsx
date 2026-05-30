import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Dashboard from '../Dashboard';

describe('Dashboard Component', () => {
  beforeEach(() => {
    localStorage.clear();
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
    ) as unknown as typeof fetch;
  });

  it('affiche le titre et le bouton de scan', () => {
    render(<Dashboard />);
    expect(screen.getByText(/Recherche de caméras Pi Zero 2W/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /Scanner le réseau/i })).toBeDefined();
  });

  it('affiche "Scan en cours..." immédiatement après le clic', () => {
    render(<Dashboard />);
    fireEvent.click(screen.getByRole('button', { name: /Scanner le réseau/i }));
    expect(screen.getByText(/Scan en cours/i)).toBeDefined();
  });

  it('désactive le bouton pendant le scan', () => {
    render(<Dashboard />);
    const btn = screen.getByRole('button', { name: /Scanner le réseau/i });
    fireEvent.click(btn);
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it('affiche les caméras découvertes après un scan réussi', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve([
          { ip: '192.168.1.10', name: 'Cam Entrée', hlsUrl: 'http://cam/hls', rtspUrl: 'rtsp://cam/stream' }
        ])
      })
    ) as unknown as typeof fetch;

    render(<Dashboard />);
    fireEvent.click(screen.getByRole('button', { name: /Scanner le réseau/i }));

    await waitFor(() => {
      expect(screen.getByText('Cam Entrée')).toBeDefined();
    });
    expect(document.body.innerHTML).toContain('192.168.1.10');
  });

  it('n\'affiche pas de liste si le scan ne trouve rien', async () => {
    render(<Dashboard />);
    fireEvent.click(screen.getByRole('button', { name: /Scanner le réseau/i }));

    await waitFor(() => {
      expect(screen.queryByRole('list')).toBeNull();
    });
  });
});
