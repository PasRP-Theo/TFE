import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ControlPanel from './ControlPanel';

describe('ControlPanel Component', () => {
  it('affiche correctement le tableau de bord avec le statut par défaut', () => {
    render(
      <MemoryRouter>
        <ControlPanel />
      </MemoryRouter>
    );
    expect(screen.getByText('TABLEAU DE BORD')).toBeDefined();
    expect(screen.getByText('ARMÉ (ACTIF)')).toBeDefined();
  });

  it('change le statut de l\'alarme lorsqu\'on clique sur le bouton', () => {
    render(
      <MemoryRouter>
        <ControlPanel />
      </MemoryRouter>
    );
    const toggleButton = screen.getByText('DÉSACTIVER LES ALARMES');
    fireEvent.click(toggleButton);
    expect(screen.getByText('DÉSARMÉ (INACTIF)')).toBeDefined();
    expect(screen.getByText('ARMER LE SYSTÈME')).toBeDefined();
  });
});