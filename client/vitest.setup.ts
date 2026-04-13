import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Nettoie (démonte) les composants React du DOM virtuel après chaque test.
// Cela permet de déclencher les "return () => clearInterval()" des useEffects
// et empêche les fuites de mémoire fatales (OOM).
afterEach(() => {
  cleanup();
});