import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiUrl, readJsonResponse } from '../lib/api';
import { useAuth } from '../hooks/useAuth';

interface FilterOption {
  value: string;
  label: string;
}

interface AlertEntry {
  id: number;
  source_type: string;
  source_id: string | null;
  camera_id: number | null;
  alert_type: string;
  level: 'info' | 'warning' | 'critical';
  title: string;
  message: string;
  metadata: Record<string, unknown>;
  status: 'new' | 'viewed' | 'acknowledged';
  acknowledged_by: number | null;
  acknowledged_at: string | null;
  created_at: string;
}

interface AlertsResponse {
  page: number;
  pageSize: number;
  total: number;
  alerts: AlertEntry[];
}

interface AlertSummary {
  pending_count: number;
  critical_pending_count: number;
  last_24h_count: number;
}

interface AnalyticsResponse {
  overview: {
    totalAlerts24h: number;
    criticalAlerts24h: number;
    pendingAlerts: number;
    offlineNodes: number;
  };
  topActiveCameras: Array<{
    name: string;
    device_id: string;
    motion_events: number;
  }>;
  hourlyActivity: Array<{
    hour: number;
    events: number;
  }>;
}

const PAGE_SIZE = 20;

function levelLabel(level: AlertEntry['level']) {
  return level === 'critical' ? 'Critique' : level === 'warning' ? 'Avertissement' : 'Info';
}

function statusLabel(status: AlertEntry['status']) {
  return status === 'acknowledged' ? 'Confirmee' : status === 'viewed' ? 'Vue' : 'Nouvelle';
}

function getHourBarLevel(events: number, maxEvents: number) {
  if (events <= 0 || maxEvents <= 0) return 0;
  return Math.min(10, Math.max(1, Math.round((events / maxEvents) * 10)));
}

function AlertsFilterDropdown({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: FilterOption[];
  onChange: (nextValue: string) => void;
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
    <div className={`alerts-dropdown ${open ? 'alerts-dropdown--open' : ''}`} ref={rootRef}>
      <button
        type="button"
        className="alerts-select alerts-dropdown-trigger"
        aria-haspopup="listbox"
        aria-label={label}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{selectedOption?.label || label}</span>
        <span className="alerts-dropdown-chevron" aria-hidden="true" />
      </button>

      {open && (
        <div className="alerts-dropdown-menu" role="listbox" aria-label={label}>
          {options.map((option) => (
            <button
              key={option.value || '__all'}
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

const LEVEL_OPTIONS: FilterOption[] = [
  { value: '', label: 'Tous niveaux' },
  { value: 'info', label: 'Info' },
  { value: 'warning', label: 'Avertissement' },
  { value: 'critical', label: 'Critique' },
];

const STATUS_OPTIONS: FilterOption[] = [
  { value: '', label: 'Tous statuts' },
  { value: 'new', label: 'Nouvelles' },
  { value: 'viewed', label: 'Vues' },
  { value: 'acknowledged', label: 'Confirmees' },
];

export default function AlertsPage() {
  const { token } = useAuth();
  const [alerts, setAlerts] = useState<AlertEntry[]>([]);
  const [summary, setSummary] = useState<AlertSummary | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [level, setLevel] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [actionLoadingKey, setActionLoadingKey] = useState<string | null>(null);

  const searchRef = useRef(search);
  searchRef.current = search;

  const authHeaders = useMemo(() => token ? { Authorization: `Bearer ${token}` } : undefined, [token]);

  const fetchAlerts = useCallback(async () => {
    if (!authHeaders) return;
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(PAGE_SIZE),
    });
    if (level) params.set('level', level);
    if (status) params.set('status', status);
    if (searchRef.current.trim()) params.set('search', searchRef.current.trim());

    const response = await fetch(apiUrl(`/api/alerts?${params.toString()}`), {
      headers: authHeaders,
    });
    const data = await readJsonResponse<AlertsResponse & { error?: string }>(response);
    if (!response.ok) throw new Error(data.error || 'Impossible de charger les alertes');
    setAlerts(Array.isArray(data.alerts) ? data.alerts : []);
    setTotal(data.total || 0);
  }, [authHeaders, page, level, status]);

  const fetchSummary = useCallback(async () => {
    if (!authHeaders) return;
    const response = await fetch(apiUrl('/api/alerts/summary'), { headers: authHeaders });
    const data = await readJsonResponse<AlertSummary & { error?: string }>(response);
    if (!response.ok) throw new Error(data.error || 'Impossible de charger le resume des alertes');
    setSummary(data);
  }, [authHeaders]);

  const fetchAnalytics = useCallback(async () => {
    if (!authHeaders) return;
    const response = await fetch(apiUrl('/api/alerts/analytics'), { headers: authHeaders });
    const data = await readJsonResponse<AnalyticsResponse & { error?: string }>(response);
    if (!response.ok) throw new Error(data.error || 'Impossible de charger les statistiques');
    setAnalytics(data);
  }, [authHeaders]);

  useEffect(() => {
    if (!authHeaders) return;
    setLoading(true);
    Promise.all([fetchAlerts(), fetchSummary(), fetchAnalytics()])
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Erreur inconnue'))
      .finally(() => setLoading(false));
  }, [authHeaders, fetchAlerts, fetchSummary, fetchAnalytics]);

  useEffect(() => {
    if (!authHeaders) return;
    const interval = setInterval(() => {
      fetchSummary().catch(() => {});
      fetchAnalytics().catch(() => {});
      fetchAlerts().catch(() => {});
    }, 15000);
    return () => clearInterval(interval);
  }, [authHeaders, fetchAlerts, fetchSummary, fetchAnalytics]);

  async function acknowledgeAlert(id: number) {
    if (!authHeaders) return;
    setActionLoadingKey(`ack-${id}`);
    try {
      const response = await fetch(apiUrl(`/api/alerts/${id}/ack`), {
        method: 'PATCH',
        headers: authHeaders,
      });
      const data = await readJsonResponse<AlertEntry & { error?: string }>(response);
      if (!response.ok) throw new Error(data.error || 'Impossible de confirmer l’alerte');
      setAlerts((current) => current.map((entry) => entry.id === id ? data as AlertEntry : entry));
      await fetchSummary();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setActionLoadingKey(null);
    }
  }

  async function deleteAlert(id: number) {
    if (!authHeaders) return;
    setActionLoadingKey(`delete-${id}`);
    try {
      const response = await fetch(apiUrl(`/api/alerts/${id}`), {
        method: 'DELETE',
        headers: authHeaders,
      });

      const contentType = (response.headers.get('content-type') || '').toLowerCase();
      let deleteError = 'Impossible de supprimer l’alerte';

      if (contentType.includes('application/json')) {
        const data = await readJsonResponse<{ error?: string; deleted?: boolean }>(response);
        if (!response.ok) throw new Error(data.error || deleteError);
      } else if (!response.ok) {
        if (response.status === 404) {
          deleteError = 'Suppression indisponible: la route DELETE des alertes n’est pas active sur le serveur. Redémarre le backend.';
        }
        throw new Error(deleteError);
      }

      const nextCount = Math.max(total - 1, 0);
      const nextPage = nextCount > 0 ? Math.min(page, Math.max(Math.ceil(nextCount / PAGE_SIZE), 1)) : 1;

      setAlerts((current) => current.filter((entry) => entry.id !== id));
      setTotal(nextCount);
      setPage(nextPage);
      await Promise.all([fetchSummary(), fetchAnalytics()]);
      if (nextPage === page) {
        await fetchAlerts();
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setActionLoadingKey(null);
    }
  }

  async function exportAlerts() {
    if (!authHeaders) return;
    const params = new URLSearchParams();
    if (level) params.set('level', level);
    if (status) params.set('status', status);
    try {
      const response = await fetch(apiUrl(`/api/alerts/export?${params.toString()}`), {
        headers: authHeaders,
      });
      if (!response.ok) {
        throw new Error(`Export impossible (${response.status})`);
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'alerts-export.csv';
      link.click();
      window.URL.revokeObjectURL(url);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    }
  }

  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1);
  const maxHourlyEvents = Math.max(...(analytics?.hourlyActivity.map((entry) => entry.events) || [1]));

  return (
    <div className="alerts-page">
      <div className="alerts-header">
        <div>
          <div className="alerts-kicker">CENTRE D'ALERTES</div>
          <h2 className="alerts-title">Incidents et activite du systeme</h2>
          <p className="alerts-subtitle">Suivi unifie des alertes, acquittement et statistiques d'activite.</p>
        </div>
        <button type="button" className="sensor-link-btn" onClick={exportAlerts}>Exporter CSV</button>
      </div>

      {summary && (
        <div className="alerts-summary-grid">
          <div className="alerts-summary-card">
            <span className="alerts-summary-label">En attente</span>
            <strong>{summary.pending_count}</strong>
          </div>
          <div className="alerts-summary-card alerts-summary-card--critical">
            <span className="alerts-summary-label">Critiques</span>
            <strong>{summary.critical_pending_count}</strong>
          </div>
          <div className="alerts-summary-card">
            <span className="alerts-summary-label">Dernieres 24 h</span>
            <strong>{summary.last_24h_count}</strong>
          </div>
        </div>
      )}

      {analytics && (
        <div className="alerts-analytics-grid">
          <section className="alerts-panel">
            <div className="alerts-panel-title">Analyse rapide</div>
            <div className="alerts-overview-grid">
              <div className="alerts-mini-stat"><span>Alertes 24 h</span><strong>{analytics.overview.totalAlerts24h}</strong></div>
              <div className="alerts-mini-stat"><span>Critiques 24 h</span><strong>{analytics.overview.criticalAlerts24h}</strong></div>
              <div className="alerts-mini-stat"><span>Noeuds offline</span><strong>{analytics.overview.offlineNodes}</strong></div>
            </div>
          </section>

          <section className="alerts-panel">
            <div className="alerts-panel-title">Cameras les plus actives</div>
            <div className="alerts-top-list">
              {analytics.topActiveCameras.length === 0 && <div className="alerts-empty-inline">Aucune activite recente.</div>}
              {analytics.topActiveCameras.map((entry) => (
                <div key={entry.device_id} className="alerts-top-item">
                  <span>{entry.name}</span>
                  <strong>{entry.motion_events}</strong>
                </div>
              ))}
            </div>
          </section>

          <section className="alerts-panel alerts-panel--wide">
            <div className="alerts-panel-title">Plages horaires les plus actives</div>
            <div className="alerts-hours-chart">
              {analytics.hourlyActivity.map((entry) => (
                <div key={entry.hour} className="alerts-hour-bar-wrap">
                  <div className={`alerts-hour-bar alerts-hour-bar--lvl-${getHourBarLevel(entry.events, maxHourlyEvents)}`} />
                  <span>{String(entry.hour).padStart(2, '0')}h</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      <div className="alerts-panel">
        <div className="alerts-panel-head">
          <div className="alerts-panel-title">Journal des alertes</div>
          <div className="alerts-filters">
            <input
              className="alerts-search"
              type="search"
              placeholder="Rechercher une alerte..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  setPage(1);
                  void fetchAlerts().catch(() => {});
                }
              }}
            />
            <AlertsFilterDropdown
              label="Filtrer par niveau"
              value={level}
              options={LEVEL_OPTIONS}
              onChange={(nextValue) => {
                setPage(1);
                setLevel(nextValue);
              }}
            />
            <AlertsFilterDropdown
              label="Filtrer par statut"
              value={status}
              options={STATUS_OPTIONS}
              onChange={(nextValue) => {
                setPage(1);
                setStatus(nextValue);
              }}
            />
            <button type="button" className="sensor-link-btn" onClick={() => { setPage(1); void fetchAlerts().catch(() => {}); }}>Filtrer</button>
          </div>
        </div>

        {loading && <div className="alerts-empty-inline">Chargement des alertes...</div>}
        {!!error && <div className="alerts-error">{error}</div>}

        {!loading && alerts.length === 0 && <div className="alerts-empty-inline">Aucune alerte a afficher.</div>}

        {!loading && alerts.length > 0 && (
          <div className="alerts-list">
            {alerts.map((entry) => (
              <article key={entry.id} className={`alerts-item alerts-item--${entry.level}`}>
                <div className="alerts-item-main">
                  <div className="alerts-item-head">
                    <div>
                      <strong>{entry.title}</strong>
                      <p>{entry.message}</p>
                    </div>
                    <div className="alerts-item-tags">
                      <span className={`alerts-pill alerts-pill--${entry.level}`}>{levelLabel(entry.level)}</span>
                      <span className="alerts-pill alerts-pill--status">{statusLabel(entry.status)}</span>
                    </div>
                  </div>
                  <div className="alerts-item-meta">
                    <span>{new Date(entry.created_at).toLocaleString('fr-FR')}</span>
                    <span>{entry.alert_type}</span>
                    {entry.source_id && <span>{entry.source_id}</span>}
                  </div>
                </div>
                <div className="alerts-item-actions">
                  {entry.status !== 'acknowledged' && (
                    <button
                      type="button"
                      className="sensor-confirm-btn"
                      onClick={() => acknowledgeAlert(entry.id)}
                      disabled={actionLoadingKey === `ack-${entry.id}` || actionLoadingKey === `delete-${entry.id}`}
                    >
                      {actionLoadingKey === `ack-${entry.id}` ? 'Confirmation...' : 'Confirmer'}
                    </button>
                  )}
                  <button
                    type="button"
                    className="sensor-delete-btn"
                    onClick={() => deleteAlert(entry.id)}
                    disabled={actionLoadingKey === `ack-${entry.id}` || actionLoadingKey === `delete-${entry.id}`}
                    title="Supprimer l’alerte"
                  >
                    {actionLoadingKey === `delete-${entry.id}` ? 'Suppression...' : 'Supprimer'}
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}

        <div className="alerts-pagination">
          <button type="button" className="sensor-link-btn" disabled={page <= 1} onClick={() => setPage((current) => Math.max(current - 1, 1))}>Precedent</button>
          <span>Page {page} / {totalPages}</span>
          <button type="button" className="sensor-link-btn" disabled={page >= totalPages} onClick={() => setPage((current) => Math.min(current + 1, totalPages))}>Suivant</button>
        </div>
      </div>
    </div>
  );
}
