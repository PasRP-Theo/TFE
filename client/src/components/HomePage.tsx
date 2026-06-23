import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../hooks/useAuth';
import { apiUrl } from '../lib/api';

interface ShoppingItem {
  id: number;
  text: string;
  checked: boolean;
  position: number;
  created_at: string;
}

interface WeatherDay {
  date: string;
  label: string;
  icon: string;
  tempMax: number;
  tempMin: number;
  precipitation: number;
  windMax: number;
}

interface WeatherData {
  current: {
    temperature: number;
    apparentTemperature: number;
    humidity: number;
    windSpeed: number;
    label: string;
    icon: string;
    time: string;
  };
  daily: WeatherDay[];
  source: string;
  cachedAt: string;
  stale?: boolean;
}

interface HomeNote {
  id: number;
  text: string;
  created_at: string;
}

type Tab = 'courses' | 'meteo' | 'autres';

export default function HomePage() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };

  const [items, setItems] = useState<ShoppingItem[]>([]);
  const [newItem, setNewItem] = useState('');
  const [itemsLoading, setItemsLoading] = useState(true);

  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(true);
  const [weatherError, setWeatherError] = useState<string | null>(null);

  const [notes, setNotes] = useState<HomeNote[]>([]);
  const [newNote, setNewNote] = useState('');
  const [notesLoading, setNotesLoading] = useState(true);

  const [activeTab, setActiveTab] = useState<Tab>('courses');

  const itemInputRef = useRef<HTMLInputElement>(null);

  const loadItems = useCallback(async () => {
    try {
      const res = await fetch(apiUrl('/api/home/shopping'), { headers });
      if (res.ok) setItems(await res.json());
    } catch { /* ignore */ }
    finally { setItemsLoading(false); }
  }, [token]);

  const loadWeather = useCallback(async () => {
    setWeatherLoading(true);
    setWeatherError(null);
    try {
      const res = await fetch(apiUrl('/api/home/weather'), { headers });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Erreur météo');
      setWeather(data);
    } catch (err: unknown) {
      setWeatherError(err instanceof Error ? err.message : 'Erreur météo');
    } finally {
      setWeatherLoading(false);
    }
  }, [token]);

  const loadNotes = useCallback(async () => {
    try {
      const res = await fetch(apiUrl('/api/home/notes'), { headers });
      if (res.ok) setNotes(await res.json());
    } catch { /* ignore */ }
    finally { setNotesLoading(false); }
  }, [token]);

  useEffect(() => {
    loadItems();
    loadWeather();
    loadNotes();
  }, [loadItems, loadWeather, loadNotes]);

  const addItem = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = newItem.trim();
    if (!text) return;
    try {
      const res = await fetch(apiUrl('/api/home/shopping'), {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (res.ok) {
        const item = await res.json();
        setItems(prev => [...prev, item]);
        setNewItem('');
        itemInputRef.current?.focus();
      }
    } catch { /* ignore */ }
  };

  const toggleItem = async (id: number, checked: boolean) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, checked } : i));
    try {
      await fetch(apiUrl(`/api/home/shopping/${id}`), {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ checked }),
      });
    } catch {
      setItems(prev => prev.map(i => i.id === id ? { ...i, checked: !checked } : i));
    }
  };

  const deleteItem = async (id: number) => {
    setItems(prev => prev.filter(i => i.id !== id));
    try {
      await fetch(apiUrl(`/api/home/shopping/${id}`), { method: 'DELETE', headers });
    } catch { loadItems(); }
  };

  const clearChecked = async () => {
    setItems(prev => prev.filter(i => !i.checked));
    try {
      await fetch(apiUrl('/api/home/shopping/checked'), { method: 'DELETE', headers });
    } catch { loadItems(); }
  };

  const addNote = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = newNote.trim();
    if (!text) return;
    try {
      const res = await fetch(apiUrl('/api/home/notes'), {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (res.ok) {
        const note = await res.json();
        setNotes(prev => [note, ...prev]);
        setNewNote('');
      }
    } catch { /* ignore */ }
  };

  const deleteNote = async (id: number) => {
    setNotes(prev => prev.filter(n => n.id !== id));
    try {
      await fetch(apiUrl(`/api/home/notes/${id}`), { method: 'DELETE', headers });
    } catch { loadNotes(); }
  };

  const unchecked = items.filter(i => !i.checked);
  const checked   = items.filter(i =>  i.checked);

  const fmtDay = (dateStr: string) =>
    new Date(dateStr).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });

  const fmtNoteDate = (dateStr: string) =>
    new Date(dateStr).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  return (
    <div className="hp-wrapper">
      {/* ── Onglets mobiles ──────────────────────────────────── */}
      <div className="hp-tabs">
        <button className={`hp-tab ${activeTab === 'courses' ? 'hp-tab--active' : ''}`} onClick={() => setActiveTab('courses')}>
          🛒 Courses {unchecked.length > 0 && <span className="hp-tab-badge">{unchecked.length}</span>}
        </button>
        <button className={`hp-tab ${activeTab === 'meteo' ? 'hp-tab--active' : ''}`} onClick={() => setActiveTab('meteo')}>
          🌤️ Météo
        </button>
        <button className={`hp-tab ${activeTab === 'autres' ? 'hp-tab--active' : ''}`} onClick={() => setActiveTab('autres')}>
          📌 Notes {notes.length > 0 && <span className="hp-tab-badge">{notes.length}</span>}
        </button>
      </div>

      <div className="hp-grid">

        {/* ── COURSES ──────────────────────────────────────────── */}
        <section className={`hp-panel ${activeTab === 'courses' ? 'hp-panel--active' : ''}`} aria-label="Liste de courses">
          <div className="hp-panel-header">
            <h2 className="hp-panel-title">🛒 Liste de courses</h2>
            {unchecked.length > 0 && <span className="hp-panel-count">{unchecked.length} article{unchecked.length > 1 ? 's' : ''}</span>}
          </div>

          <form className="hp-add-form" onSubmit={addItem}>
            <input
              ref={itemInputRef}
              className="hp-input"
              type="text"
              placeholder="Ajouter un article…"
              value={newItem}
              onChange={e => setNewItem(e.target.value)}
              maxLength={200}
              autoComplete="off"
            />
            <button className="hp-btn-add" type="submit" disabled={!newItem.trim()} aria-label="Ajouter">+</button>
          </form>

          {itemsLoading ? (
            <p className="hp-state-msg">Chargement…</p>
          ) : (
            <>
              {unchecked.length === 0 && checked.length === 0 && (
                <p className="hp-state-msg hp-state-msg--empty">Liste vide — ajoutez un article ci-dessus.</p>
              )}

              <ul className="hp-list">
                {unchecked.map(item => (
                  <li key={item.id} className="hp-item">
                    <button className="hp-check" onClick={() => toggleItem(item.id, true)} aria-label="Cocher">
                      <span className="hp-check-box" />
                    </button>
                    <span className="hp-item-text">{item.text}</span>
                    <button className="hp-item-del" onClick={() => deleteItem(item.id)} aria-label="Supprimer">×</button>
                  </li>
                ))}
              </ul>

              {checked.length > 0 && (
                <div className="hp-checked-section">
                  <div className="hp-checked-bar">
                    <span className="hp-checked-label">Dans le panier ({checked.length})</span>
                    <button className="hp-ghost-btn" onClick={clearChecked}>Vider</button>
                  </div>
                  <ul className="hp-list hp-list--done">
                    {checked.map(item => (
                      <li key={item.id} className="hp-item hp-item--done">
                        <button className="hp-check hp-check--done" onClick={() => toggleItem(item.id, false)} aria-label="Décocher">
                          <span className="hp-check-box hp-check-box--done">✓</span>
                        </button>
                        <span className="hp-item-text">{item.text}</span>
                        <button className="hp-item-del" onClick={() => deleteItem(item.id)} aria-label="Supprimer">×</button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </section>

        {/* ── MÉTÉO ─────────────────────────────────────────────── */}
        <section className={`hp-panel ${activeTab === 'meteo' ? 'hp-panel--active' : ''}`} aria-label="Météo locale">
          <div className="hp-panel-header">
            <h2 className="hp-panel-title">🌤️ Météo locale</h2>
            <button className="hp-ghost-btn" onClick={loadWeather} title="Actualiser">↺</button>
          </div>

          {weatherLoading ? (
            <p className="hp-state-msg">Chargement de la météo…</p>
          ) : weatherError ? (
            <div className="hp-error-block">
              <span>{weatherError}</span>
              <button className="hp-ghost-btn" onClick={loadWeather}>Réessayer</button>
            </div>
          ) : weather ? (
            <>
              <div className="hp-weather-now">
                <span className="hp-weather-emoji">{weather.current.icon}</span>
                <div className="hp-weather-temp-block">
                  <span className="hp-weather-temp">{Math.round(weather.current.temperature)}°C</span>
                  <span className="hp-weather-feels">Ressenti {Math.round(weather.current.apparentTemperature)}°C</span>
                </div>
                <div className="hp-weather-details">
                  <span className="hp-weather-label-text">{weather.current.label}</span>
                  <div className="hp-weather-pills">
                    <span className="hp-weather-pill">💧 {weather.current.humidity}%</span>
                    <span className="hp-weather-pill">💨 {Math.round(weather.current.windSpeed)} km/h</span>
                  </div>
                </div>
              </div>

              <div className="hp-forecast">
                {weather.daily.map((day, i) => (
                  <div key={day.date} className={`hp-fc-day ${i === 0 ? 'hp-fc-day--today' : ''}`}>
                    <span className="hp-fc-date">{i === 0 ? 'Auj.' : fmtDay(day.date)}</span>
                    <span className="hp-fc-icon">{day.icon}</span>
                    <div className="hp-fc-temps">
                      <span className="hp-fc-max">{Math.round(day.tempMax)}°</span>
                      <span className="hp-fc-min">{Math.round(day.tempMin)}°</span>
                    </div>
                    {day.precipitation > 0.1 && (
                      <span className="hp-fc-rain">💧{day.precipitation.toFixed(1)}</span>
                    )}
                  </div>
                ))}
              </div>

              <p className="hp-weather-source">
                {weather.source}
                {weather.stale && <span className="hp-weather-stale"> · Données en cache</span>}
              </p>
            </>
          ) : null}
        </section>

        {/* ── NOTES ─────────────────────────────────────────────── */}
        <section className={`hp-panel ${activeTab === 'autres' ? 'hp-panel--active' : ''}`} aria-label="Notes et rappels">
          <div className="hp-panel-header">
            <h2 className="hp-panel-title">📌 Notes & rappels</h2>
            {notes.length > 0 && <span className="hp-panel-count">{notes.length}</span>}
          </div>

          <form className="hp-add-form" onSubmit={addNote}>
            <input
              className="hp-input"
              type="text"
              placeholder="Ajouter une note…"
              value={newNote}
              onChange={e => setNewNote(e.target.value)}
              maxLength={500}
              autoComplete="off"
            />
            <button className="hp-btn-add" type="submit" disabled={!newNote.trim()} aria-label="Ajouter">+</button>
          </form>

          {notesLoading ? (
            <p className="hp-state-msg">Chargement…</p>
          ) : (
            <>
              {notes.length === 0 && (
                <p className="hp-state-msg hp-state-msg--empty">Aucune note — ajoutez-en une ci-dessus.</p>
              )}
              <ul className="hp-list">
                {notes.map(note => (
                  <li key={note.id} className="hp-note">
                    <div className="hp-note-body">
                      <span className="hp-note-text">{note.text}</span>
                      <span className="hp-note-date">{fmtNoteDate(note.created_at)}</span>
                    </div>
                    <button className="hp-item-del" onClick={() => deleteNote(note.id)} aria-label="Supprimer">×</button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

      </div>
    </div>
  );
}
