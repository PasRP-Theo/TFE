// Base URL pointant vers le proxy Vite pour éviter l'erreur CORS (ERR_1)
const PI_API_BASE = '/pi-api';
const PI_IP = '192.168.0.213';

function getAuthHeader() {
  // ERR_2 — Header d'authentification Basic requis par MediaMTX
  return { 'Authorization': 'Basic ' + btoa('admin:admin') };
}

export const piCameraApi = {
  checkPiOnline: async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000); // ERR_4 — Timeout de 4s
    
    try {
      const res = await fetch(`${PI_API_BASE}/v3/paths/list`, {
        headers: getAuthHeader(),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      
      if (res.status === 401) throw new Error("Identifiants API incorrects"); // ERR_2
      if (!res.ok) throw new Error(`Erreur HTTP: ${res.status}`);
      return true;
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError' || err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {
        throw new Error("Pi hors ligne — Vérifiez que le Pi est démarré et sur le réseau 192.168.0.x"); // ERR_4
      }
      throw err;
    }
  },

  getCameraStatus: async (streamName = 'cam1') => {
    // On réutilise checkPiOnline pour la gestion du timeout et du 401
    await piCameraApi.checkPiOnline();

    const res = await fetch(`${PI_API_BASE}/v3/paths/list`, { headers: getAuthHeader() });
    const data = await res.json();
    
    const cam = data.items?.find(item => item.name === streamName);
    if (!cam) throw new Error(`Caméra '${streamName}' non trouvée sur le Pi.`);
    
    // ERR_5 — Vérifier si le flux est actif (MediaMTX retourne 'ready', ou 'bytesReceived')
    const isStreaming = cam.ready === true || cam.bytesReceived > 0 || (cam.tracks && cam.tracks.length > 0);
    
    if (!isStreaming) {
      throw new Error("Caméra détectée mais flux inactif — Vérifiez avec: sudo systemctl status mediamtx");
    }
    return cam;
  },

  buildStreamUrl: (streamName = 'cam1') => {
    return `http://${PI_IP}:8888/${streamName}/index.m3u8`;
  }
};