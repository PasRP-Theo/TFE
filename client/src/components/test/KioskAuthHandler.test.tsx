import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { KioskAuthHandler } from '../KioskAuthHandler';

const mockLogin = vi.fn();

vi.mock('../../hooks/useAuth', () => ({
  useAuth: vi.fn(),
}));

import { useAuth } from '../../hooks/useAuth';

describe('KioskAuthHandler Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('ne rend rien (retourne null)', () => {
    vi.mocked(useAuth).mockReturnValue({ login: mockLogin, token: null, loading: false } as ReturnType<typeof useAuth>);
    const { container } = render(<KioskAuthHandler />);
    expect(container.firstChild).toBeNull();
  });

  it('appelle login("kiosk", "") en mode kiosk sans session active', async () => {
    localStorage.setItem('sentys:kiosk_mode', 'true');
    vi.mocked(useAuth).mockReturnValue({ login: mockLogin, token: null, loading: false } as ReturnType<typeof useAuth>);

    render(<KioskAuthHandler />);
    await vi.waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('kiosk', '');
    });
  });

  it('ne fait rien si kiosk_mode est absent du localStorage', () => {
    vi.mocked(useAuth).mockReturnValue({ login: mockLogin, token: null, loading: false } as ReturnType<typeof useAuth>);
    render(<KioskAuthHandler />);
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('ne fait rien si une session est déjà active (token présent)', () => {
    localStorage.setItem('sentys:kiosk_mode', 'true');
    vi.mocked(useAuth).mockReturnValue({ login: mockLogin, token: 'existing-token', loading: false } as ReturnType<typeof useAuth>);
    render(<KioskAuthHandler />);
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('ne fait rien si l\'auth est encore en cours de chargement', () => {
    localStorage.setItem('sentys:kiosk_mode', 'true');
    vi.mocked(useAuth).mockReturnValue({ login: mockLogin, token: null, loading: true } as ReturnType<typeof useAuth>);
    render(<KioskAuthHandler />);
    expect(mockLogin).not.toHaveBeenCalled();
  });
});
