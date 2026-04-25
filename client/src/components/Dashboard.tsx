import React, { useState } from 'react';

interface DiscoveredCamera {
  ip: string;
  name: string;
  hlsUrl: string;
  rtspUrl: string;
}

export default function Dashboard() {
  const [scanning, setScanning] = useState(false);
  const [discoveredCameras, setDiscoveredCameras] = useState<DiscoveredCamera[]>([]);

  const handleScan = async () => {
    setScanning(true);
    setDiscoveredCameras([]);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/cameras/scan', {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      
      if (response.ok) {
        const data = await response.json();
        setDiscoveredCameras(data);
      } else {
        console.error('Erreur lors du scan réseau');
      }
    } catch (error) {
      console.error('Erreur réseau lors du scan', error);
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className="dashboard-container" style={{ padding: '20px' }}>
      <h2 style={{ marginBottom: '20px' }}>Recherche de caméras Pi Zero 2W</h2>
      
      <button onClick={handleScan} disabled={scanning} className="sensor-confirm-btn">
        {scanning ? 'Scan en cours...' : 'Scanner le réseau'}
      </button>

      {scanning && <div style={{ marginTop: '15px' }}>Recherche des caméras MediaMTX (attente max 300ms)...</div>}

      {!scanning && discoveredCameras.length > 0 && (
        <ul style={{ marginTop: '20px', listStyle: 'none', padding: 0 }}>
          {discoveredCameras.map((cam, idx) => (
            <li key={idx} style={{ marginBottom: '15px', padding: '15px', border: '1px solid var(--border)', borderRadius: '8px', background: 'var(--bg-surface)' }}>
              <strong style={{ fontSize: '1.1rem', color: 'var(--accent-blue)' }}>{cam.name}</strong> — {cam.ip} <br />
              <small style={{ display: 'block', marginTop: '4px', color: 'var(--text-muted)' }}>HLS : {cam.hlsUrl}</small>
              <small style={{ display: 'block', color: 'var(--text-muted)' }}>RTSP : {cam.rtspUrl}</small>
              <button className="sensor-link-btn" style={{ marginTop: '12px' }}>Ajouter cette caméra</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}