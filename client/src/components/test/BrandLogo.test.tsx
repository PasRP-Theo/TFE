import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import BrandLogo from '../BrandLogo';

describe('BrandLogo Component', () => {
  it('affiche l\'image par défaut au rendu initial', () => {
    const { container } = render(<BrandLogo wrapperClassName="wrap" imageClassName="img" fallbackClassName="fall" />);
    
    // Utilisation de querySelector (getByRole 'presentation' est instable avec alt="")
    const img = container.querySelector('img');
    expect(img).toBeDefined();
    expect(img).not.toBeNull();
  });

  it('bascule sur le texte de secours (fallback) en cas d\'erreur de l\'image', () => {
    const { container } = render(<BrandLogo wrapperClassName="wrap" imageClassName="img" fallbackClassName="fall" fallbackText="S" />);
    
    const img = container.querySelector('img');
    fireEvent.error(img!); // Simule le fait que l'image SVG n'ait pas pu être chargée
    expect(screen.getByText('S')).toBeDefined(); // On s'attend à voir la lettre "S"
  });
});