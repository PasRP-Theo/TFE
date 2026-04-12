import { useState, useEffect, useCallback, type ReactNode } from "react";
import { useAppConfig } from "../hooks/useAppConfig";

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

function usageColor(pct: number): string {
  if (pct >= 85) return "#ef4444";
  if (pct >= 60) return "#f59e0b";
  return "#22c55e";
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
  const color = usageColor(pct);
  return (
    <div className="sysinfo-gauge-wrap">
      <div className="sysinfo-gauge-head">
        <span className="sysinfo-gauge-label">{label}</span>
        <span className="sysinfo-gauge-value">
          {value}
          {unit && <span> {unit}</span>}
          {max && <span> / {max}</span>}
        </span>
      </div>
      <div className="sysinfo-gauge-track">
        <div
          className="sysinfo-gauge-fill"
          style={{
            width: `${Math.min(pct, 100)}%`,
            background: color,
            boxShadow: `0 0 6px ${color}55`,
          }}
        />
      </div>
      {sublabel && <div className="sysinfo-gauge-sub">{sublabel}</div>}
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
    <div className="sysinfo-card-inline">
      <div className="sysinfo-card-header-inline">
        <span className="sysinfo-card-icon-inline">{icon}</span>
        <span className="sysinfo-card-title-inline" style={{ color: accent }}>
          {title}
        </span>
      </div>
      {children}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="sysinfo-row-inline">
      <span className="sysinfo-row-label-inline">{label}</span>
      <span className="sysinfo-row-value-inline">{value}</span>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

const POLL_INTERVAL = 5000;

export default function SystemInfo() {
  const { config } = useAppConfig();
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
      <div className="sysinfo-loading">
        <span className="sysinfo-loading-dot" />
        Récupération des infos système...
      </div>
    );
  }

  if (error) {
    return (
      <div className="sysinfo-error">
        <span>⚠</span>
        <div className="sysinfo-error-detail">Impossible de joindre /api/system/info</div>
        <div className="sysinfo-error-sub">{error}</div>
      </div>
    );
  }

  if (!data) return null;

  const { cpu, ram, disks, network, os, battery } = data;

  return (
    <div className="sysinfo-main">
      <div className="sysinfo-header">
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span
            style={{
              display: "inline-block",
              width: "7px",
              height: "7px",
              borderRadius: "50%",
              background: pulse ? "#60a5fa" : "#22c55e",
              boxShadow: pulse ? "0 0 8px #60a5fa" : "0 0 6px #22c55e88",
              transition: "background 0.2s, box-shadow 0.2s",
            }}
          />
          <span
            style={{
              fontSize: "11px",
              fontFamily: "monospace",
              color: "#4b5563",
              letterSpacing: "0.06em",
            }}
          >
            SYSTÈME — Actualisation toutes les 5s
          </span>
        </div>
        {lastUpdate && (
          <span className="sysinfo-header-time">
            {lastUpdate.toLocaleTimeString("fr-BE")}
          </span>
        )}
      </div>

      <div className="sysinfo-grid">
        <Card title="Mode Surveillance" icon="🛡️" accent={surveillanceActive ? "#22c55e" : "#ef4444"}>
          <div style={{ textAlign: 'center', padding: '15px 0' }}>
            <div style={{ fontSize: '20px', fontWeight: 'bold', color: surveillanceActive ? '#22c55e' : '#ef4444', marginBottom: '20px' }}>
              {surveillanceActive ? 'ARMÉ (ACTIF)' : 'DÉSARMÉ (INACTIF)'}
            </div>
            <button 
              className={surveillanceActive ? "sensor-delete-btn sensor-delete-btn--danger sensor-delete-btn--xl" : "sensor-confirm-btn sensor-confirm-btn--xl"} 
              style={{ width: '100%', padding: '15px', fontSize: '16px', fontWeight: 'bold' }}
              onClick={handleArmClick}
            >
              {surveillanceActive ? "DÉSACTIVER LES ALARMES" : "ARMER LE SYSTÈME"}
            </button>
          </div>
        </Card>

        <Card title="Processeur" icon="⚙️" accent="#60a5fa">
          <InfoRow label="Modèle" value={`${cpu.manufacturer} ${cpu.model}`} />
          <InfoRow label="Cœurs" value={`${cpu.physicalCores} physiques / ${cpu.cores} logiques`} />
          <InfoRow label="Fréquence" value={`${cpu.speedGHz.toFixed(2)} GHz`} />
          {cpu.temperature !== null && (
            <InfoRow label="Température" value={`${cpu.temperature.toFixed(1)} °C`} />
          )}
          <div style={{ marginTop: "6px" }}>
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
          <div style={{ marginTop: "6px" }}>
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
          const color = pct <= 15 ? "#ef4444" : pct <= 40 ? "#f59e0b" : "#22c55e";
          const icon = battery.isCharging ? "⚡" : pct <= 15 ? "🪫" : "🔋";
          return (
            <Card title="Batterie" icon={icon} accent={color}>
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
            <span style={{ fontSize: "12px", color: "#4b5563" }}>
              Aucun disque détecté
            </span>
          ) : (
            disks.map((disk, i) => (
              <div key={i} style={{ marginBottom: i < disks.length - 1 ? "14px" : 0 }}>
                <InfoRow label="Point de montage" value={disk.mount} />
                <InfoRow label="Système de fichiers" value={disk.fs} />
                <InfoRow label="Total" value={`${disk.totalGB.toFixed(0)} Go`} />
                <div style={{ marginTop: "6px" }}>
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
              <div
                style={{
                  fontSize: "10px",
                  color: "#4b5563",
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  marginTop: "8px",
                  paddingTop: "8px",
                  borderTop: "1px solid #1e2a3a",
                }}
              >
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

      <div className="sysinfo-footer">{config.appName}{config.showSystemVersion ? ` · ${config.systemVersion}` : ''} — via Node.js systeminformation</div>

      {showPinPad && (
        <div className="settings-modal-overlay" onClick={() => setShowPinPad(false)} style={{ zIndex: 9999 }}>
          <div className="settings-modal-card" onClick={e => e.stopPropagation()} style={{ textAlign: 'center', width: '320px' }}>
            <h3 style={{ marginTop: 0, color: '#6cc7ff', letterSpacing: '2px' }}>AUTORISATION REQUISE</h3>
            <div style={{ display: 'flex', justifyContent: 'center', gap: '15px', margin: '20px 0' }}>
              {[0, 1, 2, 3].map(i => <div key={i} style={{ width: '16px', height: '16px', borderRadius: '50%', background: enteredPin.length > i ? '#6cc7ff' : 'transparent', border: '2px solid #6cc7ff', transition: 'all 0.2s' }} />)}
            </div>
            {pinError && <div style={{ color: '#ef4444', marginBottom: '15px', fontSize: '12px', fontWeight: 'bold' }}>{pinError}</div>}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => <button key={num} onClick={() => handlePinPress(num.toString())} style={{ background: 'rgba(108, 199, 255, 0.1)', border: '1px solid rgba(108, 199, 255, 0.3)', color: '#fff', fontSize: '20px', padding: '15px 0', borderRadius: '6px', cursor: 'pointer' }}>{num}</button>)}
              <button onClick={() => { setEnteredPin(""); setPinError(""); }} style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', color: '#ef4444', fontSize: '18px', borderRadius: '6px', cursor: 'pointer' }}>C</button>
              <button onClick={() => handlePinPress('0')} style={{ background: 'rgba(108, 199, 255, 0.1)', border: '1px solid rgba(108, 199, 255, 0.3)', color: '#fff', fontSize: '20px', padding: '15px 0', borderRadius: '6px', cursor: 'pointer' }}>0</button>
              <button onClick={() => setEnteredPin(p => p.slice(0, -1))} style={{ background: 'rgba(251, 191, 36, 0.1)', border: '1px solid rgba(251, 191, 36, 0.3)', color: '#f59e0b', fontSize: '18px', borderRadius: '6px', cursor: 'pointer' }}>⌫</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
