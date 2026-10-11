import { useEffect, useRef } from 'react';

/**
 * Rafraîchissement périodique qui s'arrête quand l'onglet est caché (aucune requête en
 * arrière-plan) et reprend immédiatement au retour sur l'onglet.
 * Le callback le plus récent est toujours utilisé : pas besoin de le mémoriser.
 */
export function usePolling(
  callback: () => unknown,
  intervalMs: number,
  { enabled = true, immediate = true }: { enabled?: boolean; immediate?: boolean } = {},
) {
  const callbackRef = useRef(callback);
  useEffect(() => { callbackRef.current = callback; });

  useEffect(() => {
    if (!enabled || !(intervalMs > 0)) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const run = () => { void callbackRef.current(); };
    const start = () => {
      if (timer === null) timer = setInterval(run, intervalMs);
    };
    const stop = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        run();
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === 'visible') {
      if (immediate) run();
      start();
    }
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [intervalMs, enabled, immediate]);
}
