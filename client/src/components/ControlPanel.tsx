import { useState } from 'react';
import { Link } from 'react-router-dom';

export default function ControlPanel() {
  const [surveillanceActive, setSurveillanceActive] = useState(true);
  
  return (
    <div className="cam-page">
      <div className="cam-header">
        <div className="cam-header-left">
          <span className="cam-header-title">TABLEAU DE BORD</span>
          <div className="cam-header-meta">
            <span className="cam-header-stat">CONTRÔLE GLOBAL</span>
          </div>
        </div>
      </div>

      <div style={{ padding: '20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '30px' }}>
        
        {/* Bloc État de la surveillance (US-21) */}
        <div className="alerts-panel">
          <div className="alerts-panel-title">MODE SURVEILLANCE</div>
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <div style={{ fontSize: '18px', marginBottom: '20px', color: 'var(--text-muted)' }}>État Actuel du Système</div>
            <div style={{ fontSize: '32px', fontWeight: 'bold', color: surveillanceActive ? 'var(--accent-green)' : 'var(--accent-red)', marginBottom: '40px' }}>
              {surveillanceActive ? 'ARMÉ (ACTIF)' : 'DÉSARMÉ (INACTIF)'}
            </div>
            
            <button 
              className={surveillanceActive ? "sensor-delete-btn sensor-delete-btn--danger sensor-delete-btn--xl" : "sensor-confirm-btn sensor-confirm-btn--xl"} 
              style={{ width: '100%', padding: '25px', fontSize: '20px' }}
              onClick={() => setSurveillanceActive(!surveillanceActive)}
            >
              {surveillanceActive ? "DÉSACTIVER LES ALARMES" : "ARMER LE SYSTÈME"}
            </button>
          </div>
        </div>

        {/* Bloc Alertes Récentes (US-22) */}
        <div className="alerts-panel">
          <div className="alerts-panel-title">RÉSUMÉ SYSTÈME</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', marginTop: '20px' }}>
            <div style={{ padding: '15px', background: 'var(--accent-blue-bg)', borderLeft: '4px solid var(--accent-blue)', borderRadius: '4px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                <strong style={{ color: 'var(--accent-blue)' }}>CAMÉRAS EN LIGNE</strong>
              </div>
              <div style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>Le système vidéo est opérationnel.</div>
              <div style={{ marginTop: '10px' }}><Link to="/videos" className="sensor-link-btn">Voir le direct →</Link></div>
            </div>
            
            <div style={{ padding: '15px', background: 'var(--accent-red-bg)', borderLeft: '4px solid var(--accent-red)', borderRadius: '4px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                <strong style={{ color: 'var(--accent-red)' }}>ALERTES EN ATTENTE</strong>
              </div>
              <div style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>Consultez le centre d'alertes pour vérifier les détections récentes.</div>
              <div style={{ marginTop: '10px' }}><Link to="/alerts" className="sensor-link-btn">Centre d'alertes →</Link></div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}