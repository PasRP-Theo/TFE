import { useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';

/**
 * This component handles automatic login for Kiosk mode.
 * It should be placed inside your main AuthProvider so it has access to the `login` function.
 */
export function KioskAuthHandler() {
  const { login, token, loading } = useAuth();

  useEffect(() => {
    const isKiosk = window.localStorage.getItem('sentys:kiosk_mode') === 'true';

    // If not in kiosk mode, or already logged in, or auth is still loading, do nothing.
    if (!isKiosk || token || loading) {
      return;
    }

    const autoLogin = async () => {
      try {
        // Use 'kiosk' as a special username. The backend will handle this case without a password.
        await login('kiosk', '');
      } catch (error) {
        console.error('Kiosk auto-login failed:', error);
      }
    };

    autoLogin();
  }, [token, loading, login]);

  return null; // This component does not render anything.
}