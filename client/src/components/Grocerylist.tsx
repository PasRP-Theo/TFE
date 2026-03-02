import { useState, useEffect } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";

interface GroceryItem {
  id:       number;
  name:     string;
  category: string;
  quantity: number;
  unit:     string;
  checked:  boolean;
}

const CATEGORIES = [
  "🥦 Fruits & Légumes", "🥩 Viandes & Poissons", "🧀 Produits laitiers",
  "🥖 Boulangerie", "🥫 Épicerie", "🧴 Hygiène", "🧹 Entretien", "❄️ Surgelés"
];
const UNITS = ["pcs", "kg", "g", "L", "mL", "boîte", "paquet", "bouteille"];

export default function GroceryList() {
  const [items,     setItems]     = useState<GroceryItem[]>([]);
  const [filter,    setFilter]    = useState<"all"|"pending"|"done">("all");
  const [showAdd,   setShowAdd]   = useState(false);
  const [newName,   setNewName]   = useState("");
  const [newCat,    setNewCat]    = useState(CATEGORIES[0]);
  const [newQty,    setNewQty]    = useState(1);
  const [newUnit,   setNewUnit]   = useState(UNITS[0]);
  const [apiError,  setApiError]  = useState("");
  const [showExport, setShowExport] = useState(false);
  const [copied,    setCopied]    = useState(false);

  // ── Chargement ─────────────────────────────────────────────
  useEffect(() => {
    fetch(`${API}/api/grocery`)
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) setItems(data);
        else setApiError("Erreur de chargement");
      })
      .catch(() => setApiError("Impossible de joindre le serveur"));
  }, []);

  // ── Ajouter ────────────────────────────────────────────────
  async function addItem() {
    if (!newName.trim()) return;
    try {
      const res  = await fetch(`${API}/api/grocery`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          name:     newName.trim(),
          category: newCat,
          quantity: newQty,
          unit:     newUnit,
        }),
      });
      if (!res.ok) { setApiError("Erreur ajout"); return; }
      const data = await res.json();
      setItems(prev => [...prev, data]);
      setNewName(""); setNewQty(1); setShowAdd(false); setApiError("");
    } catch {
      setApiError("Impossible de joindre le serveur");
    }
  }

  // ── Cocher ─────────────────────────────────────────────────
  async function toggle(item: GroceryItem) {
    // Mise à jour optimiste
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, checked: !i.checked } : i));
    try {
      const res = await fetch(`${API}/api/grocery/${item.id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ checked: !item.checked }),
      });
      if (!res.ok) {
        // Rollback si erreur
        setItems(prev => prev.map(i => i.id === item.id ? { ...i, checked: item.checked } : i));
      }
    } catch {
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, checked: item.checked } : i));
    }
  }

  // ── Quantité ───────────────────────────────────────────────
  async function changeQty(item: GroceryItem, delta: number) {
    const qty = Math.max(1, item.quantity + delta);
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, quantity: qty } : i));
    try {
      await fetch(`${API}/api/grocery/${item.id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ quantity: qty }),
      });
    } catch { /* ignore */ }
  }

  // ── Supprimer ──────────────────────────────────────────────
  async function remove(id: number) {
    setItems(prev => prev.filter(i => i.id !== id));
    try {
      await fetch(`${API}/api/grocery/${id}`, { method: "DELETE" });
    } catch { /* ignore */ }
  }

  // ── Vider les faits ────────────────────────────────────────
  async function clearDone() {
    setItems(prev => prev.filter(i => !i.checked));
    try {
      await fetch(`${API}/api/grocery/checked/all`, { method: "DELETE" });
    } catch { /* ignore */ }
  }

  // ── Export ─────────────────────────────────────────────────
  function buildText() {
    const lines = ["🛒 LISTE DE COURSES", ""];
    CATEGORIES.forEach(cat => {
      const catItems = items.filter(i => i.category === cat);
      if (!catItems.length) return;
      lines.push(cat);
      catItems.forEach(i => lines.push(`  ${i.checked ? "✓" : "○"} ${i.name} — ${i.quantity} ${i.unit}`));
      lines.push("");
    });
    lines.push(`${doneCount}/${total} articles faits`);
    return lines.join("\n");
  }

  function copyToClipboard() {
    navigator.clipboard.writeText(buildText()).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function downloadTxt() {
    const blob = new Blob([buildText()], { type: "text/plain;charset=utf-8" });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement("a"), { href: url, download: "liste-courses.txt" });
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Filtres + groupement ───────────────────────────────────
  const filtered = items.filter(i =>
    filter === "all" ? true : filter === "pending" ? !i.checked : i.checked
  );

  const grouped: Record<string, GroceryItem[]> = {};
  CATEGORIES.forEach(cat => {
    const inCat = filtered.filter(i => i.category === cat);
    if (inCat.length) grouped[cat] = inCat;
  });
  const others = filtered.filter(i => !CATEGORIES.includes(i.category));
  if (others.length) grouped["🗂 Autres"] = others;

  const doneCount = items.filter(i => i.checked).length;
  const total     = items.length;

  return (
    <div className="grocery-wrapper">

      {/* Header */}
      <div className="grocery-header">
        <div className="grocery-header-left">
          <span className="grocery-title">LISTE DE COURSES</span>
          <span className="grocery-progress">{doneCount}/{total} articles</span>
        </div>
        <div className="grocery-header-right">
          <div className="grocery-filter-group">
            {(["all","pending","done"] as const).map(f => (
              <button key={f}
                className={`grocery-filter-btn ${filter === f ? "active" : ""}`}
                onClick={() => setFilter(f)}>
                {f === "all" ? "Tout" : f === "pending" ? "À faire" : "Fait"}
              </button>
            ))}
          </div>
          {doneCount > 0 && (
            <button className="sensor-delete-btn" onClick={clearDone}>Vider faits</button>
          )}
          <button
            className={`grocery-export-btn ${showExport ? "active" : ""}`}
            onClick={() => setShowExport(v => !v)}>
            ↑ Partager
          </button>
          <button className="sensor-add-btn" onClick={() => setShowAdd(v => !v)}>
            {showAdd ? "✕" : "+ Ajouter"}
          </button>
        </div>
      </div>

      {/* Barre de progression */}
      <div className="grocery-progress-bar-track">
        <div className="grocery-progress-bar-fill"
          style={{ width: total > 0 ? `${(doneCount/total)*100}%` : "0%" }} />
      </div>

      {/* Erreur API */}
      {apiError && (
        <div style={{ color: "var(--accent-red)", fontSize: "11px", padding: "8px 16px", letterSpacing: "0.04em" }}>
          ⚠ {apiError}
        </div>
      )}

      {/* Export */}
      {showExport && (
        <div className="grocery-export-panel">
          <p className="grocery-export-label">EXPORTER / PARTAGER</p>
          <div className="grocery-export-preview">{buildText()}</div>
          <div className="grocery-export-actions">
            <button className="grocery-export-action-btn" onClick={copyToClipboard}>
              {copied ? "✓ Copié !" : "📋 Copier"}
            </button>
            <button className="grocery-export-action-btn" onClick={downloadTxt}>
              ⬇ Télécharger .txt
            </button>
          </div>
        </div>
      )}

      {/* Formulaire ajout */}
      {showAdd && (
        <div className="grocery-add-form">
          <input
            className="sensor-input"
            placeholder="Nom de l'article"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === "Enter" && addItem()}
            autoFocus
          />
          <select className="sensor-input sensor-select" value={newCat} onChange={e => setNewCat(e.target.value)}>
            {CATEGORIES.map(c => <option key={c}>{c}</option>)}
          </select>
          <div className="grocery-qty-row">
            <button className="grocery-qty-btn" onClick={() => setNewQty(q => Math.max(1, q-1))}>−</button>
            <span className="grocery-qty-val">{newQty}</span>
            <button className="grocery-qty-btn" onClick={() => setNewQty(q => q+1)}>+</button>
            <select className="sensor-input sensor-select grocery-unit-select"
              value={newUnit} onChange={e => setNewUnit(e.target.value)}>
              {UNITS.map(u => <option key={u}>{u}</option>)}
            </select>
          </div>
          <button className="sensor-confirm-btn" onClick={addItem}>Ajouter</button>
        </div>
      )}

      {/* Liste */}
      <div className="grocery-body">
        {Object.keys(grouped).length === 0 && (
          <p className="sensor-history-empty">
            {total === 0 ? "Aucun article — cliquez + Ajouter pour commencer." : "Aucun article dans ce filtre."}
          </p>
        )}
        {Object.entries(grouped).map(([cat, catItems]) => (
          <div key={cat} className="grocery-category">
            <div className="grocery-category-label">{cat}</div>
            {catItems.map(item => (
              <div key={item.id} className={`grocery-item ${item.checked ? "grocery-item--done" : ""}`}>
                <button className="grocery-check-btn" onClick={() => toggle(item)}>
                  <span className={`grocery-check-icon ${item.checked ? "checked" : ""}`}>
                    {item.checked ? "✓" : ""}
                  </span>
                </button>
                <span className="grocery-item-name">{item.name}</span>
                <div className="grocery-item-qty">
                  <button className="grocery-qty-btn" onClick={() => changeQty(item, -1)}>−</button>
                  <span className="grocery-qty-val">{item.quantity} {item.unit}</span>
                  <button className="grocery-qty-btn" onClick={() => changeQty(item, 1)}>+</button>
                </div>
                <button className="sensor-delete-btn" onClick={() => remove(item.id)}>✕</button>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}