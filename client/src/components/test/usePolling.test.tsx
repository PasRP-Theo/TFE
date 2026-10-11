import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { usePolling } from '../../hooks/usePolling';

let visibility: DocumentVisibilityState = 'visible';

function setVisibility(state: DocumentVisibilityState) {
  visibility = state;
  document.dispatchEvent(new Event('visibilitychange'));
}

function Poller({ callback, enabled = true }: { callback: () => void; enabled?: boolean }) {
  usePolling(callback, 1000, { enabled });
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('usePolling', () => {
  it('appelle immédiatement puis à intervalle régulier', () => {
    const callback = vi.fn();
    render(<Poller callback={callback} />);
    expect(callback).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(3000);
    expect(callback).toHaveBeenCalledTimes(4);
  });

  it('aucune requête quand l\'onglet est caché, reprise immédiate au retour', () => {
    const callback = vi.fn();
    render(<Poller callback={callback} />);
    setVisibility('hidden');
    callback.mockClear();
    vi.advanceTimersByTime(10_000);
    expect(callback).not.toHaveBeenCalled();
    setVisibility('visible');
    expect(callback).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it('désactivé : rien', () => {
    const callback = vi.fn();
    render(<Poller callback={callback} enabled={false} />);
    vi.advanceTimersByTime(5000);
    expect(callback).not.toHaveBeenCalled();
  });

  it('s\'arrête au démontage du composant', () => {
    const callback = vi.fn();
    const { unmount } = render(<Poller callback={callback} />);
    unmount();
    callback.mockClear();
    vi.advanceTimersByTime(5000);
    expect(callback).not.toHaveBeenCalled();
  });
});
