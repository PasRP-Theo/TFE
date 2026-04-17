import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Settings from '../Settings';

const mockConfig = {
  appName: 'SENTYS',
  appSubtitle: 'Dashboard',
  loginMessage: 'Welcome',
  systemVersion: 'v1.0',
};
const mockUpdateConfig = vi.fn().mockResolvedValue(mockConfig);

// Simulation des dépendances complexes
vi.mock('../../hooks/useAppConfig', () => {
  return {
    useAppConfig: () => ({
      config: mockConfig,
      updateConfig: mockUpdateConfig,
    })
  };
});

vi.mock('../../hooks/useAuth', () => {
  const mockUser = { id: 1, email: 'admin@test.com', role: 'admin' };
  return {
    useAuth: () => ({
      token: 'fake-token',
      user: mockUser,
      logout: vi.fn(),
    })
  };
});

vi.mock('../../hooks/useAppearance', () => {
  const mockSettings = { theme: 'dark', accent: 'blue', fontScale: 1, touchTarget: 44 };
  return {
    useAppearance: () => ({
      settings: mockSettings,
      updateSettings: vi.fn(),
      resetSettings: vi.fn(),
    }),
    APPEARANCE_ACCENTS: [
      { id: 'blue', label: 'Bleu', description: 'Défaut' }
    ],
    APPEARANCE_DEFAULTS: { theme: 'dark', fontScale: 1, touchTarget: 44 }
  };
});

vi.mock('../../hooks/useVirtualKeyboard', () => {
  return {
    useVirtualKeyboard: () => ({
      showKeyboard: vi.fn(),
      hideKeyboard: vi.fn(),
      isKeyboardVisible: false,
      isKeyboardEnabled: false,
    })
  };
});

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // obsolète mais parfois appelé
    removeListener: vi.fn(), // obsolète mais parfois appelé
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

describe('Settings Component', () => {
  it('affiche l\'onglet Général par défaut au montage', () => {
    render(<Settings />);
    expect(screen.getByText('PARAMÈTRES')).toBeDefined();
    expect(screen.getByText('APPLICATION')).toBeDefined(); // Section de TabSettings
  });

  it('bascule correctement sur l\'onglet utilisateurs', () => {
    render(<Settings />);
    const usersTab = screen.getByText('UTILISATEURS');
    fireEvent.click(usersTab);
    
    expect(screen.getByText('Ajouter un utilisateur')).toBeDefined();
  });

  it('appelle updateConfig lors de l\'enregistrement des paramètres d\'application', async () => {
    render(<Settings />);
    const saveBtns = screen.getAllByText('Enregistrer');
    fireEvent.click(saveBtns[0]); // Premier bouton "Enregistrer" (Section Application)
    
    await waitFor(() => {
      expect(mockUpdateConfig).toHaveBeenCalled();
    });
  });
});