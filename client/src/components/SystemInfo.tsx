import { useState, useEffect, useCallback } from "react";

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
  uptime: number; // seconds
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
    <div style={{ marginBottom: "10px" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: "4px",
        }}
      >
        <span style={{ fontSize: "11px", color: "#9ca3af", letterSpacing: "0.06em", textTransform: "uppercase" }}>
          {label}
        </span>
        <span style={{ fontSize: "13px", fontFamily: "monospace", color: "#e2e8f0" }}>
          {value}
          {unit && <span style={{ color: "#6b7280", fontSize: "11px" }}> {unit}</span>}
          {max && <span style={{ color: "#4b5563" }}> / {max}</span>}
        </span>
      </div>
      <div
        style={{
          height: "4px",
          background: "#1e2a3a",
          borderRadius: "2px",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${Math.min(pct, 100)}%`,
            background: color,
            borderRadius: "2px",
            transition: "width 0.6s ease, background 0.3s ease",
            boxShadow: `0 0 6px ${color}55`,
          }}
        />
      </div>
      {sublabel && (
        <div style={{ fontSize: "10px", color: "#4b5563", marginTop: "3px" }}>
          {sublabel}
        </div>
      )}
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
  children: React.ReactNode;
  accent?: string;
}) {
  return (
    <div
      style={{
        background: "#0d1117",
        border: "1px solid #1e2a3a",
        borderRadius: "6px",
        padding: "16px",
        display: "flex",
        flexDirection: "column",
        gap: "12px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          paddingBottom: "10px",
          borderBottom: "1px solid #1e2a3a",
        }}
      >
        <span style={{ fontSize: "16px" }}>{icon}</span>
        <span
          style={{
            fontSize: "11px",
            fontFamily: "monospace",
            color: accent,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            fontWeight: 700,
          }}
        >
          {title}
        </span>
      </div>
      {children}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "3px 0",
        borderBottom: "1px solid #111827",
      }}
    >
      <span style={{ fontSize: "11px", color: "#6b7280", letterSpacing: "0.04em" }}>
        {label}
      </span>
      <span
        style={{
          fontSize: "12px",
          fontFamily: "monospace",
          color: "#e2e8f0",
          textAlign: "right",
          maxWidth: "60%",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </span>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

const POLL_INTERVAL = 5000; // 5 secondes

export default function SystemInfo() {
  const [data, setData] = useState<SystemInfoData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [pulse, setPulse] = useState(false);

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

      // Pulse animation on update
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

  // ── Loading ──────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "200px",
          color: "#4b5563",
          fontFamily: "monospace",
          fontSize: "13px",
          gap: "10px",
        }}
      >
        <span
          style={{
            display: "inline-block",
            width: "8px",
            height: "8px",
            borderRadius: "50%",
            background: "#60a5fa",
            animation: "pulse-dot 1s infinite",
          }}
        />
        Récupération des infos système...
        <style>{`@keyframes pulse-dot { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.3;transform:scale(.7)} }`}</style>
      </div>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────────────

  if (error) {
    return (
      <div
        style={{
          background: "#0d1117",
          border: "1px solid #ef444444",
          borderRadius: "6px",
          padding: "16px",
          color: "#ef4444",
          fontFamily: "monospace",
          fontSize: "13px",
          display: "flex",
          alignItems: "center",
          gap: "10px",
        }}
      >
        <span>⚠</span>
        <div>
          <div style={{ fontWeight: 700, marginBottom: "4px" }}>
            Impossible de joindre /api/system/info
          </div>
          <div style={{ color: "#6b7280", fontSize: "11px" }}>{error}</div>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { cpu, ram, disks, network, os } = data;

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        fontFamily: "'Segoe UI', sans-serif",
        color: "#9ca3af",
        display: "flex",
        flexDirection: "column",
        gap: "12px",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "0 2px",
        }}
      >
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
          <span style={{ fontSize: "10px", fontFamily: "monospace", color: "#374151" }}>
            {lastUpdate.toLocaleTimeString("fr-BE")}
          </span>
        )}
      </div>

      {/* Grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: "12px",
        }}
      >
        {/* CPU */}
        <Card title="Processeur" icon="⚙️" accent="#60a5fa">
          <InfoRow label="Modèle" value={`${cpu.manufacturer} ${cpu.model}`} />
          <InfoRow label="Cœurs" value={`${cpu.physicalCores} physiques / ${cpu.cores} logiques`} />
          <InfoRow label="Fréquence" value={`${cpu.speedGHz.toFixed(2)} GHz`} />
          {cpu.temperature !== null && (
            <InfoRow
              label="Température"
              value={`${cpu.temperature.toFixed(1)} °C`}
            />
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

        {/* RAM */}
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

        {/* Batterie */}
        {data.battery.hasBattery && (() => {
        const b = data.battery;
        const pct = b.percent ?? 0;
        const color = pct <= 15 ? "#ef4444" : pct <= 40 ? "#f59e0b" : "#22c55e";
        const icon = b.isCharging ? "⚡" : pct <= 15 ? "🪫" : "🔋";
        return (
            <Card title="Batterie" icon={icon} accent={color}>
            <GaugeBar
                label="Charge"
                value={`${pct.toFixed(0)}%`}
                pct={pct}
                sublabel={
                b.isCharging
                    ? "En charge"
                    : b.timeRemaining
                    ? `${Math.floor(b.timeRemaining / 60)}h${String(b.timeRemaining % 60).padStart(2, "0")} restantes`
                    : "Sur batterie"
                }
            />
            {b.model     != null && <InfoRow label="Modèle"  value={b.model} />}
            {b.type      != null && <InfoRow label="Type"    value={b.type} />}
            {b.voltage   != null && <InfoRow label="Tension" value={`${b.voltage.toFixed(2)} V`} />}
            {b.cycleCount != null && <InfoRow label="Cycles" value={`${b.cycleCount}`} />}
            <InfoRow
                label="État"
                value={b.isCharging ? "🟢 En charge" : "🔵 Sur batterie"}
            />
            </Card>
        );
        })()}

        {/* Disques */}
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

        {/* OS + Réseau */}
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
                  {iface.speed && (
                    <InfoRow label="Débit" value={`${iface.speed} Mbps`} />
                  )}
                </div>
              ))}
            </>
          )}
        </Card>
      </div>

      {/* Footer */}
      <div
        style={{
          fontSize: "10px",
          fontFamily: "monospace",
          color: "#1f2937",
          textAlign: "right",
          padding: "0 2px",
        }}
      >
        AUBEPINES — via Node.js systeminformation
      </div>
    </div>
  );
}