import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import LoginPage from '../LoginPage';

const mockLogin = vi.fn();

// Simulation des hooks
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({
    login: mockLogin,
    loading: false,
  })
}));

vi.mock('../../hooks/useAppConfig', () => {
  const mockConfig = {
    appName: 'SENTYS_TEST',
    appSubtitle: 'Module de test',
    loginMessage: 'Message sécurisé',
    showSystemVersion: true,
    systemVersion: 'v9.9.9',
    interfaceLanguage: 'fr-FR',
    timeFormat: '24h',
  };
  return {
    useAppConfig: () => ({
      config: mockConfig
    })
  };
});

vi.mock('../../hooks/useVirtualKeyboard', () => ({
  useVirtualKeyboard: () => ({
    showKeyboard: vi.fn(),
    isKeyboardEnabled: false,
  })
}));

describe('LoginPage Component', () => {
  it('affiche correctement le formulaire de connexion et les variables de config', () => {
    render(<LoginPage />);
    
    // Vérifie que le nom de l'app est bien affiché
    expect(screen.getByText('SENTYS_TEST')).toBeDefined();
    expect(screen.getByText('Module de test'.toUpperCase())).toBeDefined();
    
    // Vérifie que les champs sont présents
    expect(screen.getByPlaceholderText('admin')).toBeDefined();
  });

  it('soumet le formulaire avec les bons identifiants', async () => {
    render(<LoginPage />);
    
    const userAttr = screen.getByPlaceholderText('admin');
    const passAttr = screen.getByPlaceholderText('••••••••••••');
    const submitBtn = screen.getByRole('button', { name: /accéder au système/i });

    fireEvent.change(userAttr, { target: { value: 'testuser' } });
    fireEvent.change(passAttr, { target: { value: 'password123' } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('testuser', 'password123');
    });
  });
});