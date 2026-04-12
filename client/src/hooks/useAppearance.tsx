/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

export type AppearanceTheme = 'dark' | 'light';
export type AppearanceAccent = 'blue' | 'emerald' | 'amber' | 'crimson';

export interface AppearanceSettings {
  theme: AppearanceTheme;
  accent: AppearanceAccent;
  fontScale: number;
  touchTarget: number;
}

interface AppearanceContextType {
  settings: AppearanceSettings;
  updateSettings: (patch: Partial<AppearanceSettings>) => void;
  resetSettings: () => void;
  toggleTheme: () => void;
}

export const APPEARANCE_STORAGE_KEY = 'sentys:appearance';

export const APPEARANCE_DEFAULTS: AppearanceSettings = {
  theme: 'dark',
  accent: 'blue',
  fontScale: 1,
  touchTarget: 44,
};

export const APPEARANCE_ACCENTS: Array<{ id: AppearanceAccent; label: string; description: string }> = [
  { id: 'blue', label: 'Bleu', description: 'Sobre et technique' },
  { id: 'emerald', label: 'Émeraude', description: 'Plus signalétique' },
  { id: 'amber', label: 'Ambre', description: 'Plus chaud et visible' },
  { id: 'crimson', label: 'Rouge', description: 'Accent plus critique' },
];

const accentPalette: Record<AppearanceAccent, Record<string, string>> = {
  blue: {
    '--accent-blue': '#6cc7ff',
    '--accent-blue-bg': 'rgba(108, 199, 255, 0.14)',
    '--accent-blue-border': 'rgba(108, 199, 255, 0.3)',
    '--border-focus': '#60a5fa',
    '--nav-active-border': 'rgba(108, 199, 255, 0.34)',
    '--nav-active-bg': 'linear-gradient(135deg, rgba(108, 199, 255, 0.18), rgba(108, 199, 255, 0.06))',
    '--toggle-on-bg': '#0f4cc9',
    '--selection-bg': 'rgba(108, 199, 255, 0.24)',
    '--camera-corner-color': 'rgba(115, 173, 230, 0.72)',
    '--camera-offline-icon': 'rgba(115, 173, 230, 0.58)',
    '--camera-scanline': 'rgba(108, 199, 255, 0.045)',
  },
  emerald: {
    '--accent-blue': '#34d399',
    '--accent-blue-bg': 'rgba(52, 211, 153, 0.16)',
    '--accent-blue-border': 'rgba(52, 211, 153, 0.32)',
    '--border-focus': '#10b981',
    '--nav-active-border': 'rgba(52, 211, 153, 0.34)',
    '--nav-active-bg': 'linear-gradient(135deg, rgba(52, 211, 153, 0.18), rgba(52, 211, 153, 0.06))',
    '--toggle-on-bg': '#0f9f6e',
    '--selection-bg': 'rgba(52, 211, 153, 0.22)',
    '--camera-corner-color': 'rgba(74, 222, 128, 0.76)',
    '--camera-offline-icon': 'rgba(74, 222, 128, 0.56)',
    '--camera-scanline': 'rgba(52, 211, 153, 0.05)',
  },
  amber: {
    '--accent-blue': '#fbbf24',
    '--accent-blue-bg': 'rgba(251, 191, 36, 0.18)',
    '--accent-blue-border': 'rgba(251, 191, 36, 0.34)',
    '--border-focus': '#f59e0b',
    '--nav-active-border': 'rgba(251, 191, 36, 0.36)',
    '--nav-active-bg': 'linear-gradient(135deg, rgba(251, 191, 36, 0.2), rgba(251, 191, 36, 0.08))',
    '--toggle-on-bg': '#d97706',
    '--selection-bg': 'rgba(251, 191, 36, 0.22)',
    '--camera-corner-color': 'rgba(252, 211, 77, 0.78)',
    '--camera-offline-icon': 'rgba(252, 211, 77, 0.6)',
    '--camera-scanline': 'rgba(251, 191, 36, 0.055)',
  },
  crimson: {
    '--accent-blue': '#fb7185',
    '--accent-blue-bg': 'rgba(251, 113, 133, 0.17)',
    '--accent-blue-border': 'rgba(251, 113, 133, 0.32)',
    '--border-focus': '#f43f5e',
    '--nav-active-border': 'rgba(251, 113, 133, 0.34)',
    '--nav-active-bg': 'linear-gradient(135deg, rgba(251, 113, 133, 0.18), rgba(251, 113, 133, 0.06))',
    '--toggle-on-bg': '#e11d48',
    '--selection-bg': 'rgba(251, 113, 133, 0.22)',
    '--camera-corner-color': 'rgba(251, 113, 133, 0.76)',
    '--camera-offline-icon': 'rgba(251, 113, 133, 0.56)',
    '--camera-scanline': 'rgba(251, 113, 133, 0.055)',
  },
};

const AppearanceContext = createContext<AppearanceContextType | null>(null);

function sanitizeSettings(value: unknown): AppearanceSettings {
  if (!value || typeof value !== 'object') return APPEARANCE_DEFAULTS;

  const candidate = value as Partial<AppearanceSettings>;
  const theme = candidate.theme === 'light' ? 'light' : 'dark';
  const accent = APPEARANCE_ACCENTS.some(option => option.id === candidate.accent)
    ? candidate.accent as AppearanceAccent
    : APPEARANCE_DEFAULTS.accent;
  const fontScale = typeof candidate.fontScale === 'number'
    ? Math.min(1.2, Math.max(0.9, Number(candidate.fontScale.toFixed(2))))
    : APPEARANCE_DEFAULTS.fontScale;
  const touchTarget = typeof candidate.touchTarget === 'number'
    ? Math.min(64, Math.max(40, Math.round(candidate.touchTarget)))
    : APPEARANCE_DEFAULTS.touchTarget;

  return { theme, accent, fontScale, touchTarget };
}

function readStoredSettings(): AppearanceSettings {
  try {
    const raw = window.localStorage.getItem(APPEARANCE_STORAGE_KEY);
    if (!raw) return APPEARANCE_DEFAULTS;
    return sanitizeSettings(JSON.parse(raw));
  } catch {
    return APPEARANCE_DEFAULTS;
  }
}

function applySettings(settings: AppearanceSettings) {
  const root = document.documentElement;
  root.setAttribute('data-theme', settings.theme === 'light' ? 'light' : '');
  root.style.fontSize = `${16 * settings.fontScale}px`;
  root.style.setProperty('--touch-target', `${settings.touchTarget}px`);

  const palette = accentPalette[settings.accent];
  Object.entries(palette).forEach(([name, value]) => {
    root.style.setProperty(name, value);
  });
}

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppearanceSettings>(() => readStoredSettings());

  useEffect(() => {
    applySettings(settings);
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  const contextValue = useMemo<AppearanceContextType>(() => ({
    settings,
    updateSettings: (patch) => {
      setSettings(current => sanitizeSettings({ ...current, ...patch }));
    },
    resetSettings: () => setSettings(APPEARANCE_DEFAULTS),
    toggleTheme: () => {
      setSettings(current => ({
        ...current,
        theme: current.theme === 'dark' ? 'light' : 'dark',
      }));
    },
  }), [settings]);

  return (
    <AppearanceContext.Provider value={contextValue}>
      {children}
    </AppearanceContext.Provider>
  );
}

export function useAppearance() {
  const context = useContext(AppearanceContext);
  if (!context) throw new Error('useAppearance doit être utilisé dans <AppearanceProvider>');
  return context;
}