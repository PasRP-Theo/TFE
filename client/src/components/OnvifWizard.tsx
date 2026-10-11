import { useCallback, useEffect, useState } from 'react';
import { apiUrl, apiFetch, readJsonResponse } from '../lib/api';

// Assistant d'ajout multi-marques : recherche ONVIF → identifiants → vérification → ajout.
// Le serveur trouve tout seul l'adresse du flux ; le mot de passe n'est jamais mis dans une URL.

export interface OnvifDevice {
  host: string;
  xaddr: string;
  name: string | null;
  hardware: string | null;
  alreadyAdded: boolean;
}

interface Brand { id: string; label: string }

export interface ConnectResult {
  method: 'onvif' | 'brand';
  manufacturer: string | null;
  model: string | null;
  suggestedName: string;
  streamUrl: string;
  codec: string | null;
  codecLabel: string | null;
  width: number | null;
  height: number | null;
  transcode: boolean;
  verified: boolean;
  warning: string | null;
}

interface ApiError { error?: string; code?: string; brands?: Brand[] }

type Step = 'search' | 'credentials' | 'review';

interface Props {
  onAdded: (camera: unknown) => void;
}

const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;

export function OnvifWizard({ onAdded }: Props) {
  const [step, setStep] = useState<Step>('search');
  const [devices, setDevices] = useState<OnvifDevice[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [manualHost, setManualHost] = useState('');
  const [target, setTarget] = useState<{ host: string; xaddr: string | null; label: string } | null>(null);
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [brand, setBrand] = useState('');
  const [showBrands, setShowBrands] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ConnectResult | null>(null);
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');

  const search = useCallback(async () => {
    setSearching(true);
    setError('');
    try {
      const res = await apiFetch(apiUrl('/api/cameras/onvif/discover'));
      const data = await readJsonResponse<{ devices?: OnvifDevice[]; brands?: Brand[] } & ApiError>(res);
      if (!res.ok) throw new Error(data.error || 'Recherche impossible');
      setDevices(data.devices || []);
      setBrands(data.brands || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Recherche impossible');
    } finally {
      setSearching(false);
      setSearched(true);
    }
  }, []);

  useEffect(() => { void search(); }, [search]);

  function choose(host: string, xaddr: string | null, label: string) {
    setTarget({ host, xaddr, label });
    setPassword('');
    setBrand('');
    setShowBrands(false);
    setError('');
    setStep('credentials');
  }

  async function connect() {
    if (!target) return;
    setBusy(true);
    setError('');
    try {
      const res = await apiFetch(apiUrl('/api/cameras/onvif/connect'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: target.host, xaddr: target.xaddr, username, password, brand: showBrands ? brand : null }),
      });
      const data = await readJsonResponse<ConnectResult & ApiError>(res);
      if (!res.ok) {
        if (data.code === 'needs_brand') {
          if (data.brands?.length) setBrands(data.brands);
          setShowBrands(true);
        }
        throw new Error(data.error || 'Connexion impossible');
      }
      setResult(data);
      setName(data.suggestedName);
      setLocation('');
      setStep('review');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Connexion impossible');
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    if (!result || !name.trim()) return;
    setBusy(true);
    setError('');
    try {
      const res = await apiFetch(apiUrl('/api/cameras'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          rtsp_url: result.streamUrl,
          location: location.trim(),
          username,
          password,
          transcode: result.transcode,
          video_codec: result.codec,
          manufacturer: result.manufacturer,
          model: result.model,
        }),
      });
      const data = await readJsonResponse<ApiError>(res);
      if (!res.ok) throw new Error(data.error || 'Ajout impossible');
      setPassword('');
      onAdded(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Ajout impossible');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="cam-discovery-panel" aria-label="Assistant d'ajout de caméra">
      {step === 'search' && (
        <>
          <div className="cam-discovery-header">
            <div>
              <h3 className="cam-discovery-title">Caméras trouvées sur le réseau</h3>
              <p className="cam-discovery-subtitle">Toutes marques compatibles ONVIF (Reolink, Tapo, Hikvision, Dahua…)</p>
            </div>
            <button type="button" className="ui-link-btn" onClick={() => void search()} disabled={searching}>
              {searching ? 'Recherche…' : 'Relancer la recherche'}
            </button>
          </div>

          {searching && !searched && <p>Recherche des caméras…</p>}
          {searched && !searching && devices.length === 0 && !error && (
            <p className="cam-discovery-empty">
              Aucune caméra ONVIF n'a répondu. Vérifiez que l'ONVIF est activé dans l'application de la caméra,
              ou saisissez son adresse IP ci-dessous.
            </p>
          )}
          {devices.length > 0 && (
            <ul className="cam-discovery-list">
              {devices.map(device => {
                const label = device.name || device.hardware || `Caméra ${device.host}`;
                return (
                  <li key={device.host} className="cam-discovery-item">
                    <div className="cam-discovery-item-head">
                      <strong>{label}</strong>
                      {device.hardware && device.hardware !== label && <span className="cam-discovery-source">{device.hardware}</span>}
                    </div>
                    <div className="cam-discovery-meta">{device.host}</div>
                    <div className="cam-inline-actions">
                      {device.alreadyAdded ? (
                        <span className="cam-discovery-meta">✓ Déjà ajoutée</span>
                      ) : (
                        <button type="button" className="ui-confirm-btn" onClick={() => choose(device.host, device.xaddr, label)}>
                          Connecter
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="cam-manual-panel">
            <p className="cam-discovery-subtitle">Caméra absente de la liste ? Saisissez son adresse IP :</p>
            <div className="cam-inline-actions">
              <input
                className="ui-input"
                placeholder="Ex : 192.168.0.21"
                value={manualHost}
                onChange={e => setManualHost(e.target.value.trim())}
                aria-label="Adresse IP de la caméra"
              />
              <button
                type="button"
                className="ui-confirm-btn"
                disabled={!IPV4.test(manualHost)}
                onClick={() => choose(manualHost, null, `Caméra ${manualHost}`)}
              >
                Continuer
              </button>
            </div>
          </div>
        </>
      )}

      {step === 'credentials' && target && (
        <>
          <div>
            <h3 className="cam-discovery-title">{target.label}</h3>
            <p className="cam-discovery-subtitle">
              {target.host} — identifiants de la caméra (ceux de son application, ou le « compte caméra » sur Tapo)
            </p>
          </div>
          <input className="ui-input" placeholder="Identifiant" autoComplete="off"
            value={username} onChange={e => setUsername(e.target.value)} aria-label="Identifiant de la caméra" />
          <input className="ui-input" type="password" placeholder="Mot de passe" autoComplete="new-password"
            value={password} onChange={e => setPassword(e.target.value)} aria-label="Mot de passe de la caméra" autoFocus />
          {showBrands ? (
            <select className="ui-select" value={brand} onChange={e => setBrand(e.target.value)} aria-label="Marque de la caméra">
              <option value="">Marque de la caméra…</option>
              {brands.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
            </select>
          ) : (
            <button type="button" className="ui-link-btn" onClick={() => setShowBrands(true)}>
              Ma caméra ne gère pas l'ONVIF : choisir sa marque
            </button>
          )}
          {error && <div className="ui-note"><p>{error}</p></div>}
          <div className="cam-add-actions">
            <button type="button" className="ui-link-btn" onClick={() => { setStep('search'); setError(''); }} disabled={busy}>
              Retour
            </button>
            <button type="button" className="ui-confirm-btn" onClick={() => void connect()}
              disabled={busy || !username || (showBrands && !brand)}>
              {busy ? 'Connexion…' : 'Connecter'}
            </button>
          </div>
        </>
      )}

      {step === 'review' && result && (
        <>
          <div>
            <h3 className="cam-discovery-title">✓ Caméra connectée</h3>
            <p className="cam-discovery-subtitle">
              {[result.manufacturer, result.model].filter(Boolean).join(' ') || target?.label}
              {result.width && result.height ? ` · ${result.width}×${result.height}` : ''}
              {result.codecLabel ? ` · ${result.codecLabel}` : ''}
              {result.method === 'onvif' ? ' · ONVIF' : ''}
            </p>
          </div>
          {result.warning && <div className="ui-note"><p>{result.warning}</p></div>}
          <input className="ui-input" placeholder="Nom de la caméra" value={name}
            onChange={e => setName(e.target.value)} aria-label="Nom de la caméra" />
          <input className="ui-input" placeholder="Emplacement (optionnel)" value={location}
            onChange={e => setLocation(e.target.value)} aria-label="Emplacement" />
          {error && <div className="ui-note"><p>{error}</p></div>}
          <div className="cam-add-actions">
            <button type="button" className="ui-link-btn" onClick={() => setStep('credentials')} disabled={busy}>
              Retour
            </button>
            <button type="button" className="ui-confirm-btn" onClick={() => void add()} disabled={busy || !name.trim()}>
              {busy ? 'Ajout…' : 'Ajouter la caméra'}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
