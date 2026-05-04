import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { APPEARANCE_ACCENTS, APPEARANCE_DEFAULTS, useAppearance } from "../hooks/useAppearance";
import { useAppConfig } from "../hooks/useAppConfig";
import { useAuth } from "../hooks/useAuth";
import { apiUrl, readJsonResponse } from '../lib/api';
import { useVirtualKeyboard } from "../hooks/useVirtualKeyboard";
import { subscribeUserToPush, unsubscribeUserFromPush, isPushSubscribed } from "./push";


function SettingsDropdown({
  value,
  options,
  onChange,
  ariaLabel
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (nextValue: string) => void;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  const selectedOption = options.find((option) => option.value === value) || options[0];

  return (
    <div className={`alerts-dropdown ${open ? 'alerts-dropdown--open' : ''}`} ref={rootRef} style={{ width: '100%' }}>
      <button
        type="button"
        className="alerts-select alerts-dropdown-trigger"
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        onClick={() => setOpen((current) => !current)}
        style={{ width: '100%' }}
      >
        <span>{selectedOption?.label || ariaLabel}</span>
        <span className="alerts-dropdown-chevron" aria-hidden="true" />
      </button>

      {open && (
        <div className="alerts-dropdown-menu" role="listbox" aria-label={ariaLabel}>
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              className={`alerts-dropdown-option ${option.value === value ? 'alerts-dropdown-option--active' : ''}`}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SettingToggle({ label, description, defaultChecked = false, disabled = false, ...props }: {
  label: string; description?: string; defaultChecked?: boolean; checked?: boolean; onChange?: (checked: boolean) => void; disabled?: boolean;
}) {
  const [internalChecked, setInternalChecked] = useState(defaultChecked);
  const checked = typeof props.checked === 'boolean' ? props.checked : internalChecked;

  function handleToggle() {
    if (disabled) return;
    const nextValue = !checked;
    if (typeof props.checked !== 'boolean') {
      setInternalChecked(nextValue);
    }
    props.onChange?.(nextValue);
  }

  return (
    <button type="button" className={`settings-row ${checked ? 'settings-row--active' : ''}`} onClick={handleToggle} disabled={disabled}>
      <div className="settings-row-text">
        <span className="settings-row-label">{label}</span>
        {description && <span className="settings-row-desc">{description}</span>}
      </div>
      <div className={`settings-toggle ${checked ? "settings-toggle--on" : "settings-toggle--off"}`}>
        <div className="settings-toggle-knob" />
      </div>
    </button>
  );
}

function TabSettings() {
  const { showKeyboard, isKeyboardEnabled } = useVirtualKeyboard();
  const { settings, updateSettings, resetSettings } = useAppearance();
  const { token, logout } = useAuth();
  const { config, updateConfig } = useAppConfig();
  const [draftConfig, setDraftConfig] = useState(config);
  const [applicationError, setApplicationError] = useState('');
  const [applicationSuccess, setApplicationSuccess] = useState('');
  const [applicationSaving, setApplicationSaving] = useState(false);
  const [displayError, setDisplayError] = useState('');
  const [displaySuccess, setDisplaySuccess] = useState('');
  const [displaySaving, setDisplaySaving] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [cameraSuccess, setCameraSuccess] = useState('');
  const [cameraSaving, setCameraSaving] = useState(false);
  const [alertsError, setAlertsError] = useState('');
  const [alertsSuccess, setAlertsSuccess] = useState('');
  const [alertsSaving, setAlertsSaving] = useState(false);
  const [resetError, setResetError] = useState('');
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [pushSubscribed, setPushSubscribed] = useState(false);
  const [pushSupport, setPushSupport] = useState(true);
  const [isPwa, setIsPwa] = useState(true);
  const [pushLoading, setPushLoading] = useState(true);
  const [pushError, setPushError] = useState('');
  const [securityError, setSecurityError] = useState('');
  const [securitySuccess, setSecuritySuccess] = useState('');
  const [securitySaving, setSecuritySaving] = useState(false);
  const [showPin, setShowPin] = useState(false);

  useEffect(() => {
    setDraftConfig(config);
  }, [config]);

  useEffect(() => {
    const checkPwa = window.matchMedia('(display-mode: standalone)').matches || (window.navigator as { standalone?: boolean }).standalone === true;
    setIsPwa(checkPwa);

    if (!checkPwa) {
      setPushLoading(false);
      return;
    }

    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setPushSupport(false);
      setPushLoading(false);
      return;
    }

    isPushSubscribed().then(setPushSubscribed).finally(() => setPushLoading(false));
  }, []);

  const handlePushToggle = async (checked: boolean) => {
    setPushLoading(true);
    setPushError('');
    try {
      if (checked) {
        await subscribeUserToPush();
        setPushSubscribed(true);
      } else {
        await unsubscribeUserFromPush();
        setPushSubscribed(false);
      }
    } catch (err: unknown) {
      setPushError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setPushLoading(false);
    }
  };

  const sendTestNotification = async () => {
    setPushError('');
    try {
      const res = await fetch(apiUrl('/api/notifications/test'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await readJsonResponse<{ error?: string; message?: string }>(res);
      if (!res.ok) throw new Error(data.error || 'Erreur serveur');
    } catch (err: unknown) {
      setPushError(err instanceof Error ? err.message : 'Erreur envoi test');
    }
  };

  function updateDraft(patch: Partial<typeof draftConfig>) {
    setDraftConfig((current) => ({ ...current, ...patch }));
  }

  async function saveApplicationSettings() {
    if (!token) return;
    setApplicationError('');
    setApplicationSuccess('');
    setApplicationSaving(true);
    try {
      const nextConfig = await updateConfig(token, {
        appName: draftConfig.appName,
        appSubtitle: draftConfig.appSubtitle,
        loginMessage: draftConfig.loginMessage,
        showSystemVersion: draftConfig.showSystemVersion,
      });
      setDraftConfig(nextConfig);
      setApplicationSuccess('Paramètres de l’application enregistrés.');
    } catch (err: unknown) {
      setApplicationError(err instanceof Error ? err.message : 'Erreur serveur');
    } finally {
      setApplicationSaving(false);
    }
  }

  async function saveDisplaySettings() {
    if (!token) return;
    setDisplayError('');
    setDisplaySuccess('');
    setDisplaySaving(true);
    try {
      const nextConfig = await updateConfig(token, {
        uiDensity: draftConfig.uiDensity,
        cameraCardSize: draftConfig.cameraCardSize,
        showStatusPanel: draftConfig.showStatusPanel,
      });
      setDraftConfig(nextConfig);
      setDisplaySuccess('Réglages d’affichage enregistrés.');
    } catch (err: unknown) {
      setDisplayError(err instanceof Error ? err.message : 'Erreur serveur');
    } finally {
      setDisplaySaving(false);
    }
  }

  async function saveCameraSettings() {
    if (!token) return;
    setCameraError('');
    setCameraSuccess('');
    setCameraSaving(true);
    try {
      const nextConfig = await updateConfig(token, {
        cameraAutostartEnabled: draftConfig.cameraAutostartEnabled,
        cameraRefreshSeconds: draftConfig.cameraRefreshSeconds,
        showOfflineCameras: draftConfig.showOfflineCameras,
        defaultCameraAddMode: draftConfig.defaultCameraAddMode,
        cameraDiscoveryIntervalSeconds: draftConfig.cameraDiscoveryIntervalSeconds,
      });
      setDraftConfig(nextConfig);
      setCameraSuccess('Réglages caméras enregistrés.');
    } catch (err: unknown) {
      setCameraError(err instanceof Error ? err.message : 'Erreur serveur');
    } finally {
      setCameraSaving(false);
    }
  }

  async function saveAlertsSettings() {
    if (!token) return;
    setAlertsError('');
    setAlertsSuccess('');
    setAlertsSaving(true);
    try {
      const nextConfig = await updateConfig(token, {
        alertsRealtimeEnabled: draftConfig.alertsRealtimeEnabled,
        alertsDailySummaryEnabled: draftConfig.alertsDailySummaryEnabled,
        alertsSoundEnabled: draftConfig.alertsSoundEnabled,
        alertsDisconnectEnabled: draftConfig.alertsDisconnectEnabled,
      });
      setDraftConfig(nextConfig);
      setAlertsSuccess('Préférences d’alerte enregistrées.');
    } catch (err: unknown) {
      setAlertsError(err instanceof Error ? err.message : 'Erreur serveur');
    } finally {
      setAlertsSaving(false);
    }
  }

  async function resetSystem() {
    if (!token) return;
    setResetError('');
    setResetLoading(true);
    try {
      const res = await fetch(apiUrl('/api/system/reset'), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await readJsonResponse<{ error?: string }>(res);
      if (!res.ok) throw new Error(data.error || 'Erreur de réinitialisation');

      resetSettings();
      setShowResetConfirm(false);
      logout();
      window.location.reload();
    } catch (err: unknown) {
      setResetError(err instanceof Error ? err.message : 'Erreur de réinitialisation');
      setResetLoading(false);
    }
  }

  async function saveSecuritySettings() {
    if (!token) return;
    const pin = draftConfig.kioskPin.trim();
    if (pin.length !== 4) {
      alert("Le PIN doit faire exactement 4 chiffres.");
      return;
    }
    setSecurityError('');
    setSecuritySuccess('');
    setSecuritySaving(true);
    try {
      const nextConfig = await updateConfig(token, { kioskPin: pin });
      setDraftConfig(nextConfig);
      setSecuritySuccess('Code PIN synchronisé avec succès pour tous les appareils.');
    } catch (err: unknown) {
      setSecurityError(err instanceof Error ? err.message : 'Erreur serveur');
    } finally {
      setSecuritySaving(false);
    }
  }

  return (
    <div>
      <div className="settings-section">
        <div className="settings-section-label settings-section-label--row">
          <span>APPLICATION</span>
          <button className="ui-confirm-btn" onClick={saveApplicationSettings} disabled={applicationSaving || !draftConfig.appName.trim() || !draftConfig.appSubtitle.trim() || !draftConfig.loginMessage.trim()}>
            {applicationSaving ? 'Enregistrement...' : 'Enregistrer'}
          </button>
        </div>
        <div className="settings-config-grid">
          <label className="settings-field">
            <span className="settings-field-label">Titre principal</span>
            <input className="ui-input" type="text" value={draftConfig.appName} readOnly={isKeyboardEnabled} onFocus={() => showKeyboard(draftConfig.appName, (value) => updateDraft({ appName: value }))} onChange={event => updateDraft({ appName: event.target.value })} />
          </label>
          <label className="settings-field">
            <span className="settings-field-label">Sous-titre</span>
            <input className="ui-input" type="text" value={draftConfig.appSubtitle} readOnly={isKeyboardEnabled} onFocus={() => showKeyboard(draftConfig.appSubtitle, (value) => updateDraft({ appSubtitle: value }))} onChange={event => updateDraft({ appSubtitle: event.target.value })} />
          </label>
          <label className="settings-field settings-field--wide">
            <span className="settings-field-label">Message d’accueil login</span>
            <input className="ui-input" type="text" value={draftConfig.loginMessage} readOnly={isKeyboardEnabled} onFocus={() => showKeyboard(draftConfig.loginMessage, (value) => updateDraft({ loginMessage: value }))} onChange={event => updateDraft({ loginMessage: event.target.value })} />
          </label>
        </div>
        <div className="settings-toggle-list">
          <SettingToggle
            label="Afficher la version système"
            description="Affiche le numéro de version dans l’en-tête et sur l’écran de connexion."
            checked={draftConfig.showSystemVersion}
            onChange={(checked) => updateDraft({ showSystemVersion: checked })}
          />
        </div>
        {applicationError && <div className="settings-msg settings-msg--error">⚠ {applicationError}</div>}
        {applicationSuccess && <div className="settings-msg settings-msg--success">✓ {applicationSuccess}</div>}
      </div>

      <div className="settings-section">
        <div className="settings-section-label settings-section-label--row">
          <span>PERSONNALISATION</span>
          <button type="button" className="panel-action-btn" onClick={resetSettings}>Réinitialiser</button>
        </div>

        <div className="appearance-editor">
          <div className="appearance-control-group">
            <span className="appearance-control-label">Thème</span>
            <div className="appearance-choice-list">
              {[{ id: 'dark', label: 'Sombre' }, { id: 'light', label: 'Clair' }].map(option => (
                <button
                  key={option.id}
                  type="button"
                  className={`appearance-choice ${settings.theme === option.id ? 'appearance-choice--active' : ''}`}
                  onClick={() => updateSettings({ theme: option.id as 'dark' | 'light' })}
                >
                  <span className="appearance-choice-title">{option.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="appearance-control-group">
            <span className="appearance-control-label">Couleur principale</span>
            <div className="appearance-choice-list appearance-choice-list--accent">
              {APPEARANCE_ACCENTS.map(option => (
                <button
                  key={option.id}
                  type="button"
                  className={`appearance-choice appearance-choice--accent ${settings.accent === option.id ? 'appearance-choice--active' : ''}`}
                  onClick={() => updateSettings({ accent: option.id })}
                >
                  <span className={`appearance-accent-dot appearance-accent-dot--${option.id}`} aria-hidden="true" />
                  <span className="appearance-choice-title">{option.label}</span>
                  <span className="appearance-choice-desc">{option.description}</span>
                </button>
              ))}
            </div>
          </div>

          <label className="appearance-slider">
            <div className="appearance-slider-header">
              <span className="appearance-control-label">Taille du texte</span>
              <span className="appearance-slider-value">{Math.round(settings.fontScale * 100)}%</span>
            </div>
            <input type="range" min="90" max="120" step="2" value={Math.round(settings.fontScale * 100)} onChange={event => updateSettings({ fontScale: Number(event.target.value) / 100 })} />
          </label>

          <label className="appearance-slider">
            <div className="appearance-slider-header">
              <span className="appearance-control-label">Taille tactile</span>
              <span className="appearance-slider-value">{settings.touchTarget}px</span>
            </div>
            <input type="range" min="40" max="64" step="4" value={settings.touchTarget} onChange={event => updateSettings({ touchTarget: Number(event.target.value) })} />
          </label>

          <div className="appearance-preview" aria-label="Aperçu de l'interface">
            <div className="appearance-preview-shell">
              <div className="appearance-preview-topbar">
                <span className="appearance-preview-brand">{config.appName}</span>
                <span className="appearance-preview-status">EN LIGNE</span>
              </div>
              <div className="appearance-preview-content">
                <div className="appearance-preview-panel">
                  <span className="appearance-preview-kicker">Caméras</span>
                  <span className="appearance-preview-title">Vue tactile</span>
                  <span className="appearance-preview-text">Aperçu direct du thème, de la lisibilité et de la taille des zones cliquables.</span>
                </div>
                <div className="appearance-preview-actions">
                  <button type="button" className="appearance-preview-button appearance-preview-button--primary">Afficher</button>
                  <button type="button" className="appearance-preview-button">Paramètres</button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="settings-msg settings-msg--success">
          Personnalisation enregistrée automatiquement sur cet appareil. Valeurs par défaut : {APPEARANCE_DEFAULTS.theme}, {Math.round(APPEARANCE_DEFAULTS.fontScale * 100)}%, {APPEARANCE_DEFAULTS.touchTarget}px.
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-label settings-section-label--row">
          <span>AFFICHAGE</span>
          <button className="ui-confirm-btn" onClick={saveDisplaySettings} disabled={displaySaving}>
            {displaySaving ? 'Enregistrement...' : 'Enregistrer'}
          </button>
        </div>
        <div className="settings-config-grid">
          <div className="settings-field">
            <span className="settings-field-label">Densité d’interface</span>
            <SettingsDropdown
              value={draftConfig.uiDensity}
              options={[
                { value: 'compact', label: 'Compacte' },
                { value: 'standard', label: 'Standard' },
                { value: 'touch', label: 'Tactile' }
              ]}
              onChange={val => updateDraft({ uiDensity: val as typeof draftConfig.uiDensity })}
              ariaLabel="Densité d’interface"
            />
          </div>
          <div className="settings-field">
            <span className="settings-field-label">Taille des cartes caméra</span>
            <SettingsDropdown
              value={draftConfig.cameraCardSize}
              options={[
                { value: 'compact', label: 'Compacte' },
                { value: 'standard', label: 'Standard' },
                { value: 'large', label: 'Grande' }
              ]}
              onChange={val => updateDraft({ cameraCardSize: val as typeof draftConfig.cameraCardSize })}
              ariaLabel="Taille des cartes caméra"
            />
          </div>
        </div>
        <div className="settings-toggle-list">
          <SettingToggle
            label="Afficher le panneau de statut"
            description="Affiche l'indicateur de statut du système dans l’en-tête."
            checked={draftConfig.showStatusPanel}
            onChange={(checked) => updateDraft({ showStatusPanel: checked })}
          />
          <SettingToggle
            label="Utiliser le clavier virtuel à l'écran"
            description="Affiche un clavier pour les champs de saisie. Utile pour les écrans tactiles."
            checked={isKeyboardEnabled}
            onChange={(checked) => {
              if (checked) {
                window.localStorage.setItem('sentys:virtual_keyboard', 'true');
              } else {
                window.localStorage.removeItem('sentys:virtual_keyboard');
              }
              window.location.reload();
            }}
          />
        </div>
        {displayError && <div className="settings-msg settings-msg--error">⚠ {displayError}</div>}
        {displaySuccess && <div className="settings-msg settings-msg--success">✓ {displaySuccess}</div>}
      </div>

      <div className="settings-section">
        <div className="settings-section-label settings-section-label--row">
          <span>CAMÉRAS</span>
          <button className="ui-confirm-btn" onClick={saveCameraSettings} disabled={cameraSaving}>
            {cameraSaving ? 'Enregistrement...' : 'Enregistrer'}
          </button>
        </div>
        <div className="settings-config-grid">
          <label className="settings-field">
            <span className="settings-field-label">Rafraîchissement de la grille</span>
            <input className="ui-input" type="number" min="2" max="15" value={draftConfig.cameraRefreshSeconds} readOnly={isKeyboardEnabled} onFocus={() => showKeyboard(String(draftConfig.cameraRefreshSeconds), (value) => updateDraft({ cameraRefreshSeconds: Number(value) || 2 }))} onChange={event => updateDraft({ cameraRefreshSeconds: Number(event.target.value) || 2 })} />
            <span className="settings-field-hint">Secondes entre deux synchronisations de la liste des caméras.</span>
          </label>
          <label className="settings-field">
    <span className="settings-field-label">Intervalle découverte (Nœuds / Scan)</span>
            <input className="ui-input" type="number" min="3" max="30" value={draftConfig.cameraDiscoveryIntervalSeconds} readOnly={isKeyboardEnabled} onFocus={() => showKeyboard(String(draftConfig.cameraDiscoveryIntervalSeconds), (value) => updateDraft({ cameraDiscoveryIntervalSeconds: Number(value) || 3 }))} onChange={event => updateDraft({ cameraDiscoveryIntervalSeconds: Number(event.target.value) || 3 })} />
            <span className="settings-field-hint">Secondes entre deux rafraîchissements dans le panneau d’ajout caméra.</span>
          </label>
          <div className="settings-field">
            <span className="settings-field-label">Mode d’ajout par défaut</span>
            <SettingsDropdown
              value={draftConfig.defaultCameraAddMode}
              options={[
        { value: 'discover', label: 'Scan Réseau' },
                { value: 'manual', label: 'Manuel' }
              ]}
              onChange={val => updateDraft({ defaultCameraAddMode: val as typeof draftConfig.defaultCameraAddMode })}
              ariaLabel="Mode d’ajout par défaut"
            />
          </div>
        </div>
        <div className="settings-toggle-list">
          <SettingToggle
            label="Démarrer automatiquement les caméras au lancement du serveur"
            description="Si désactivé, les flux actifs restent enregistrés mais ne sont pas relancés automatiquement au boot."
            checked={draftConfig.cameraAutostartEnabled}
            onChange={(checked) => updateDraft({ cameraAutostartEnabled: checked })}
          />
          <SettingToggle
            label="Afficher les caméras hors ligne"
            description="Conserve les flux stoppés ou en reconnexion dans la grille principale."
            checked={draftConfig.showOfflineCameras}
            onChange={(checked) => updateDraft({ showOfflineCameras: checked })}
          />
        </div>
        {cameraError && <div className="settings-msg settings-msg--error">⚠ {cameraError}</div>}
        {cameraSuccess && <div className="settings-msg settings-msg--success">✓ {cameraSuccess}</div>}
      </div>

      <div className="settings-section">
        <div className="settings-section-label settings-section-label--row">
          <span>ALERTES</span>
          <button className="ui-confirm-btn" onClick={saveAlertsSettings} disabled={alertsSaving}>
            {alertsSaving ? 'Enregistrement...' : 'Enregistrer'}
          </button>
        </div>
        <div className="settings-toggle-list">
          <SettingToggle
            label="Alertes en temps réel"
            description="Active la remontée immédiate des événements critiques dans l’interface."
            checked={draftConfig.alertsRealtimeEnabled}
            onChange={(checked) => updateDraft({ alertsRealtimeEnabled: checked })}
          />
          <SettingToggle
            label="Rapport journalier"
            description="Prépare un résumé quotidien des événements et détections."
            checked={draftConfig.alertsDailySummaryEnabled}
            onChange={(checked) => updateDraft({ alertsDailySummaryEnabled: checked })}
          />
          <SettingToggle
            label="Alertes sonores"
            description="Autorise le déclenchement sonore local quand une alerte critique est remontée."
            checked={draftConfig.alertsSoundEnabled}
            onChange={(checked) => updateDraft({ alertsSoundEnabled: checked })}
          />
          <SettingToggle
            label="Alerter si une caméra se déconnecte"
            description="Marque les coupures caméra comme alertes prioritaires."
            checked={draftConfig.alertsDisconnectEnabled}
            onChange={(checked) => updateDraft({ alertsDisconnectEnabled: checked })}
          />
        </div>
        {alertsError && <div className="settings-msg settings-msg--error">⚠ {alertsError}</div>}
        {alertsSuccess && <div className="settings-msg settings-msg--success">✓ {alertsSuccess}</div>}
      </div>

      <div className="settings-section">
        <div className="settings-section-label">NOTIFICATIONS PUSH (US-16)</div>
        {!isPwa ? (
          <div className="settings-msg settings-msg--error">
            ⚠ Les notifications push sont uniquement disponibles lorsque l'application est installée (PWA). Veuillez installer l'application pour activer cette fonctionnalité.
          </div>
        ) : !pushSupport ? (
          <div className="settings-msg settings-msg--error">
            ⚠ Les notifications push ne sont pas supportées par ce navigateur ou cette connexion (HTTPS est requis).
          </div>
        ) : (
          <>
            <div className="settings-toggle-list">
              <SettingToggle
                label="Recevoir les alertes critiques sur cet appareil"
                description="Vous recevrez une notification même si l'application est fermée."
                checked={pushSubscribed}
                onChange={handlePushToggle}
                disabled={pushLoading}
              />
            </div>
            {pushError && <div className="settings-msg settings-msg--error">⚠ {pushError}</div>}
            {pushSubscribed && (
              <div style={{ marginTop: '16px' }}>
                <button className="ui-link-btn" onClick={sendTestNotification}>Envoyer une notification de test</button>
              </div>
            )}
          </>
        )}
      </div>

      <div className="settings-section">
        <div className="settings-section-label settings-section-label--row">
          <span>SÉCURITÉ LOCALE</span>
          <button className="ui-confirm-btn" onClick={saveSecuritySettings} disabled={securitySaving}>
            {securitySaving ? 'Enregistrement...' : 'Enregistrer le PIN'}
          </button>
        </div>
        <div className="settings-config-grid">
          <label className="settings-field">
            <span className="settings-field-label">Code PIN (4 chiffres)</span>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input
                className="ui-input"
                type="text"
                inputMode="numeric"
                maxLength={4}
                placeholder="Ex: 1234"
                value={showPin ? draftConfig.kioskPin : '●'.repeat(draftConfig.kioskPin.length)}
                readOnly={isKeyboardEnabled || !showPin}
                onFocus={() => showPin && showKeyboard(draftConfig.kioskPin, (value) => updateDraft({ kioskPin: value.replace(/\D/g, '') }))}
                onChange={e => showPin && updateDraft({ kioskPin: e.target.value.replace(/\D/g, '') })}
                style={{ maxWidth: '200px', letterSpacing: showPin ? 'normal' : '4px' }}
                autoComplete="off"
              />
              <button type="button" className="ui-link-btn" onClick={() => setShowPin(!showPin)}>
                {showPin ? 'Cacher' : 'Voir'}
              </button>
            </div>
            <span className="settings-field-hint">Ce code est obligatoire (1234 par défaut) et protège l'armement et l'accès Admin.</span>
          </label>
        </div>
        {securityError && <div className="settings-msg settings-msg--error">⚠ {securityError}</div>}
        {securitySuccess && <div className="settings-msg settings-msg--success">✓ {securitySuccess}</div>}
      </div>

      <div className="settings-section">
        <div className="settings-section-label">SYSTÈME</div>
        <div className="settings-danger-zone">
          <div className="settings-danger-zone-copy">
            <div className="settings-danger-zone-title">RÉINITIALISATION COMPLÈTE</div>
            <div className="settings-danger-zone-text">
              Remet le titre par défaut, supprime les comptes et efface la configuration des caméras. Les enregistrements vidéo ne sont pas supprimés.
            </div>
          </div>
          <div className="settings-system-actions">
            <button type="button" className="ui-delete-btn ui-delete-btn--danger ui-delete-btn--xl" onClick={() => setShowResetConfirm(true)}>
              Réinitialiser la configuration
            </button>
          </div>
        </div>
        {resetError && <div className="settings-msg settings-msg--error">⚠ {resetError}</div>}
      </div>

      {showResetConfirm && (
        <div className="settings-modal-overlay" onClick={() => !resetLoading && setShowResetConfirm(false)}>
          <div className="settings-modal-card settings-modal-card--danger" onClick={event => event.stopPropagation()}>
            <div className="settings-modal-title settings-modal-title--danger">RÉINITIALISER LA CONFIGURATION</div>
            <div className="settings-modal-warning settings-modal-warning--danger">
              Cette action supprime tous les utilisateurs actuels, réactive le compte bootstrap root / root, remet l'identité de l'application aux valeurs par défaut et efface toutes les caméras configurées.
            </div>
            <div className="settings-modal-warning">
              Les enregistrements vidéo existants restent inchangés.
            </div>
            <div className="settings-modal-actions">
              <button className="ui-link-btn" onClick={() => setShowResetConfirm(false)} disabled={resetLoading}>Annuler</button>
              <button className="ui-delete-btn ui-delete-btn--danger" onClick={resetSystem} disabled={resetLoading}>
                {resetLoading ? 'Réinitialisation...' : 'Réinitialiser'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface User {
  id: number;
  username: string;
  role: string;
  created_at: string;
}

function TabUsers() {
  const { showKeyboard, isKeyboardEnabled } = useVirtualKeyboard();
  const { token, user: currentUser } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newPass, setNewPass] = useState("");
  const [newRole, setNewRole] = useState("user");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [confirmUser, setConfirmUser] = useState<User | null>(null);
  const [deleteUserTarget, setDeleteUserTarget] = useState<User | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editUsername, setEditUsername] = useState('');
  const [editPassword, setEditPassword] = useState('');

  const authHeaders = useMemo(() => token ? { Authorization: `Bearer ${token}` } : undefined, [token]);

  const isMounted = useRef(true);
  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch(apiUrl('/api/users'), { headers: authHeaders });
      const data = await readJsonResponse<Array<User> & { error?: string }>(res);
      if (!isMounted.current) return;
      if (!res.ok) throw new Error(data.error || 'Impossible de charger les utilisateurs');
      setUsers(data);
    } catch (err: unknown) {
      if (!isMounted.current) return;
      setError(err instanceof Error ? err.message : 'Impossible de charger les utilisateurs');
    } finally {
      if (isMounted.current) setLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => {
    if (!token) return;
    fetchUsers();
  }, [token, fetchUsers]);

  async function createUser() {
    setError("");
    setSuccess("");
    if (!newUsername || !newPass) { setError("Identifiant et mot de passe requis"); return; }
    try {
      const res = await fetch(apiUrl('/api/users'), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(authHeaders || {}) },
        body: JSON.stringify({ username: newUsername, password: newPass, role: newRole }),
      });
      const data = await readJsonResponse<{ error?: string; username: string }>(res);
      if (!res.ok) { setError(data.error || 'Erreur serveur'); return; }
      setSuccess(`Utilisateur ${data.username} créé !`);
      setNewUsername("");
      setNewPass("");
      setNewRole('user');
      setShowAdd(false);
      fetchUsers();
    } catch {
      setError("Erreur serveur");
    }
  }

  async function deleteUser(id: number) {
    setDeleteError('');
    try {
      const res = await fetch(apiUrl(`/api/users/${id}`), { method: "DELETE", headers: authHeaders });
      const data = await readJsonResponse<{ error?: string }>(res);
      if (!res.ok) throw new Error(data.error || 'Erreur suppression');
      setUsers(prev => prev.filter(entry => entry.id !== id));
      setSuccess('Utilisateur supprimé.');
      setDeleteUserTarget(null);
    } catch (err: unknown) {
      setDeleteError(err instanceof Error ? err.message : 'Erreur suppression');
    }
  }

  async function confirmToggleRole() {
    if (!confirmUser) return;
    const nextRole = confirmUser.role === "admin" ? "user" : "admin";
    try {
      const res = await fetch(apiUrl(`/api/users/${confirmUser.id}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(authHeaders || {}) },
        body: JSON.stringify({ role: nextRole }),
      });
      const data = await readJsonResponse<User & { error?: string }>(res);
      if (!res.ok) throw new Error(data.error || 'Erreur mise à jour rôle');
      setUsers(prev => prev.map(entry => entry.id === confirmUser.id ? data : entry));
      setSuccess(`Rôle de ${confirmUser.username} changé en ${nextRole.toUpperCase()}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur mise à jour rôle');
    } finally {
      setConfirmUser(null);
    }
  }

  function startEditUser(target: User) {
    setEditingUser(target);
    setEditUsername(target.username);
    setEditPassword('');
    setError('');
    setSuccess('');
  }

  async function saveUserEdits() {
    if (!editingUser) return;
    try {
      const res = await fetch(apiUrl(`/api/users/${editingUser.id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(authHeaders || {}) },
        body: JSON.stringify({ username: editUsername, password: editPassword || undefined }),
      });
      const data = await readJsonResponse<User & { error?: string }>(res);
      if (!res.ok) throw new Error(data.error || 'Erreur mise à jour utilisateur');
      setUsers(prev => prev.map(entry => entry.id === editingUser.id ? data : entry));
      setSuccess(`Compte ${data.username} mis à jour.`);
      setEditingUser(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur mise à jour utilisateur');
    }
  }

  return (
    <div>
      <div className="settings-section">
        <div className="settings-section-label settings-section-label--row">
          <span>UTILISATEURS ({users.length})</span>
          <button type="button" className={`panel-action-btn ${showAdd ? 'panel-action-btn--active' : ''}`} onClick={() => { setShowAdd(v => !v); setError(""); setSuccess(""); }}>
            <span className="panel-action-btn__icon" aria-hidden="true">{showAdd ? '×' : '+'}</span>
            <span>{showAdd ? 'Fermer' : 'Ajouter un utilisateur'}</span>
          </button>
        </div>

        {showAdd && (
          <form className="ui-add-form settings-add-form" onSubmit={e => { e.preventDefault(); createUser(); }}>
            <input className="ui-input" type="text" placeholder="Identifiant" value={newUsername} readOnly={isKeyboardEnabled} onFocus={() => showKeyboard(newUsername, setNewUsername)} onChange={event => setNewUsername(event.target.value)} autoFocus autoComplete="off" />
            <input className="ui-input" type="password" placeholder="Mot de passe" value={newPass} readOnly={isKeyboardEnabled} onFocus={() => showKeyboard(newPass, setNewPass)} onChange={event => setNewPass(event.target.value)} autoComplete="new-password" />
            <div style={{ flex: 1 }}>
              <SettingsDropdown
                value={newRole}
                options={[
                  { value: 'user', label: 'Utilisateur' },
                  { value: 'admin', label: 'Administrateur' }
                ]}
                onChange={setNewRole}
                ariaLabel="Rôle du nouvel utilisateur"
              />
            </div>
            <button className="ui-confirm-btn" type="submit">Créer</button>
          </form>
        )}

        {error && <div className="settings-msg settings-msg--error">⚠ {error}</div>}
        {success && <div className="settings-msg settings-msg--success">✓ {success}</div>}

        {loading ? (
          <div className="settings-loading">Chargement...</div>
        ) : (
          <div className="table-scroll-container">
            <table className="ui-table settings-users-table">
              <thead>
                <tr>
                  <th className="ui-th">IDENTIFIANT</th>
                  <th className="ui-th">RÔLE</th>
                  <th className="ui-th">CRÉÉ LE</th>
                  <th className="ui-th">COMPTE</th>
                  <th className="ui-th ui-th--right">ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {users.length === 0 && (
                  <tr><td colSpan={5} className="ui-td settings-users-empty">Aucun utilisateur</td></tr>
                )}
                {users.map((entry, index) => (
                  <tr key={entry.id} className={index % 2 === 0 ? "ui-tr--odd" : "ui-tr--even"}>
                    <td className="ui-td"><span className="ui-name">{entry.username}</span></td>
                    <td className="ui-td">
                      <button className="ui-status-btn" onClick={() => setConfirmUser(entry)} title="Changer le rôle">
                        <span className={`ui-badge ${entry.role === "admin" ? "ui-badge--alert" : "ui-badge--ok"}`}>
                          <span className="ui-badge-dot" />
                          {entry.role === "admin" ? "ADMIN" : "USER"}
                        </span>
                      </button>
                    </td>
                    <td className="ui-td"><span className="ui-type">{new Date(entry.created_at).toLocaleDateString("fr-FR")}</span></td>
                    <td className="ui-td"><span className="ui-type">{currentUser?.id === entry.id ? 'Connecté' : 'Utilisateur'}</span></td>
                    <td className="ui-td ui-td--right">
                      <button className="ui-link-btn" style={{ marginRight: '8px' }} onClick={() => startEditUser(entry)} title="Modifier">Éditer</button>
                      <button className="ui-delete-btn" onClick={() => { setDeleteUserTarget(entry); setDeleteError(''); }} title="Supprimer">✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {confirmUser && (
        <div className="settings-modal-overlay" onClick={() => setConfirmUser(null)}>
          <div className="settings-modal-card" onClick={event => event.stopPropagation()}>
            <div className="settings-modal-title">MODIFIER LE RÔLE</div>
            <div className="settings-modal-user">Utilisateur : <strong>{confirmUser.username}</strong></div>
            <div className="settings-modal-roles">
              <span className={`ui-badge ${confirmUser.role === "admin" ? "ui-badge--alert" : "ui-badge--ok"}`}><span className="ui-badge-dot" />{confirmUser.role.toUpperCase()}</span>
              <span className="settings-role-arrow">→</span>
              <span className={`ui-badge ${confirmUser.role === "admin" ? "ui-badge--ok" : "ui-badge--alert"}`}><span className="ui-badge-dot" />{confirmUser.role === "admin" ? "USER" : "ADMIN"}</span>
            </div>
            <div className="settings-modal-warning">Cette action modifie les permissions de l'utilisateur immédiatement.</div>
            <div className="settings-modal-actions">
              <button className="ui-delete-btn" onClick={() => setConfirmUser(null)}>Annuler</button>
              <button className="ui-confirm-btn" onClick={confirmToggleRole}>Confirmer</button>
            </div>
          </div>
        </div>
      )}

      {deleteUserTarget && (
        <div className="settings-modal-overlay" onClick={() => { setDeleteUserTarget(null); setDeleteError(''); }}>
          <div className="settings-modal-card settings-modal-card--danger" onClick={event => event.stopPropagation()}>
            <div className="settings-modal-title settings-modal-title--danger">SUPPRIMER L'UTILISATEUR</div>
            <div className="settings-modal-user">Utilisateur : <strong>{deleteUserTarget.username}</strong></div>
            <div className="settings-modal-warning settings-modal-warning--danger">
              Cette suppression est immédiate. L'utilisateur perdra définitivement l'accès à l'application.
            </div>
            {deleteError && <div className="settings-modal-inline-error">⚠ {deleteError}</div>}
            <div className="settings-modal-actions">
              <button className="ui-link-btn" onClick={() => { setDeleteUserTarget(null); setDeleteError(''); }}>Annuler</button>
              <button className="ui-delete-btn ui-delete-btn--danger" onClick={() => deleteUser(deleteUserTarget.id)}>Supprimer</button>
            </div>
          </div>
        </div>
      )}

      {editingUser && (
        <div className="settings-modal-overlay" onClick={() => setEditingUser(null)}>
          <div className="settings-modal-card settings-modal-card--form" onClick={event => event.stopPropagation()}>
            <div className="settings-modal-title">MODIFIER LE COMPTE</div>
            <form className="settings-modal-form" onSubmit={e => { e.preventDefault(); saveUserEdits(); }}>
              <input className="ui-input" type="text" value={editUsername} readOnly={isKeyboardEnabled} onFocus={() => showKeyboard(editUsername, setEditUsername)} onChange={event => setEditUsername(event.target.value)} placeholder="Identifiant" autoComplete="off" />
              <input className="ui-input" type="password" value={editPassword} readOnly={isKeyboardEnabled} onFocus={() => showKeyboard(editPassword, setEditPassword)} onChange={event => setEditPassword(event.target.value)} placeholder="Nouveau mot de passe (laisser vide pour conserver)" autoComplete="new-password" />
            </form>
            <div className="settings-modal-warning">Le mot de passe initial root/root devient inactif dès que tu modifies ce compte bootstrap.</div>
            <div className="settings-modal-actions">
              <button className="ui-delete-btn" onClick={() => setEditingUser(null)}>Annuler</button>
              <button className="ui-confirm-btn" onClick={saveUserEdits}>Enregistrer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface AuditLog {
  id: number;
  username: string;
  action: string;
  details: string;
  ip_address: string;
  created_at: string;
}

function TabAudit() {
  const { token } = useAuth();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) return;
    let isMounted = true;
    fetch(apiUrl('/api/audit-logs'), { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.json())
      .then(data => {
        if (!isMounted) return;
        if (data.error) setError(data.error);
        else setLogs(Array.isArray(data) ? data : []);
      })
      .catch(() => { if (isMounted) setError("Erreur réseau"); })
      .finally(() => { if (isMounted) setLoading(false); });
    return () => { isMounted = false; };
  }, [token]);

  return (
    <div className="settings-section">
      <div className="settings-section-label">JOURNAL DES ACTIONS (AUDIT)</div>
      <div className="settings-danger-zone-text" style={{ marginBottom: '16px' }}>
        Historique des actions sensibles, connexions et modifications de configuration.
      </div>
      
      {error && <div className="settings-msg settings-msg--error">⚠ {error}</div>}
      
      {loading ? (
        <div className="settings-loading">Chargement...</div>
      ) : (
        <div className="table-scroll-container">
          <table className="ui-table settings-users-table">
            <thead>
              <tr>
                <th className="ui-th">DATE</th>
                <th className="ui-th">UTILISATEUR</th>
                <th className="ui-th">ACTION</th>
                <th className="ui-th">DÉTAILS</th>
                <th className="ui-th">IP</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 && (
                <tr><td colSpan={5} className="ui-td settings-users-empty">Aucun journal disponible</td></tr>
              )}
              {logs.map((log, i) => (
                <tr key={log.id} className={i % 2 === 0 ? "ui-tr--odd" : "ui-tr--even"}>
                  <td className="ui-td"><span className="ui-type">{new Date(log.created_at).toLocaleString("fr-FR")}</span></td>
                  <td className="ui-td"><span className="ui-name">{log.username || 'Système'}</span></td>
                  <td className="ui-td"><span className={`ui-badge ${log.action.includes('FAIL') || log.action.includes('DELETE') ? 'ui-badge--alert' : 'ui-badge--ok'}`}><span className="ui-badge-dot"/>{log.action}</span></td>
                  <td className="ui-td"><span className="ui-type">{log.details}</span></td>
                  <td className="ui-td"><span className="ui-type">{log.ip_address}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function TabHelp() {
  return (
    <div>
      <div className="settings-section">
        <div className="settings-section-label">À PROPOS</div>
        <div className="settings-danger-zone-text" style={{ marginBottom: '16px', lineHeight: '1.8' }}>
          <strong>SENTYS Surveillance</strong> est un système de vidéosurveillance auto-hébergé, développé dans le cadre d'un Travail de Fin d'Études.<br /><br />
          <span style={{ color: 'var(--text-secondary)' }}>
            © {new Date().getFullYear()} SENTYS — Théo Mertens<br />
            Frontend : React + TypeScript, Vite, HLS.js, Socket.IO<br />
            Backend : Node.js, Express, PostgreSQL, FFmpeg<br />
            IA : YOLOv8n (ultralytics), OpenCV<br />
            Matériel : Raspberry Pi Zero 2W, MediaMTX
          </span>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-label">RGPD — DONNÉES COLLECTÉES</div>
        <div className="settings-danger-zone-text" style={{ lineHeight: '1.7' }}>
          <p style={{ marginTop: 0 }}>
            SENTYS est un système <strong>entièrement auto-hébergé</strong>. Aucune donnée n'est transmise à un serveur externe ou à un cloud tiers.
          </p>
          <p style={{ marginBottom: '8px', color: 'var(--text-secondary)', fontSize: '0.85rem', fontWeight: 600 }}>DONNÉES STOCKÉES LOCALEMENT :</p>
          <ul style={{ margin: '0 0 16px 0', fontSize: '0.9rem', lineHeight: '1.6', paddingLeft: '20px', color: 'var(--text-secondary)' }}>
            <li style={{ marginBottom: '6px' }}><strong>Comptes utilisateurs</strong> — nom d'utilisateur et mot de passe (hashé bcrypt), rôle</li>
            <li style={{ marginBottom: '6px' }}><strong>Flux vidéo</strong> — segments HLS temporaires, supprimés en continu</li>
            <li style={{ marginBottom: '6px' }}><strong>Enregistrements vidéo</strong> — clips MP4 déclenchés par détection de mouvement, conservés {30} jours puis supprimés automatiquement</li>
            <li style={{ marginBottom: '6px' }}><strong>Alertes & événements</strong> — horodatage, type de détection (humain, animal, véhicule), niveau de confiance IA</li>
            <li style={{ marginBottom: '6px' }}><strong>Journal d'audit</strong> — actions administratives (connexion, modification config), adresse IP locale, horodatage</li>
            <li style={{ marginBottom: '6px' }}><strong>Noeuds caméras</strong> — adresse IP locale, nom et identifiant de l'appareil (Raspberry Pi)</li>
            <li style={{ marginBottom: '6px' }}><strong>Abonnements notifications push</strong> — endpoint du navigateur pour les alertes (stocké localement, révocable)</li>
          </ul>
          <p style={{ marginBottom: '8px', color: 'var(--text-secondary)', fontSize: '0.85rem', fontWeight: 600 }}>CE QUI N'EST PAS COLLECTÉ :</p>
          <ul style={{ margin: 0, fontSize: '0.9rem', lineHeight: '1.6', paddingLeft: '20px', color: 'var(--text-secondary)' }}>
            <li style={{ marginBottom: '6px' }}>Aucune donnée biométrique (pas de reconnaissance faciale)</li>
            <li style={{ marginBottom: '6px' }}>Aucune transmission vers Internet ou service cloud</li>
            <li style={{ marginBottom: '6px' }}>Aucun cookie de tracking ou analytique</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

interface ArchiveRecording { filename: string; url: string; createdAt: string; size: number; }
interface ArchiveEntry { cameraId: string; recordings: ArchiveRecording[]; }

function formatArchiveSize(bytes: number) {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} Go`;
}

function TabArchives() {
  const { token } = useAuth();
  const [archives, setArchives] = useState<ArchiveEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [purging, setPurging] = useState<string | null>(null);

  useEffect(() => {
    fetch(apiUrl('/api/cameras/archives'))
      .then(r => r.json())
      .then(data => { setArchives(Array.isArray(data) ? data : []); })
      .catch(() => setError('Impossible de charger les archives'))
      .finally(() => setLoading(false));
  }, []);

  async function purge(cameraId: string) {
    setPurging(cameraId);
    try {
      await fetch(apiUrl(`/api/cameras/archives/${cameraId}`), {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      setArchives(prev => prev.filter(a => a.cameraId !== cameraId));
    } finally {
      setPurging(null);
    }
  }

  if (loading) return <div className="settings-loading">Chargement des archives…</div>;
  if (error) return <div className="settings-msg settings-msg--error">{error}</div>;
  if (archives.length === 0) return (
    <div className="settings-section">
      <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>
        Aucune archive — tous les dossiers d'enregistrements correspondent à des caméras actives.
      </p>
    </div>
  );

  return (
    <div className="settings-section">
      <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '16px' }}>
        Ces enregistrements proviennent de caméras supprimées. Vous pouvez les consulter ou les purger.
      </p>
      {archives.map(archive => (
        <div key={archive.cameraId} style={{ marginBottom: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <strong style={{ fontFamily: 'var(--font-mono)', fontSize: '13px' }}>
              CAM {archive.cameraId} — {archive.recordings.length} fichier(s)
            </strong>
            <button
              className="ui-delete-btn ui-delete-btn--danger"
              disabled={purging === archive.cameraId}
              onClick={() => purge(archive.cameraId)}
            >
              {purging === archive.cameraId ? 'Suppression…' : 'Tout supprimer'}
            </button>
          </div>
          <div className="table-scroll-container">
            <table className="ui-table">
              <thead><tr><th>Fichier</th><th>Date</th><th>Taille</th><th></th></tr></thead>
              <tbody>
                {archive.recordings.map(rec => (
                  <tr key={rec.filename}>
                    <td className="ui-td">{rec.filename}</td>
                    <td className="ui-td">{new Date(rec.createdAt).toLocaleString('fr-FR')}</td>
                    <td className="ui-td">{formatArchiveSize(rec.size)}</td>
                    <td className="ui-td">
                      <a href={apiUrl(rec.url)} target="_blank" rel="noreferrer" className="ui-link-btn" style={{ marginRight: '6px' }}>Ouvrir</a>
                      <a href={apiUrl(rec.url)} download className="ui-link-btn">Télécharger</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Settings() {
  const { config } = useAppConfig();
  const [tab, setTab] = useState<"settings" | "users" | "audit" | "archives" | "help">("settings");

  return (
    <div className="settings-wrapper">
      <div className="settings-header">
        <span className="settings-title">PARAMÈTRES</span>
        <span className="settings-subtitle">{config.appSubtitle.toUpperCase()} {config.systemVersion}</span>
      </div>

      <div className="settings-tabs">
        <button className={`ui-tab-btn ${tab === "settings" ? "active" : ""}`} onClick={() => setTab("settings")}>GÉNÉRAL</button>
        <button className={`ui-tab-btn ${tab === "users" ? "active" : ""}`} onClick={() => setTab("users")}>UTILISATEURS</button>
        <button className={`ui-tab-btn ${tab === "audit" ? "active" : ""}`} onClick={() => setTab("audit")}>JOURNAL</button>
        <button className={`ui-tab-btn ${tab === "archives" ? "active" : ""}`} onClick={() => setTab("archives")}>ARCHIVES</button>
        <button className={`ui-tab-btn ${tab === "help" ? "active" : ""}`} onClick={() => setTab("help")}>À PROPOS</button>
      </div>

      {tab === "settings" ? <TabSettings /> : tab === "users" ? <TabUsers /> : tab === "audit" ? <TabAudit /> : tab === "archives" ? <TabArchives /> : <TabHelp />}
    </div>
  );
}