import { Router } from 'express';
import si from 'systeminformation';
import { issueSetupToken } from '../auth/setup.js';
import { logAudit } from '../audit/log.js';
import { pool } from '../db/index.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { stopAllCameras } from '../camera/manager.js';

const router = Router();

// lectures système coûteuses (processeur, disques, réseau) : mises en commun quelques secondes,
// requêtes simultanées comprises, pour que plusieurs onglets ouverts ne les multiplient pas
function cached(ttlMs, load) {
  let value = null;
  let at = 0;
  let pending = null;
  return () => {
    if (value && Date.now() - at < ttlMs) return Promise.resolve(value);
    pending ??= load()
      .then(result => { value = result; at = Date.now(); return result; })
      .finally(() => { pending = null; });
    return pending;
  };
}

function normalizeBattery(batteryData) {
  return {
    hasBattery: batteryData.hasbattery === true || batteryData.hasBattery === true,
    percent: batteryData.percent != null ? Number(batteryData.percent) : undefined,
    isCharging: batteryData.ischarging === true || batteryData.isCharging === true,
    timeRemaining: batteryData.timeremaining != null ? Number(batteryData.timeremaining) : batteryData.timeRemaining != null ? Number(batteryData.timeRemaining) : null,
    model: batteryData.model || null,
    type: batteryData.type || null,
    voltage: batteryData.voltage != null ? Number(batteryData.voltage) : null,
    cycleCount: batteryData.cyclecount != null ? Number(batteryData.cyclecount) : batteryData.cycleCount != null ? Number(batteryData.cycleCount) : null,
  };
}

const readPower = cached(10_000, async () => {
  const battery = normalizeBattery(await si.battery());
  return { hasBattery: battery.hasBattery, isCharging: battery.isCharging, percent: battery.percent };
});

// alimentation seule (secteur / batterie) : lecture légère pour la barre d'état des pages
router.get('/power', requireAuth, async (_req, res) => {
  try {
    res.json(await readPower());
  } catch (err) {
    console.error('[SYSTEM POWER]', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

const readInfo = cached(2_000, async () => {
    const [cpuData, loadData, tempData, memData, osData, fsData, netIfaces, batteryData] = await Promise.all([
      si.cpu(),
      si.currentLoad(),
      si.cpuTemperature(),
      si.mem(),
      si.osInfo(),
      si.fsSize(),
      si.networkInterfaces(),
      si.battery(),
    ]);

    const cpu = {
      model: cpuData.brand || cpuData.model || 'Inconnu',
      manufacturer: cpuData.manufacturer || 'Inconnu',
      cores: cpuData.cores ?? 0,
      physicalCores: cpuData.physicalCores ?? cpuData.cores ?? 0,
      speedGHz: Number(cpuData.speed) || 0,
      usagePercent: Number(loadData.currentLoad) || 0,
      temperature: tempData.main != null ? Number(tempData.main) : null,
    };

    const availableMemory = memData.available ?? memData.free ?? 0;
    const totalMemory = memData.total || 0;
    const usedMemory = Math.max(totalMemory - availableMemory, 0);

    const ram = {
      totalGB: Number(totalMemory / 1024 / 1024 / 1024),
      usedGB: Number(usedMemory / 1024 / 1024 / 1024),
      freeGB: Number(availableMemory / 1024 / 1024 / 1024),
      usagePercent: totalMemory ? Number((usedMemory / totalMemory) * 100) : 0,
    };

    const disks = (fsData || []).map((disk) => ({
      mount: disk.mount || disk.mountpoint || '—',
      fs: disk.fs || disk.type || '—',
      totalGB: Number((disk.size || 0) / 1024 / 1024 / 1024),
      usedGB: Number((disk.used || 0) / 1024 / 1024 / 1024),
      freeGB: Number(((disk.size || 0) - (disk.used || 0)) / 1024 / 1024 / 1024),
      usagePercent: Number(disk.use || 0),
    }));

    const network = (netIfaces || [])
      .filter((iface) => iface.ip4 && !iface.internal)
      .map((iface) => ({
        iface: iface.iface || 'unknown',
        ip4: iface.ip4 || '',
        mac: iface.mac || '',
        speed: iface.speed != null ? Number(iface.speed) : null,
      }));

    const battery = normalizeBattery(batteryData);

    const os = {
      platform: osData.platform || 'unknown',
      distro: osData.distro || 'unknown',
      release: osData.release || 'unknown',
      arch: osData.arch || 'unknown',
      hostname: osData.hostname || 'unknown',
      uptime: Number(osData.uptime) || 0,
    };

    return {
      cpu,
      ram,
      disks,
      network,
      os,
      battery,
      fetchedAt: new Date().toISOString(),
    };
});

router.get('/info', requireAuth, async (_req, res) => {
  try {
    res.json(await readInfo());
  } catch (err) {
    console.error('[SYSTEM INFO]', err);
    res.status(500).json({ error: 'Erreur serveur lors de la récupération des infos système' });
  }
});

router.post('/reset', requireAuth, requireAdmin, async (req, res) => {
  const client = await pool.connect();

  try {
    stopAllCameras();

    await client.query('BEGIN');

    await client.query('TRUNCATE TABLE camera_node_motion_events RESTART IDENTITY');
    await client.query('TRUNCATE TABLE camera_nodes RESTART IDENTITY');
    await client.query('TRUNCATE TABLE camera_discoveries RESTART IDENTITY');
    // DELETE (et non TRUNCATE) : respecte les clés étrangères ON DELETE
    await client.query('DELETE FROM cameras');
    await client.query('DELETE FROM push_subscriptions');
    await client.query('DELETE FROM users');

    await client.query(
      `UPDATE app_settings
       SET app_name = 'SENTYS',
           app_subtitle = 'Système de surveillance',
           system_version = 'v2.4.1',
           bootstrap_admin_user_id = NULL,
           default_admin_active = false,
           updated_at = NOW()
       WHERE id = 1`
    );

    await client.query('COMMIT');
    await logAudit(req.user.username, 'SYSTEM_RESET', 'Réinitialisation complète (comptes et caméras)', req.ip);
    issueSetupToken();

    res.json({
      message: 'Réinitialisation effectuée',
      scope: {
        users: 'reset',
        appConfig: 'reset',
        cameras: 'reset',
        cameraDiscoveries: 'reset',
        cameraNodes: 'reset',
        recordings: 'unchanged',
      },
      needsSetup: true,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[SYSTEM RESET]', err);
    res.status(500).json({ error: 'Erreur serveur lors de la réinitialisation' });
  } finally {
    client.release();
  }
});

export default router;
