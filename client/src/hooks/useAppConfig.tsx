/* eslint-disable react-refresh/only-export-components */
/* eslint-disable react-hooks/set-state-in-effect */
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { apiUrl, readJsonResponse } from '../lib/api';

export interface AppConfig {
  appName: string;
  appSubtitle: string;
  systemVersion: string;
  loginMessage: string;
  interfaceLanguage: 'fr-FR' | 'en-GB';
  timeFormat: '24h' | '12h';
  showSystemVersion: boolean;
  uiDensity: 'compact' | 'standard' | 'touch';
  cameraCardSize: 'compact' | 'standard' | 'large';
  showStatusPanel: boolean;
  cameraAutostartEnabled: boolean;
  cameraRefreshSeconds: number;
  showOfflineCameras: boolean;
  defaultCameraAddMode: 'node' | 'discover' | 'manual';
  cameraDiscoveryIntervalSeconds: number;
  alertsRealtimeEnabled: boolean;
  alertsDailySummaryEnabled: boolean;
  alertsSoundEnabled: boolean;
  alertsDisconnectEnabled: boolean;
  defaultAdminUsername: string;
  defaultAdminActive: boolean;
  kioskPin: string;
  surveillanceMode: boolean;
}

interface AppConfigContextType {
  config: AppConfig;
  loading: boolean;
  refreshConfig: () => Promise<void>;
  updateConfig: (token: string, patch: Partial<AppConfig>) => Promise<AppConfig>;
}

const DEFAULT_CONFIG: AppConfig = {
  appName: 'SENTYS',
  appSubtitle: 'Système de surveillance',
  systemVersion: 'v0.0.1',
  loginMessage: 'Connexion sécurisée au système',
  interfaceLanguage: 'fr-FR',
  timeFormat: '24h',
  showSystemVersion: true,
  uiDensity: 'standard',
  cameraCardSize: 'standard',
  showStatusPanel: true,
  cameraAutostartEnabled: true,
  cameraRefreshSeconds: 3,
  showOfflineCameras: true,
  defaultCameraAddMode: 'node',
  cameraDiscoveryIntervalSeconds: 5,
  alertsRealtimeEnabled: true,
  alertsDailySummaryEnabled: false,
  alertsSoundEnabled: true,
  alertsDisconnectEnabled: true,
  defaultAdminUsername: 'root',
  defaultAdminActive: false,
  kioskPin: '1234',
  surveillanceMode: true,
};

const AppConfigContext = createContext<AppConfigContextType | null>(null);

function sanitizeConfig(value: unknown): AppConfig {
  if (!value || typeof value !== 'object') return DEFAULT_CONFIG;
  const candidate = value as Partial<AppConfig>;

  return {
    appName: typeof candidate.appName === 'string' && candidate.appName.trim() ? candidate.appName.trim() : DEFAULT_CONFIG.appName,
    appSubtitle: typeof candidate.appSubtitle === 'string' && candidate.appSubtitle.trim() ? candidate.appSubtitle.trim() : DEFAULT_CONFIG.appSubtitle,
    systemVersion: typeof candidate.systemVersion === 'string' && candidate.systemVersion.trim() ? candidate.systemVersion.trim() : DEFAULT_CONFIG.systemVersion,
    loginMessage: typeof candidate.loginMessage === 'string' && candidate.loginMessage.trim() ? candidate.loginMessage.trim() : DEFAULT_CONFIG.loginMessage,
    interfaceLanguage: candidate.interfaceLanguage === 'en-GB' ? 'en-GB' : DEFAULT_CONFIG.interfaceLanguage,
    timeFormat: candidate.timeFormat === '12h' ? '12h' : DEFAULT_CONFIG.timeFormat,
    showSystemVersion: typeof candidate.showSystemVersion === 'boolean' ? candidate.showSystemVersion : DEFAULT_CONFIG.showSystemVersion,
    uiDensity: candidate.uiDensity === 'compact' || candidate.uiDensity === 'touch' ? candidate.uiDensity : DEFAULT_CONFIG.uiDensity,
    cameraCardSize: candidate.cameraCardSize === 'compact' || candidate.cameraCardSize === 'large' ? candidate.cameraCardSize : DEFAULT_CONFIG.cameraCardSize,
    showStatusPanel: typeof candidate.showStatusPanel === 'boolean' ? candidate.showStatusPanel : DEFAULT_CONFIG.showStatusPanel,
    cameraAutostartEnabled: typeof candidate.cameraAutostartEnabled === 'boolean' ? candidate.cameraAutostartEnabled : DEFAULT_CONFIG.cameraAutostartEnabled,
    cameraRefreshSeconds: Number.isInteger(candidate.cameraRefreshSeconds) ? Math.min(Math.max(candidate.cameraRefreshSeconds as number, 2), 15) : DEFAULT_CONFIG.cameraRefreshSeconds,
    showOfflineCameras: typeof candidate.showOfflineCameras === 'boolean' ? candidate.showOfflineCameras : DEFAULT_CONFIG.showOfflineCameras,
    defaultCameraAddMode: candidate.defaultCameraAddMode === 'discover' || candidate.defaultCameraAddMode === 'manual' ? candidate.defaultCameraAddMode : DEFAULT_CONFIG.defaultCameraAddMode,
    cameraDiscoveryIntervalSeconds: Number.isInteger(candidate.cameraDiscoveryIntervalSeconds) ? Math.min(Math.max(candidate.cameraDiscoveryIntervalSeconds as number, 3), 30) : DEFAULT_CONFIG.cameraDiscoveryIntervalSeconds,
    alertsRealtimeEnabled: typeof candidate.alertsRealtimeEnabled === 'boolean' ? candidate.alertsRealtimeEnabled : DEFAULT_CONFIG.alertsRealtimeEnabled,
    alertsDailySummaryEnabled: typeof candidate.alertsDailySummaryEnabled === 'boolean' ? candidate.alertsDailySummaryEnabled : DEFAULT_CONFIG.alertsDailySummaryEnabled,
    alertsSoundEnabled: typeof candidate.alertsSoundEnabled === 'boolean' ? candidate.alertsSoundEnabled : DEFAULT_CONFIG.alertsSoundEnabled,
    alertsDisconnectEnabled: typeof candidate.alertsDisconnectEnabled === 'boolean' ? candidate.alertsDisconnectEnabled : DEFAULT_CONFIG.alertsDisconnectEnabled,
    defaultAdminUsername: typeof candidate.defaultAdminUsername === 'string' && candidate.defaultAdminUsername.trim() ? candidate.defaultAdminUsername.trim() : DEFAULT_CONFIG.defaultAdminUsername,
    defaultAdminActive: Boolean(candidate.defaultAdminActive),
    kioskPin: typeof candidate.kioskPin === 'string' && candidate.kioskPin.trim().length === 4 ? candidate.kioskPin.trim() : DEFAULT_CONFIG.kioskPin,
    surveillanceMode: typeof candidate.surveillanceMode === 'boolean' ? candidate.surveillanceMode : DEFAULT_CONFIG.surveillanceMode,
  };
}

export function AppConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);

  async function refreshConfig() {
    const token = localStorage.getItem(‘token’);
    const response = await fetch(apiUrl(‘/api/app-config’), {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const data = await readJsonResponse<AppConfig & { error?: string }>(response);
    if (!response.ok) throw new Error(data.error || ‘Impossible de charger la configuration de l\’application’);
    setConfig(sanitizeConfig(data));
  }

  async function updateConfig(token: string, patch: Partial<AppConfig>) {
    const response = await fetch(apiUrl('/api/app-config'), {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(patch),
    });
    const data = await readJsonResponse<AppConfig & { error?: string }>(response);
    if (!response.ok) throw new Error(data.error || 'Impossible de mettre à jour la configuration');
    const nextConfig = sanitizeConfig(data);
    setConfig(nextConfig);
    return nextConfig;
  }

  useEffect(() => {
    refreshConfig()
      .catch(() => setConfig(DEFAULT_CONFIG))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    document.title = `${config.appName} · ${config.appSubtitle}`;
  }, [config.appName, config.appSubtitle]);

  useEffect(() => {
    document.documentElement.lang = config.interfaceLanguage;
  }, [config.interfaceLanguage]);

  const contextValue = useMemo<AppConfigContextType>(() => ({
    config,
    loading,
    refreshConfig,
    updateConfig,
  }), [config, loading]);

  return (
    <AppConfigContext.Provider value={contextValue}>
      {children}
    </AppConfigContext.Provider>
  );
}

export function useAppConfig() {
  const context = useContext(AppConfigContext);
  if (!context) throw new Error('useAppConfig doit être utilisé dans <AppConfigProvider>');
  return context;
}
