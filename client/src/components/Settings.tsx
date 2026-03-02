import { useState, useEffect } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";

// ── Toggle setting ─────────────────────────────────────────
function SettingToggle({ label, description, defaultChecked = false }: {
  label: string; description?: string; defaultChecked?: boolean;
}) {
  const [checked, setChecked] = useState(defaultChecked);
  return (
    <div className="settings-row" onClick={() => setChecked(v => !v)}>
      <div className="settings-row-text">
        <span className="settings-row-label">{label}</span>
        {description && <span className="settings-row-desc">{description}</span>}
      </div>
      <div className={`settings-toggle ${checked ? "settings-toggle--on" : "settings-toggle--off"}`}>
        <div className="settings-toggle-knob" />
      </div>
    </div>
  );
}

// ── Onglet Paramètres ──────────────────────────────────────
function TabSettings() {
  return (
    <div>
      <div className="settings-section">
        <div className="settings-section-label">NOTIFICATIONS</div>
        <SettingToggle label="Alertes en temps réel"  description="Notifications push lors d'un événement critique" defaultChecked />
        <SettingToggle label="Rapport journalier"     description="Résumé envoyé chaque matin à 08h00" />
        <SettingToggle label="Alertes sonores"        description="Signal audio lors d'une alerte capteur" defaultChecked />
      </div>
      <div className="settings-section">
        <div className="settings-section-label">SYSTÈME</div>
        <SettingToggle label="Enregistrement automatique" description="Sauvegarde du flux caméra en continu" />
        <SettingToggle label="Mode nuit"                  description="Ajustement automatique de la luminosité" defaultChecked />
      </div>
    </div>
  );
}

// ── Onglet Utilisateurs ────────────────────────────────────
interface User { id: number; email: string; role: string; created_at: string; }

function TabUsers() {
  const [users,    setUsers]    = useState<User[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [showAdd,  setShowAdd]  = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newPass,  setNewPass]  = useState("");
  const [newRole,  setNewRole]  = useState("user");
  const [error,    setError]    = useState("");
  const [success,  setSuccess]  = useState("");
  const [confirmUser, setConfirmUser] = useState<User | null>(null); // ← ajoute

  async function fetchUsers() {
    try {
      const res  = await fetch(`${API}/api/users`);
      const data = await res.json();
      setUsers(data);
    } catch {
      setError("Impossible de charger les utilisateurs");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchUsers(); }, []);

  async function createUser() {
    setError(""); setSuccess("");
    if (!newEmail || !newPass) { setError("Email et mot de passe requis"); return; }
    try {
      const res  = await fetch(`${API}/auth/register`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ email: newEmail, password: newPass, role: newRole }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error); return; }
      setSuccess(`Utilisateur ${data.user.email} créé !`);
      setNewEmail(""); setNewPass(""); setShowAdd(false);
      fetchUsers();
    } catch {
      setError("Erreur serveur");
    }
  }

  async function deleteUser(id: number) {
    if (!confirm("Supprimer cet utilisateur ?")) return;
    try {
      await fetch(`${API}/api/users/${id}`, { method: "DELETE" });
      setUsers(prev => prev.filter(u => u.id !== id));
    } catch {
      setError("Erreur suppression");
    }
  }

  async function confirmToggleRole() {
    if (!confirmUser) return;
    const newR = confirmUser.role === "admin" ? "user" : "admin";
    try {
      const res  = await fetch(`${API}/api/users/${confirmUser.id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ role: newR }),
      });
      const data = await res.json();
      setUsers(prev => prev.map(u => u.id === confirmUser.id ? data : u));
      setSuccess(`Rôle de ${confirmUser.email} changé en ${newR.toUpperCase()}`);
    } catch {
      setError("Erreur mise à jour rôle");
    } finally {
      setConfirmUser(null);
    }
  }

  return (
    <div>
      {/* Header section */}
      <div className="settings-section">
        <div className="settings-section-label" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>UTILISATEURS ({users.length})</span>
          <button className="sensor-add-btn" onClick={() => { setShowAdd(v => !v); setError(""); setSuccess(""); }}>
            {showAdd ? "✕ Annuler" : "+ Ajouter"}
          </button>
        </div>

        {/* Formulaire ajout */}
        {showAdd && (
          <div className="sensor-add-form" style={{ marginBottom: "12px" }}>
            <input
              className="sensor-input"
              type="email"
              placeholder="Email"
              value={newEmail}
              onChange={e => setNewEmail(e.target.value)}
              autoFocus
            />
            <input
              className="sensor-input"
              type="text"
              placeholder="Mot de passe"
              value={newPass}
              onChange={e => setNewPass(e.target.value)}
            />
            <select
              className="sensor-input sensor-select"
              value={newRole}
              onChange={e => setNewRole(e.target.value)}
            >
              <option value="user">Utilisateur</option>
              <option value="admin">Administrateur</option>
            </select>
            <button className="sensor-confirm-btn" onClick={createUser}>Créer</button>
          </div>
        )}

        {/* Messages */}
        {error   && <div style={{ color: "var(--accent-red)",   fontSize: "11px", padding: "6px 0", letterSpacing: "0.04em" }}>⚠ {error}</div>}
        {success && <div style={{ color: "var(--accent-green)", fontSize: "11px", padding: "6px 0", letterSpacing: "0.04em" }}>✓ {success}</div>}

        {/* Liste des users */}
        {loading ? (
          <div style={{ color: "var(--text-muted)", fontSize: "11px", padding: "12px 0" }}>Chargement...</div>
        ) : (
          <table className="sensor-table" style={{ marginTop: "8px" }}>
            <thead>
              <tr>
                <th className="sensor-th">EMAIL</th>
                <th className="sensor-th">RÔLE</th>
                <th className="sensor-th">CRÉÉ LE</th>
                <th className="sensor-th sensor-th--right">ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 && (
                <tr><td colSpan={4} className="sensor-td" style={{ textAlign: "center", color: "var(--text-muted)" }}>Aucun utilisateur</td></tr>
              )}
              {users.map((user, i) => (
                <tr key={user.id} className={i % 2 === 0 ? "sensor-tr--odd" : "sensor-tr--even"}>
                  <td className="sensor-td">
                    <span className="sensor-name">{user.email}</span>
                  </td>
                  <td className="sensor-td">
                    <button
                      className="sensor-status-btn"
                      onClick={() => setConfirmUser(user)}
                      title="Changer le rôle"
                    >
                      <span className={`sensor-badge ${user.role === "admin" ? "sensor-badge--alert" : "sensor-badge--ok"}`}>
                        <span className="sensor-badge-dot" />
                        {user.role === "admin" ? "ADMIN" : "USER"}
                      </span>
                    </button>
                  </td>
                  <td className="sensor-td">
                    <span className="sensor-type">
                      {new Date(user.created_at).toLocaleDateString("fr-FR")}
                    </span>
                  </td>
                  <td className="sensor-td sensor-td--right">
                    <button className="sensor-delete-btn" onClick={() => deleteUser(user.id)} title="Supprimer">✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {confirmUser && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 300,
          background: "rgba(0,0,0,0.75)", backdropFilter: "blur(3px)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }} onClick={() => setConfirmUser(null)}>
          <div style={{
            background: "var(--bg-elevated)", border: "1px solid var(--border)",
            borderRadius: "4px", padding: "28px 32px", width: "380px",
            fontFamily: "var(--font-mono)",
          }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.2em", color: "var(--accent-blue)", marginBottom: "20px" }}>
              MODIFIER LE RÔLE
            </div>
            <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "12px" }}>
              Utilisateur : <strong style={{ color: "var(--text-primary)" }}>{confirmUser.email}</strong>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "24px" }}>
              <span className={`sensor-badge ${confirmUser.role === "admin" ? "sensor-badge--alert" : "sensor-badge--ok"}`}>
                <span className="sensor-badge-dot" />{confirmUser.role.toUpperCase()}
              </span>
              <span style={{ color: "var(--text-muted)", fontSize: "14px" }}>→</span>
              <span className={`sensor-badge ${confirmUser.role === "admin" ? "sensor-badge--ok" : "sensor-badge--alert"}`}>
                <span className="sensor-badge-dot" />{confirmUser.role === "admin" ? "USER" : "ADMIN"}
              </span>
            </div>
            <div style={{ fontSize: "10px", color: "var(--text-muted)", marginBottom: "20px" }}>
              Cette action modifie les permissions de l'utilisateur immédiatement.
            </div>
            <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
              <button className="sensor-delete-btn" onClick={() => setConfirmUser(null)}>Annuler</button>
              <button className="sensor-confirm-btn" onClick={confirmToggleRole}>Confirmer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Composant principal ────────────────────────────────────
export default function Settings() {
  const [tab, setTab] = useState<"settings" | "users">("settings");

  return (
    <div className="settings-wrapper">
      <div className="settings-header">
        <span className="settings-title">PARAMÈTRES</span>
        <span className="settings-subtitle">SYSTÈME v2.4.1</span>
      </div>

      {/* Tabs */}
      <div className="sensor-header-right" style={{ padding: "0 0 16px 0", gap: "8px", display: "flex" }}>
        <button className={`sensor-tab-btn ${tab === "settings" ? "active" : ""}`} onClick={() => setTab("settings")}>
          GÉNÉRAL
        </button>
        <button className={`sensor-tab-btn ${tab === "users" ? "active" : ""}`} onClick={() => setTab("users")}>
          UTILISATEURS
        </button>
      </div>

      {tab === "settings" ? <TabSettings /> : <TabUsers />}
    </div>
  );
}