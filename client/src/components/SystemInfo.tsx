import { useState, useEffect, useCallback, type ReactNode } from "react";
import { useAppConfig } from "../hooks/useAppConfig";
import { useAuth } from "../hooks/useAuth";

// ── Types ──────────────────────────────────────────────────────────────────────

interface CpuInfo {
  model: string;
  manufacturer: string;
  cores: number;
  physicalCores: number;
  speedGHz: number;
  usagePercent: number;
  temperature: number | null;
}

interface RamInfo {
  totalGB: number;
  usedGB: number;
  freeGB: number;
  usagePercent: number;
}

interface BatteryInfo {
  hasBattery: boolean;
  percent?: number;
  isCharging?: boolean;
  timeRemaining?: number | null;
  model?: string | null;
  type?: string | null;
  voltage?: number | null;
  cycleCount?: number | null;
}

interface DiskInfo {
  mount: string;
  fs: string;
  totalGB: number;
  usedGB: number;
  freeGB: number;
  usagePercent: number;
}

interface NetworkInfo {
  iface: string;
  ip4: string;
  mac: string;
  speed: number | null;
}

interface OsInfo {
  platform: string;
  distro: string;
  release: string;
  arch: string;
  hostname: string;
  uptime: number;
}

interface SystemInfoData {
  cpu: CpuInfo;
  ram: RamInfo;
  disks: DiskInfo[];
  network: NetworkInfo[];
  os: OsInfo;
  fetchedAt: string;
  battery: BatteryInfo;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}j`);
  if (h > 0) parts.push(`${h}h`);
  parts.push(`${m}min`);
  return parts.join(" ");
}

function getUsageColorClass(pct: number): string {
  if (pct >= 85) return "red";
  if (pct >= 60) return "amber";
  return "green";
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function GaugeBar({
  label,
  value,
  max,
  unit,
  pct,
  sublabel,
}: {
  label: string;
  value: string;
  max?: string;
  unit?: string;
  pct: number;
  sublabel?: string;
}) {
  const colorClass = getUsageColorClass(pct);
  return (
    <div className="si-gauge">
      <div className="si-gauge-header">
        <span className="si-gauge-label">{label}</span>
        <span className="si-gauge-value">
          {value}
          {unit && <span className="si-gauge-value-unit"> {unit}</span>}
          {max && <span className="si-gauge-value-max"> / {max}</span>}
        </span>
      </div>
      <div className="si-gauge-track">
        <div
          className={`si-gauge-fill si-gauge-fill--${colorClass}`}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
      {sublabel && <div className="si-gauge-sublabel">{sublabel}</div>}
    </div>
  );
}

function Card({
  title,
  icon,
  children,
  accent = "#60a5fa",
}: {
  title: string;
  icon: string;
  children: ReactNode;
  accent?: string;
}) {
  return (
    <div className="si-card">
      <div className="si-card-header">
        <span className="si-card-icon">{icon}</span>
        <span className="si-card-title" style={{ color: accent }}>
          {title}
        </span>
      </div>
      {children}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="si-row">
      <span className="si-row-label">{label}</span>
      <span className="si-row-value">{value}</span>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

const POLL_INTERVAL = 5000;

export default function SystemInfo() {
  const { config } = useAppConfig();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [data, setData] = useState<SystemInfoData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [pulse, setPulse] = useState(false);
  const [surveillanceActive, setSurveillanceActive] = useState(true);
  const [showPinPad, setShowPinPad] = useState(false);
  const [enteredPin, setEnteredPin] = useState("");
  const [pinError, setPinError] = useState("");

  const fetchInfo = useCallback(async () => {
    try {
      const token = localStorage.getItem("token");
      const res = await fetch("/api/system/info", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const json: SystemInfoData = await res.json();
      setData(json);
      setError(null);
      setLastUpdate(new Date());
      setPulse(true);
      setTimeout(() => setPulse(false), 600);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInfo();
    const interval = setInterval(fetchInfo, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchInfo]);

  const handleArmClick = () => {
    const savedPin = window.localStorage.getItem('sentys:kiosk_pin');
    if (savedPin) {
      setShowPinPad(true);
      setEnteredPin("");
      setPinError("");
    } else {
      setSurveillanceActive(!surveillanceActive);
    }
  };

  const handlePinPress = (digit: string) => {
    if (enteredPin.length >= 4) return;
    const nextPin = enteredPin + digit;
    setEnteredPin(nextPin);
    setPinError("");

    if (nextPin.length === 4) {
      const savedPin = window.localStorage.getItem('sentys:kiosk_pin');
      if (nextPin === savedPin) {
        setSurveillanceActive(!surveillanceActive);
        setShowPinPad(false);
      } else {
        setPinError("CODE INCORRECT");
        setTimeout(() => setEnteredPin(""), 500);
      }
    }
  };

  if (loading) {
    return (
      <div className="si-loading">
        <span className="si-loading-dot" />
        Récupération des infos système...
      </div>
    );
  }

  if (error) {
    return (
      <div className="si-error">
        <span className="si-error-icon">⚠</span>
        <div>
          <div className="si-error-title">Impossible de joindre /api/system/info</div>
          <div className="si-error-sub">{error}</div>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { cpu, ram, disks, network, os, battery } = data;

  return (
    <div className="si-wrapper">
      <div className="si-header">
        <div className="si-header-left">
          <span className={`si-pulse-dot ${pulse ? 'si-pulse-dot--active' : ''}`} />
          <span className="si-header-label">
            SYSTÈME — Actualisation toutes les 5s
          </span>
        </div>
        {lastUpdate && (
          <span className="si-header-time">
            {lastUpdate.toLocaleTimeString("fr-BE")}
          </span>
        )}
      </div>

      <div className="si-grid">
        <Card title="Mode Surveillance" icon="🛡️" accent={surveillanceActive ? 'var(--accent-green)' : 'var(--accent-red)'}>
          <div style={{ textAlign: 'center', padding: '15px 0' }}>
            <div style={{ fontSize: '20px', fontWeight: 'bold', color: surveillanceActive ? 'var(--accent-green)' : 'var(--accent-red)', marginBottom: '20px' }}>
              {surveillanceActive ? 'ARMÉ (ACTIF)' : 'DÉSARMÉ (INACTIF)'}
            </div>
            {isAdmin ? (
              <button 
                className={surveillanceActive ? "sensor-delete-btn sensor-delete-btn--danger sensor-delete-btn--xl" : "sensor-confirm-btn sensor-confirm-btn--xl"} 
                style={{ width: '100%', padding: '15px', fontSize: '16px', fontWeight: 'bold' }}
                onClick={handleArmClick}
              >
                {surveillanceActive ? "DÉSACTIVER LES ALARMES" : "ARMER LE SYSTÈME"}
              </button>
            ) : (
              <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '10px' }}>
                Action réservée aux administrateurs
              </div>
            )}
          </div>
        </Card>

        <Card title="Processeur" icon="⚙️" accent="#60a5fa">
          <InfoRow label="Modèle" value={`${cpu.manufacturer} ${cpu.model}`} />
          <InfoRow label="Cœurs" value={`${cpu.physicalCores} physiques / ${cpu.cores} logiques`} />
          <InfoRow label="Fréquence" value={`${cpu.speedGHz.toFixed(2)} GHz`} />
          {cpu.temperature !== null && (
            <InfoRow label="Température" value={`${cpu.temperature.toFixed(1)} °C`} />
          )}
          <div className="si-gauge-margin">
            <GaugeBar
              label="Utilisation CPU"
              value={`${cpu.usagePercent.toFixed(1)}%`}
              pct={cpu.usagePercent}
              sublabel={`${cpu.cores} threads actifs`}
            />
          </div>
        </Card>

        <Card title="Mémoire RAM" icon="🧠" accent="#a78bfa">
          <InfoRow label="Total" value={`${ram.totalGB.toFixed(1)} Go`} />
          <InfoRow label="Utilisée" value={`${ram.usedGB.toFixed(1)} Go`} />
          <InfoRow label="Libre" value={`${ram.freeGB.toFixed(1)} Go`} />
          <div className="si-gauge-margin">
            <GaugeBar
              label="Utilisation RAM"
              value={`${ram.usagePercent.toFixed(1)}%`}
              pct={ram.usagePercent}
              sublabel={`${ram.usedGB.toFixed(1)} Go / ${ram.totalGB.toFixed(1)} Go`}
            />
          </div>
        </Card>

        {battery.hasBattery && (() => {
          const pct = battery.percent ?? 0;
          const accentColor = pct <= 15 ? "var(--accent-red)" : pct <= 40 ? "var(--accent-amber)" : "var(--accent-green)";
          const icon = battery.isCharging ? "⚡" : pct <= 15 ? "🪫" : "🔋";
          return (
            <Card title="Batterie" icon={icon} accent={accentColor}>
              <GaugeBar
                label="Charge"
                value={`${pct.toFixed(0)}%`}
                pct={pct}
                sublabel={
                  battery.isCharging
                    ? "En charge"
                    : battery.timeRemaining
                    ? `${Math.floor(battery.timeRemaining / 60)}h${String(battery.timeRemaining % 60).padStart(2, "0")} restantes`
                    : "Sur batterie"
                }
              />
              {battery.model != null && <InfoRow label="Modèle" value={battery.model} />}
              {battery.type != null && <InfoRow label="Type" value={battery.type} />}
              {battery.voltage != null && <InfoRow label="Tension" value={`${battery.voltage.toFixed(2)} V`} />}
              {battery.cycleCount != null && <InfoRow label="Cycles" value={`${battery.cycleCount}`} />}
              <InfoRow
                label="État"
                value={battery.isCharging ? "🟢 En charge" : "🔵 Sur batterie"}
              />
            </Card>
          );
        })()}

        <Card title="Stockage" icon="💾" accent="#34d399">
          {disks.length === 0 ? (
            <span className="si-empty">Aucun disque détecté</span>
          ) : (
            disks.map((disk, i) => (
              <div key={i} className={i < disks.length - 1 ? "si-disk-block" : ""}>
                <InfoRow label="Point de montage" value={disk.mount} />
                <InfoRow label="Système de fichiers" value={disk.fs} />
                <InfoRow label="Total" value={`${disk.totalGB.toFixed(0)} Go`} />
                <div className="si-gauge-margin">
                  <GaugeBar
                    label={`Disque ${i + 1}`}
                    value={`${disk.usedGB.toFixed(1)} Go`}
                    max={`${disk.totalGB.toFixed(0)} Go`}
                    pct={disk.usagePercent}
                    sublabel={`${disk.freeGB.toFixed(1)} Go libres`}
                  />
                </div>
              </div>
            ))
          )}
        </Card>

        <Card title="Système & Réseau" icon="🖥️" accent="#fb923c">
          <InfoRow label="OS" value={`${os.distro} ${os.release}`} />
          <InfoRow label="Architecture" value={os.arch} />
          <InfoRow label="Hostname" value={os.hostname} />
          <InfoRow label="Plateforme" value={os.platform} />
          <InfoRow label="Uptime" value={formatUptime(os.uptime)} />
          {network.length > 0 && (
            <>
              <div className="si-net-header">
                Interfaces réseau
              </div>
              {network.map((iface, i) => (
                <div key={i}>
                  <InfoRow label={iface.iface} value={iface.ip4 || "—"} />
                  <InfoRow label="MAC" value={iface.mac} />
                  {iface.speed != null && <InfoRow label="Débit" value={`${iface.speed} Mbps`} />}
                </div>
              ))}
            </>
          )}
        </Card>
      </div>

      <div className="si-footer">{config.appName}{config.showSystemVersion ? ` · ${config.systemVersion}` : ''} — via Node.js systeminformation</div>

      {showPinPad && (
        <div className="settings-modal-overlay" onClick={() => setShowPinPad(false)} style={{ zIndex: 9999 }}>
          <div className="settings-modal-card" onClick={e => e.stopPropagation()} style={{ textAlign: 'center', width: '320px', fontFamily: 'monospace' }}>
            <h3 style={{ marginTop: 0, color: 'var(--accent-blue)', letterSpacing: '2px' }}>AUTORISATION REQUISE</h3>
            <div style={{ display: 'flex', justifyContent: 'center', gap: '15px', margin: '20px 0' }}>
              {[0, 1, 2, 3].map(i => <div key={i} style={{ width: '16px', height: '16px', borderRadius: '50%', background: enteredPin.length > i ? 'var(--accent-blue)' : 'transparent', border: '2px solid var(--accent-blue)', transition: 'all 0.2s' }} />)}
            </div>
            {pinError && <div style={{ color: 'var(--accent-red)', marginBottom: '15px', fontSize: '12px', fontWeight: 'bold' }}>{pinError}</div>}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => <button key={num} onClick={() => handlePinPress(num.toString())} style={{ background: 'var(--accent-blue-bg)', border: '1px solid var(--accent-blue-border)', color: 'var(--text-primary)', fontSize: '20px', padding: '15px 0', borderRadius: '6px', cursor: 'pointer' }}>{num}</button>)}
              <button onClick={() => { setEnteredPin(""); setPinError(""); }} style={{ background: 'var(--accent-red-bg)', border: '1px solid var(--accent-red-border)', color: 'var(--accent-red)', fontSize: '18px', borderRadius: '6px', cursor: 'pointer' }}>C</button>
              <button onClick={() => handlePinPress('0')} style={{ background: 'var(--accent-blue-bg)', border: '1px solid var(--accent-blue-border)', color: 'var(--text-primary)', fontSize: '20px', padding: '15px 0', borderRadius: '6px', cursor: 'pointer' }}>0</button>
              <button onClick={() => setEnteredPin(p => p.slice(0, -1))} style={{ background: 'rgba(251, 191, 36, 0.1)', border: '1px solid rgba(251, 191, 36, 0.3)', color: 'var(--accent-amber)', fontSize: '18px', borderRadius: '6px', cursor: 'pointer' }}>⌫</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
