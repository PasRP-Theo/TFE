import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { apiUrl, readJsonResponse } from '../lib/api';

export interface AppConfig {
  appName: string;
  appSubtitle: string;
  systemVersion: string;
  defaultAdminUsername: string;
  defaultAdminActive: boolean;
}

interface AppConfigContextType {
  config: AppConfig;
  loading: boolean;
  refreshConfig: () => Promise<void>;
  updateConfig: (token: string, patch: Pick<AppConfig, 'appName' | 'appSubtitle'>) => Promise<AppConfig>;
}

const DEFAULT_CONFIG: AppConfig = {
  appName: 'AUBEPINES',
  appSubtitle: 'Système de surveillance',
  systemVersion: 'v2.4.1',
  defaultAdminUsername: 'root',
  defaultAdminActive: false,
};

const AppConfigContext = createContext<AppConfigContextType | null>(null);

function sanitizeConfig(value: unknown): AppConfig {
  if (!value || typeof value !== 'object') return DEFAULT_CONFIG;
  const candidate = value as Partial<AppConfig>;

  return {
    appName: typeof candidate.appName === 'string' && candidate.appName.trim() ? candidate.appName.trim() : DEFAULT_CONFIG.appName,
    appSubtitle: typeof candidate.appSubtitle === 'string' && candidate.appSubtitle.trim() ? candidate.appSubtitle.trim() : DEFAULT_CONFIG.appSubtitle,
    systemVersion: typeof candidate.systemVersion === 'string' && candidate.systemVersion.trim() ? candidate.systemVersion.trim() : DEFAULT_CONFIG.systemVersion,
    defaultAdminUsername: typeof candidate.defaultAdminUsername === 'string' && candidate.defaultAdminUsername.trim() ? candidate.defaultAdminUsername.trim() : DEFAULT_CONFIG.defaultAdminUsername,
    defaultAdminActive: Boolean(candidate.defaultAdminActive),
  };
}

export function AppConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);

  async function refreshConfig() {
    const response = await fetch(apiUrl('/api/app-config'));
    const data = await readJsonResponse<AppConfig & { error?: string }>(response);
    if (!response.ok) throw new Error(data.error || 'Impossible de charger la configuration de l’application');
    setConfig(sanitizeConfig(data));
  }

  async function updateConfig(token: string, patch: Pick<AppConfig, 'appName' | 'appSubtitle'>) {
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
