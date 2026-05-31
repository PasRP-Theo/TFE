import { useState, useEffect, useCallback, type ReactNode } from "react";
import { useAppConfig } from "../hooks/useAppConfig";
import { useAuth } from "../hooks/useAuth";

// types

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

// helpers

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

// sous-composants

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

// composant principal

const POLL_INTERVAL = 5000;

export default function SystemInfo() {
  const { config, updateConfig } = useAppConfig();
  const { user, token } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [data, setData] = useState<SystemInfoData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [pulse, setPulse] = useState(false);
  const [showPinPad, setShowPinPad] = useState(false);
  const [enteredPin, setEnteredPin] = useState("");
  const [pinError, setPinError] = useState("");

  const surveillanceActive = config.surveillanceMode;

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
    setShowPinPad(true);
    setEnteredPin("");
    setPinError("");
  };

  const handlePinPress = async (digit: string) => {
    if (enteredPin.length >= 4) return;
    const nextPin = enteredPin + digit;
    setEnteredPin(nextPin);
    setPinError("");

    if (nextPin.length === 4) {
      const savedPin = config.kioskPin || '1234';
      if (nextPin === savedPin) {
        try {
          if (token && updateConfig) {
            await updateConfig(token, { surveillanceMode: !surveillanceActive });
          }
          setShowPinPad(false);
        } catch {
          setPinError("ERREUR SYSTÈME");
          setTimeout(() => setEnteredPin(""), 1000);
        }
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
          <div className="si-arm-body">
            <div className="si-arm-status">
              <div className={`si-arm-badge ${surveillanceActive ? 'si-arm-badge--active' : 'si-arm-badge--inactive'}`}>
                <span className={`si-arm-dot ${surveillanceActive ? 'si-arm-dot--active' : 'si-arm-dot--inactive'}`} />
                {surveillanceActive ? 'ARMÉ' : 'DÉSARMÉ'}
              </div>
              <span className="si-arm-cameras-label">
                {surveillanceActive ? 'Caméras actives' : 'Caméras hors ligne'}
              </span>
            </div>
            <div className="si-arm-desc">
              {surveillanceActive
                ? 'Toutes les caméras sont actives. La surveillance est opérationnelle.'
                : 'Surveillance désactivée. Toutes les caméras ont été mises hors ligne.'}
            </div>
            {isAdmin ? (
              <button
                type="button"
                className={`si-arm-btn ${surveillanceActive ? 'si-arm-btn--disarm' : 'si-arm-btn--arm'}`}
                onClick={handleArmClick}
              >
                {surveillanceActive ? '⏹ DÉSACTIVER LA SURVEILLANCE' : '▶ ACTIVER LA SURVEILLANCE'}
              </button>
            ) : (
              <div className="si-arm-admin-note">Action réservée aux administrateurs</div>
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

      <div className="si-footer">{config.appName}{config.showSystemVersion ? ` · ${config.systemVersion}` : ''} — Propulsé par SENTYS Surveillance</div>

      {showPinPad && (
        <div className="si-pin-overlay" onClick={() => setShowPinPad(false)}>
          <div className="si-pin-card" onClick={e => e.stopPropagation()}>
            <h3 className="si-pin-title">AUTORISATION REQUISE</h3>
            <div className="si-pin-dots">
              {[0, 1, 2, 3].map(i => (
                <div key={i} className={`si-pin-dot ${enteredPin.length > i ? 'si-pin-dot--filled' : ''}`} />
              ))}
            </div>
            {pinError && <div className="si-pin-error">{pinError}</div>}
            <div className="si-pin-grid">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => (
                <button type="button" key={num} className="si-pin-key si-pin-key--blue" onClick={() => handlePinPress(num.toString())}>{num}</button>
              ))}
              <button type="button" className="si-pin-key si-pin-key--red" onClick={() => { setEnteredPin(""); setPinError(""); }}>C</button>
              <button type="button" className="si-pin-key si-pin-key--blue" onClick={() => handlePinPress('0')}>0</button>
              <button type="button" className="si-pin-key si-pin-key--amber" onClick={() => setEnteredPin(p => p.slice(0, -1))}>⌫</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
