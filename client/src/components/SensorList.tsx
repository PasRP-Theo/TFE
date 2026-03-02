import { useState, useEffect } from "react";

interface Sensor {
  id: number;
  name: string;
  type: string;
  status: "OK" | "ALERTE" | "INACTIF";
  value: string;
  unit: string;
  alertAt?: number;
}

interface AlertEntry {
  id: number;
  sensorName: string;
  value: string;
  time: Date;
}

const SENSOR_TYPES = ["Température", "Humidité", "Mouvement", "Fumée", "CO2", "Pression"];

const INITIAL_SENSORS: Sensor[] = [
  { id: 1, name: "Salon",         type: "Température", status: "OK",     value: "21.4", unit: "°C",  alertAt: 30 },
  { id: 2, name: "Cuisine",       type: "Fumée",       status: "OK",     value: "0",    unit: "ppm", alertAt: 50 },
  { id: 3, name: "Cave",          type: "Humidité",    status: "ALERTE", value: "87.2", unit: "%",   alertAt: 80 },
  { id: 4, name: "Garage",        type: "CO2",         status: "OK",     value: "412",  unit: "ppm", alertAt: 1000 },
  { id: 5, name: "Entrée",        type: "Mouvement",   status: "INACTIF",value: "—",    unit: "",    alertAt: undefined },
];

function StatusBadge({ status }: { status: Sensor["status"] }) {
  const cls = status === "ALERTE" ? "sensor-badge--alert"
    : status === "INACTIF" ? "sensor-badge--inactive"
    : "sensor-badge--ok";
  return (
    <span className={`sensor-badge ${cls}`}>
      <span className="sensor-badge-dot" />
      {status}
    </span>
  );
}

let nextId = 10;

export default function SensorList() {
  const [sensors, setSensors] = useState<Sensor[]>(INITIAL_SENSORS);
  const [alerts, setAlerts] = useState<AlertEntry[]>([]);
  const [tab, setTab] = useState<"list" | "history">("list");
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState(SENSOR_TYPES[0]);
  const [editId, setEditId] = useState<number | null>(null);

  // Simulation : mise à jour des valeurs toutes les 3s
  useEffect(() => {
    const interval = setInterval(() => {
      setSensors(prev => prev.map(s => {
        if (s.type === "Mouvement" || s.status === "INACTIF") return s;

        let raw = parseFloat(s.value);
        if (isNaN(raw)) raw = 0;

        const delta = (Math.random() - 0.48) * 2;
        const newRaw = Math.max(0, raw + delta);
        const newValue = newRaw.toFixed(1);

        let newStatus: Sensor["status"] = "OK";
        if (s.alertAt !== undefined && newRaw >= s.alertAt) {
          newStatus = "ALERTE";
          setAlerts(prev => [
            { id: Date.now(), sensorName: s.name, value: `${newValue} ${s.unit}`, time: new Date() },
            ...prev.slice(0, 49),
          ]);
        }

        return { ...s, value: newValue, status: newStatus };
      }));
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  function addSensor() {
    if (!newName.trim()) return;
    setSensors(prev => [...prev, {
      id: nextId++,
      name: newName.trim(),
      type: newType,
      status: "OK",
      value: "0.0",
      unit: newType === "Température" ? "°C" : newType === "Humidité" ? "%" : "ppm",
      alertAt: newType === "Température" ? 30 : newType === "Humidité" ? 80 : 1000,
    }]);
    setNewName("");
    setShowAdd(false);
  }

  function removeSensor(id: number) {
    setSensors(prev => prev.filter(s => s.id !== id));
  }

  function toggleStatus(id: number) {
    setSensors(prev => prev.map(s => {
      if (s.id !== id) return s;
      const next: Sensor["status"] = s.status === "OK" ? "ALERTE" : s.status === "ALERTE" ? "INACTIF" : "OK";
      return { ...s, status: next };
    }));
  }

  const alertCount = sensors.filter(s => s.status === "ALERTE").length;

  return (
    <div className="sensor-wrapper">

      {/* Header */}
      <div className="sensor-header">
        <div className="sensor-header-left">
          <span className="sensor-title">CAPTEURS</span>
          {alertCount > 0 && (
            <span className="sensor-alert-badge">{alertCount} ALERTE{alertCount > 1 ? "S" : ""}</span>
          )}
        </div>
        <div className="sensor-header-right">
          <button
            className={`sensor-tab-btn ${tab === "list" ? "active" : ""}`}
            onClick={() => setTab("list")}
          >LISTE</button>
          <button
            className={`sensor-tab-btn ${tab === "history" ? "active" : ""}`}
            onClick={() => setTab("history")}
          >HISTORIQUE {alerts.length > 0 && `(${alerts.length})`}</button>
          <button className="sensor-add-btn" onClick={() => setShowAdd(v => !v)}>
            {showAdd ? "✕" : "+ Ajouter"}
          </button>
        </div>
      </div>

      {/* Formulaire d'ajout */}
      {showAdd && (
        <div className="sensor-add-form">
          <input
            className="sensor-input"
            placeholder="Nom du capteur"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === "Enter" && addSensor()}
          />
          <select
            className="sensor-input sensor-select"
            value={newType}
            onChange={e => setNewType(e.target.value)}
          >
            {SENSOR_TYPES.map(t => <option key={t}>{t}</option>)}
          </select>
          <button className="sensor-confirm-btn" onClick={addSensor}>Confirmer</button>
        </div>
      )}

      {/* Liste */}
      {tab === "list" && (
        <table className="sensor-table">
          <thead>
            <tr>
              <th className="sensor-th">NOM</th>
              <th className="sensor-th">TYPE</th>
              <th className="sensor-th">STATUT</th>
              <th className="sensor-th sensor-th--right">VALEUR</th>
              <th className="sensor-th sensor-th--right">ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {sensors.map((sensor, i) => (
              <tr key={sensor.id} className={i % 2 === 0 ? "sensor-tr--odd" : "sensor-tr--even"}>
                <td className="sensor-td"><span className="sensor-name">{sensor.name}</span></td>
                <td className="sensor-td"><span className="sensor-type">{sensor.type}</span></td>
                <td className="sensor-td">
                  <button className="sensor-status-btn" onClick={() => toggleStatus(sensor.id)} title="Changer le statut">
                    <StatusBadge status={sensor.status} />
                  </button>
                </td>
                <td className="sensor-td sensor-td--right">
                  <span className="sensor-value">{sensor.value} <span className="sensor-unit">{sensor.unit}</span></span>
                </td>
                <td className="sensor-td sensor-td--right">
                  <button className="sensor-delete-btn" onClick={() => removeSensor(sensor.id)} title="Supprimer">✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Historique alertes */}
      {tab === "history" && (
        <div className="sensor-history">
          {alerts.length === 0 ? (
            <p className="sensor-history-empty">Aucune alerte enregistrée.</p>
          ) : (
            <>
              <div className="sensor-history-toolbar">
                <span className="sensor-history-count">{alerts.length} événement{alerts.length > 1 ? "s" : ""}</span>
                <button className="sensor-delete-btn" onClick={() => setAlerts([])}>Effacer tout</button>
              </div>
              {alerts.map(a => (
                <div key={a.id} className="sensor-history-row">
                  <span className="sensor-badge sensor-badge--alert" style={{ flexShrink: 0 }}>
                    <span className="sensor-badge-dot" />ALERTE
                  </span>
                  <span className="sensor-history-name">{a.sensorName}</span>
                  <span className="sensor-history-val">{a.value}</span>
                  <span className="sensor-history-time">
                    {a.time.toLocaleTimeString("fr-FR")}
                  </span>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}