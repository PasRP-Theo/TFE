import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import BrandLogo from './BrandLogo';

describe('BrandLogo Component', () => {
  it('affiche l\'image par défaut au rendu initial', () => {
    render(<BrandLogo wrapperClassName="wrap" imageClassName="img" fallbackClassName="fall" />);
    
    // L'image a alt="" (présentation)
    const img = screen.getByRole('presentation', { hidden: true });
    expect(img).toBeDefined();
  });

  it('bascule sur le texte de secours (fallback) en cas d\'erreur de l\'image', () => {
    render(<BrandLogo wrapperClassName="wrap" imageClassName="img" fallbackClassName="fall" fallbackText="S" />);
    
    const img = screen.getByRole('presentation', { hidden: true });
    fireEvent.error(img); // Simule le fait que l'image SVG n'ait pas pu être chargée
    
    expect(screen.getByText('S')).toBeDefined(); // On s'attend à voir la lettre "S"
  });
});