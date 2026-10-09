import { pool } from '../db/index.js';
import { raiseAlert } from './engine.js';

// Surveillance des coupures : caméras en reconnexion, Pi silencieux.
// Une coupure doit durer confirmDelayMs avant d'être signalée (micro-coupures Wi-Fi),
// puis elle n'est signalée qu'UNE fois : l'appareil doit revenir avant une nouvelle alerte.
export function createOfflineMonitor({
  getCameraStates,
  confirmDelayMs = 60_000,
  nodeSilenceSeconds = 90,
  now = () => Date.now(),
}) {
  // « cam:3 » / « node:pi-salon » → { since, alerted }
  const outages = new Map();

  async function track(subject, label, isDown, buildAlert) {
    const outage = outages.get(subject);
    if (!isDown) {
      if (outage) {
        console.log(`[OFFLINE] ${label} de retour`);
        outages.delete(subject);
      }
      return;
    }
    if (!outage) {
      outages.set(subject, { since: now(), alerted: false });
      console.log(`[OFFLINE] ${label} suspect hors ligne — vérification dans ${confirmDelayMs / 1000}s`);
      return;
    }
    if (outage.alerted || now() - outage.since < confirmDelayMs) return;
    // marquée après coup : en cas d'erreur (base indisponible), on retente au passage suivant
    await raiseAlert(buildAlert(Math.round((now() - outage.since) / 1000)));
    outage.alerted = true;
  }

  async function check() {
    const [cameraResult, nodeResult] = await Promise.all([
      pool.query('SELECT id, name, location FROM cameras WHERE active = true'),
      // silence calculé par PostgreSQL : pas de décalage de fuseau entre Node et la base
      pool.query(
        `SELECT device_id, name, host, location, last_seen_at,
                EXTRACT(EPOCH FROM (NOW() - last_seen_at))::int AS silent_seconds
         FROM camera_nodes`
      ),
    ]);
    const states = getCameraStates();
    const present = new Set();

    for (const camera of cameraResult.rows) {
      const id = String(camera.id);
      const subject = `cam:${id}`;
      present.add(subject);
      const status = states[id]?.status || 'stopped';
      await track(subject, `Caméra ${id} (${camera.name})`, status === 'reconnecting', seconds => ({
        type: 'camera_offline', subject, sourceType: 'camera', sourceId: id, cameraId: camera.id,
        title: `CAM ${id} — ${camera.name} hors ligne`,
        message: `La caméra ${camera.name} (CAM ${id}) est hors ligne depuis plus de ${seconds}s.`,
        metadata: { cameraId: camera.id, location: camera.location, status },
      }));
    }

    for (const node of nodeResult.rows) {
      const subject = `node:${node.device_id}`;
      present.add(subject);
      const silent = node.silent_seconds ?? Infinity;
      await track(subject, `Noeud ${node.device_id} (${node.name})`, silent > nodeSilenceSeconds, () => ({
        type: 'node_offline', subject, sourceType: 'camera-node', sourceId: node.device_id,
        title: `Noeud hors ligne — ${node.name}`,
        message: `Le noeud ${node.name} n'a pas donné de nouvelles depuis ${silent}s.`,
        metadata: { deviceId: node.device_id, host: node.host, location: node.location, lastSeenAt: node.last_seen_at },
      }));
    }

    // appareils supprimés entre-temps
    for (const subject of outages.keys()) if (!present.has(subject)) outages.delete(subject);
  }

  return { check, outages };
}
