import { useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';

export function KioskAuthHandler() {
  const { login, token, loading } = useAuth();

  useEffect(() => {
    const isKiosk = window.localStorage.getItem('sentys:kiosk_mode') === 'true';

    if (!isKiosk || token || loading) {
      return;
    }

    const autoLogin = async () => {
      try {
        // username kiosk
        await login('kiosk', '');
      } catch (error) {
        console.error('Kiosk auto-login failed:', error);
      }
    };

    autoLogin();
  }, [token, loading, login]);

  return null;
}
