import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { APPEARANCE_ACCENTS, APPEARANCE_DEFAULTS, useAppearance } from "../hooks/useAppearance";
import { useAppConfig } from "../hooks/useAppConfig";
import { useAuth } from "../hooks/useAuth";
import { apiUrl, readJsonResponse } from "../lib/api";

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

function SettingToggle({ label, description, defaultChecked = false, ...props }: {
  label: string; description?: string; defaultChecked?: boolean; checked?: boolean; onChange?: (checked: boolean) => void;
}) {
  const [internalChecked, setInternalChecked] = useState(defaultChecked);
  const checked = typeof props.checked === 'boolean' ? props.checked : internalChecked;

  function handleToggle() {
    const nextValue = !checked;
    if (typeof props.checked !== 'boolean') {
      setInternalChecked(nextValue);
    }
    props.onChange?.(nextValue);
  }

  return (
    <button type="button" className={`settings-row ${checked ? 'settings-row--active' : ''}`} onClick={handleToggle}>
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
  const [kioskPin, setKioskPin] = useState(() => window.localStorage.getItem('sentys:kiosk_pin') || '');

  useEffect(() => {
    setDraftConfig(config);
  }, [config]);

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
        interfaceLanguage: draftConfig.interfaceLanguage,
        timeFormat: draftConfig.timeFormat,
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

  function saveKioskPin() {
    if (kioskPin.trim()) {
      window.localStorage.setItem('sentys:kiosk_pin', kioskPin.trim());
      alert("Code PIN enregistré. Il protègera l'écran et les actions sensibles sur cet appareil.");
    } else {
      window.localStorage.removeItem('sentys:kiosk_pin');
      alert("Code PIN désactivé.");
    }
  }

  return (
    <div>
      <div className="settings-section">
        <div className="settings-section-label settings-section-label--row">
          <span>APPLICATION</span>
          <button className="sensor-confirm-btn" onClick={saveApplicationSettings} disabled={applicationSaving || !draftConfig.appName.trim() || !draftConfig.appSubtitle.trim() || !draftConfig.loginMessage.trim()}>
            {applicationSaving ? 'Enregistrement...' : 'Enregistrer'}
          </button>
        </div>
        <div className="settings-config-grid">
          <label className="settings-field">
            <span className="settings-field-label">Titre principal</span>
            <input className="sensor-input" type="text" value={draftConfig.appName} onChange={event => updateDraft({ appName: event.target.value })} />
          </label>
          <label className="settings-field">
            <span className="settings-field-label">Sous-titre</span>
            <input className="sensor-input" type="text" value={draftConfig.appSubtitle} onChange={event => updateDraft({ appSubtitle: event.target.value })} />
          </label>
          <label className="settings-field settings-field--wide">
            <span className="settings-field-label">Message d’accueil login</span>
            <input className="sensor-input" type="text" value={draftConfig.loginMessage} onChange={event => updateDraft({ loginMessage: event.target.value })} />
          </label>
          <div className="settings-field">
            <span className="settings-field-label">Langue</span>
            <SettingsDropdown
              value={draftConfig.interfaceLanguage}
              options={[
                { value: 'fr-FR', label: 'Français' },
                { value: 'en-GB', label: 'English' }
              ]}
              onChange={val => updateDraft({ interfaceLanguage: val as typeof draftConfig.interfaceLanguage })}
              ariaLabel="Langue"
            />
          </div>
          <div className="settings-field">
            <span className="settings-field-label">Format horaire</span>
            <SettingsDropdown
              value={draftConfig.timeFormat}
              options={[
                { value: '24h', label: '24 heures' },
                { value: '12h', label: '12 heures' }
              ]}
              onChange={val => updateDraft({ timeFormat: val as typeof draftConfig.timeFormat })}
              ariaLabel="Format horaire"
            />
          </div>
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
          <button className="sensor-confirm-btn" onClick={saveDisplaySettings} disabled={displaySaving}>
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
            description="Affiche les indicateurs EN LIGNE / MODE APP dans l’en-tête."
            checked={draftConfig.showStatusPanel}
            onChange={(checked) => updateDraft({ showStatusPanel: checked })}
          />
        </div>
        {displayError && <div className="settings-msg settings-msg--error">⚠ {displayError}</div>}
        {displaySuccess && <div className="settings-msg settings-msg--success">✓ {displaySuccess}</div>}
      </div>

      <div className="settings-section">
        <div className="settings-section-label settings-section-label--row">
          <span>CAMÉRAS</span>
          <button className="sensor-confirm-btn" onClick={saveCameraSettings} disabled={cameraSaving}>
            {cameraSaving ? 'Enregistrement...' : 'Enregistrer'}
          </button>
        </div>
        <div className="settings-config-grid">
          <label className="settings-field">
            <span className="settings-field-label">Rafraîchissement de la grille</span>
            <input className="sensor-input" type="number" min="2" max="15" value={draftConfig.cameraRefreshSeconds} onChange={event => updateDraft({ cameraRefreshSeconds: Number(event.target.value) || 2 })} />
            <span className="settings-field-hint">Secondes entre deux synchronisations de la liste des caméras.</span>
          </label>
          <label className="settings-field">
            <span className="settings-field-label">Intervalle découverte nœuds / ESP32</span>
            <input className="sensor-input" type="number" min="3" max="30" value={draftConfig.cameraDiscoveryIntervalSeconds} onChange={event => updateDraft({ cameraDiscoveryIntervalSeconds: Number(event.target.value) || 3 })} />
            <span className="settings-field-hint">Secondes entre deux rafraîchissements dans le panneau d’ajout caméra.</span>
          </label>
          <div className="settings-field">
            <span className="settings-field-label">Mode d’ajout par défaut</span>
            <SettingsDropdown
              value={draftConfig.defaultCameraAddMode}
              options={[
                { value: 'node', label: 'Nœud Pi' },
                { value: 'discover', label: 'ESP32-CAM' },
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
          <button className="sensor-confirm-btn" onClick={saveAlertsSettings} disabled={alertsSaving}>
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
        <div className="settings-section-label settings-section-label--row">
          <span>SÉCURITÉ LOCALE & KIOSK</span>
          <button className="sensor-confirm-btn" onClick={saveKioskPin}>Enregistrer le PIN</button>
        </div>
        <div className="settings-config-grid">
          <label className="settings-field">
            <span className="settings-field-label">Code PIN (4 chiffres)</span>
            <input className="sensor-input" type="password" maxLength={4} placeholder="Laisser vide pour désactiver" value={kioskPin} onChange={e => setKioskPin(e.target.value.replace(/\D/g, ''))} style={{ maxWidth: '200px' }} />
            <span className="settings-field-hint">Ce code protègera l'armement du système et le déverrouillage de l'écran.</span>
          </label>
        </div>
        <div className="settings-toggle-list">
          <SettingToggle
            label="Activer le Mode Kiosk sur cet appareil"
            description="Masque l'onglet Paramètres et verrouille automatiquement l'écran après 5 minutes d'inactivité."
            checked={window.localStorage.getItem('sentys:kiosk_mode') === 'true'}
            onChange={(checked) => {
              if (checked) window.localStorage.setItem('sentys:kiosk_mode', 'true');
              else window.localStorage.removeItem('sentys:kiosk_mode');
              window.location.reload();
            }}
          />
        </div>
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
            <button type="button" className="sensor-delete-btn sensor-delete-btn--danger sensor-delete-btn--xl" onClick={() => setShowResetConfirm(true)}>
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
              <button className="sensor-link-btn" onClick={() => setShowResetConfirm(false)} disabled={resetLoading}>Annuler</button>
              <button className="sensor-delete-btn sensor-delete-btn--danger" onClick={resetSystem} disabled={resetLoading}>
                {resetLoading ? 'Réinitialisation...' : 'Confirmer la réinitialisation'}
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
  email: string;
  role: string;
  created_at: string;
}

function TabUsers() {
  const { token, user: currentUser } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newPass, setNewPass] = useState("");
  const [newRole, setNewRole] = useState("user");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [confirmUser, setConfirmUser] = useState<User | null>(null);
  const [deleteUserTarget, setDeleteUserTarget] = useState<User | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editEmail, setEditEmail] = useState('');
  const [editPassword, setEditPassword] = useState('');

  const authHeaders = useMemo(() => token ? { Authorization: `Bearer ${token}` } : undefined, [token]);

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch(apiUrl('/api/users'), { headers: authHeaders });
      const data = await readJsonResponse<Array<User> & { error?: string }>(res);
      if (!res.ok) throw new Error(data.error || 'Impossible de charger les utilisateurs');
      setUsers(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Impossible de charger les utilisateurs');
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => {
    if (!token) return;
    fetchUsers();
  }, [token, fetchUsers]);

  async function createUser() {
    setError("");
    setSuccess("");
    if (!newEmail || !newPass) { setError("Email et mot de passe requis"); return; }
    try {
      const res = await fetch(apiUrl('/api/users'), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(authHeaders || {}) },
        body: JSON.stringify({ email: newEmail, password: newPass, role: newRole }),
      });
      const data = await readJsonResponse<{ error?: string; email: string }>(res);
      if (!res.ok) { setError(data.error || 'Erreur serveur'); return; }
      setSuccess(`Utilisateur ${data.email} créé !`);
      setNewEmail("");
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
      setSuccess(`Rôle de ${confirmUser.email} changé en ${nextRole.toUpperCase()}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur mise à jour rôle');
    } finally {
      setConfirmUser(null);
    }
  }

  function startEditUser(target: User) {
    setEditingUser(target);
    setEditEmail(target.email);
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
        body: JSON.stringify({ email: editEmail, password: editPassword || undefined }),
      });
      const data = await readJsonResponse<User & { error?: string }>(res);
      if (!res.ok) throw new Error(data.error || 'Erreur mise à jour utilisateur');
      setUsers(prev => prev.map(entry => entry.id === editingUser.id ? data : entry));
      setSuccess(`Compte ${data.email} mis à jour.`);
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
          <div className="sensor-add-form settings-add-form">
            <input className="sensor-input" type="email" placeholder="Email" value={newEmail} onChange={event => setNewEmail(event.target.value)} autoFocus />
            <input className="sensor-input" type="text" placeholder="Mot de passe" value={newPass} onChange={event => setNewPass(event.target.value)} />
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
            <button className="sensor-confirm-btn" onClick={createUser}>Créer</button>
          </div>
        )}

        {error && <div className="settings-msg settings-msg--error">⚠ {error}</div>}
        {success && <div className="settings-msg settings-msg--success">✓ {success}</div>}

        {loading ? (
          <div className="settings-loading">Chargement...</div>
        ) : (
          <table className="sensor-table settings-users-table">
            <thead>
              <tr>
                <th className="sensor-th">EMAIL</th>
                <th className="sensor-th">RÔLE</th>
                <th className="sensor-th">CRÉÉ LE</th>
                <th className="sensor-th">COMPTE</th>
                <th className="sensor-th sensor-th--right">ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 && (
                <tr><td colSpan={5} className="sensor-td settings-users-empty">Aucun utilisateur</td></tr>
              )}
              {users.map((entry, index) => (
                <tr key={entry.id} className={index % 2 === 0 ? "sensor-tr--odd" : "sensor-tr--even"}>
                  <td className="sensor-td"><span className="sensor-name">{entry.email}</span></td>
                  <td className="sensor-td">
                    <button className="sensor-status-btn" onClick={() => setConfirmUser(entry)} title="Changer le rôle">
                      <span className={`sensor-badge ${entry.role === "admin" ? "sensor-badge--alert" : "sensor-badge--ok"}`}>
                        <span className="sensor-badge-dot" />
                        {entry.role === "admin" ? "ADMIN" : "USER"}
                      </span>
                    </button>
                  </td>
                  <td className="sensor-td"><span className="sensor-type">{new Date(entry.created_at).toLocaleDateString("fr-FR")}</span></td>
                  <td className="sensor-td"><span className="sensor-type">{currentUser?.id === entry.id ? 'Connecté' : 'Utilisateur'}</span></td>
                  <td className="sensor-td sensor-td--right">
                    <button className="sensor-link-btn" onClick={() => startEditUser(entry)} title="Modifier">Éditer</button>
                    <button className="sensor-delete-btn" onClick={() => { setDeleteUserTarget(entry); setDeleteError(''); }} title="Supprimer">✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {confirmUser && (
        <div className="settings-modal-overlay" onClick={() => setConfirmUser(null)}>
          <div className="settings-modal-card" onClick={event => event.stopPropagation()}>
            <div className="settings-modal-title">MODIFIER LE RÔLE</div>
            <div className="settings-modal-user">Utilisateur : <strong>{confirmUser.email}</strong></div>
            <div className="settings-modal-roles">
              <span className={`sensor-badge ${confirmUser.role === "admin" ? "sensor-badge--alert" : "sensor-badge--ok"}`}><span className="sensor-badge-dot" />{confirmUser.role.toUpperCase()}</span>
              <span className="settings-role-arrow">→</span>
              <span className={`sensor-badge ${confirmUser.role === "admin" ? "sensor-badge--ok" : "sensor-badge--alert"}`}><span className="sensor-badge-dot" />{confirmUser.role === "admin" ? "USER" : "ADMIN"}</span>
            </div>
            <div className="settings-modal-warning">Cette action modifie les permissions de l'utilisateur immédiatement.</div>
            <div className="settings-modal-actions">
              <button className="sensor-delete-btn" onClick={() => setConfirmUser(null)}>Annuler</button>
              <button className="sensor-confirm-btn" onClick={confirmToggleRole}>Confirmer</button>
            </div>
          </div>
        </div>
      )}

      {deleteUserTarget && (
        <div className="settings-modal-overlay" onClick={() => { setDeleteUserTarget(null); setDeleteError(''); }}>
          <div className="settings-modal-card settings-modal-card--danger" onClick={event => event.stopPropagation()}>
            <div className="settings-modal-title settings-modal-title--danger">SUPPRIMER L'UTILISATEUR</div>
            <div className="settings-modal-user">Utilisateur : <strong>{deleteUserTarget.email}</strong></div>
            <div className="settings-modal-warning settings-modal-warning--danger">
              Cette suppression est immédiate. L'utilisateur perdra définitivement l'accès à l'application.
            </div>
            {deleteError && <div className="settings-modal-inline-error">⚠ {deleteError}</div>}
            <div className="settings-modal-actions">
              <button className="sensor-link-btn" onClick={() => { setDeleteUserTarget(null); setDeleteError(''); }}>Annuler</button>
              <button className="sensor-delete-btn sensor-delete-btn--danger" onClick={() => deleteUser(deleteUserTarget.id)}>Supprimer l'utilisateur</button>
            </div>
          </div>
        </div>
      )}

      {editingUser && (
        <div className="settings-modal-overlay" onClick={() => setEditingUser(null)}>
          <div className="settings-modal-card settings-modal-card--form" onClick={event => event.stopPropagation()}>
            <div className="settings-modal-title">MODIFIER LE COMPTE</div>
            <div className="settings-modal-form">
              <input className="sensor-input" type="text" value={editEmail} onChange={event => setEditEmail(event.target.value)} placeholder="Identifiant" />
              <input className="sensor-input" type="password" value={editPassword} onChange={event => setEditPassword(event.target.value)} placeholder="Nouveau mot de passe (laisser vide pour conserver)" />
            </div>
            <div className="settings-modal-warning">Le mot de passe initial root/root devient inactif dès que tu modifies ce compte bootstrap.</div>
            <div className="settings-modal-actions">
              <button className="sensor-delete-btn" onClick={() => setEditingUser(null)}>Annuler</button>
              <button className="sensor-confirm-btn" onClick={saveUserEdits}>Enregistrer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Settings() {
  const { config } = useAppConfig();
  const [tab, setTab] = useState<"settings" | "users">("settings");

  return (
    <div className="settings-wrapper">
      <div className="settings-header">
        <span className="settings-title">PARAMÈTRES</span>
        <span className="settings-subtitle">{config.appSubtitle.toUpperCase()} {config.systemVersion}</span>
      </div>

      <div className="settings-tabs">
        <button className={`sensor-tab-btn ${tab === "settings" ? "active" : ""}`} onClick={() => setTab("settings")}>GÉNÉRAL</button>
        <button className={`sensor-tab-btn ${tab === "users" ? "active" : ""}`} onClick={() => setTab("users")}>UTILISATEURS</button>
      </div>

      {tab === "settings" ? <TabSettings /> : <TabUsers />}
    </div>
  );
}