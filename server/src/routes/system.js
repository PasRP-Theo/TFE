// server/src/routes/system.js
// Prérequis : npm install systeminformation

import si      from 'systeminformation';
import express from 'express';
import jwt     from 'jsonwebtoken';

const router = express.Router();

// ── Middleware JWT ─────────────────────────────────────────
function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer '))
    return res.status(401).json({ error: 'Non authentifié' });
  try {
    req.user = jwt.verify(
      header.slice(7),
      process.env.JWT_SECRET || 'changeme_in_production'
    );
    next();
  } catch {
    res.status(401).json({ error: 'Token invalide ou expiré' });
  }
}

// ── GET /api/system/info ───────────────────────────────────
router.get('/info', auth, async (req, res) => {
  try {
    const [cpuData, cpuLoad, mem, fsSize, networkIfaces, osInfo, time, batteryData] =
      await Promise.all([
        si.cpu(),
        si.currentLoad(),
        si.mem(),
        si.fsSize(),
        si.networkInterfaces(),
        si.osInfo(),
        si.time(),
        si.battery(),          // ← ajout batterie
      ]);

    // Température (peut être indisponible sur Windows)
    let cpuTemp = null;
    try {
      const tempData = await si.cpuTemperature();
      cpuTemp = tempData.main > 0 ? tempData.main : null;
    } catch {
      cpuTemp = null;
    }

    const toGB = (bytes) => bytes / 1024 / 1024 / 1024;

    const EXCLUDED_FS = ['tmpfs', 'devtmpfs', 'udev', 'overlay', 'squashfs', 'efivarfs'];
    const disks = fsSize
      .filter(fs => fs.size > 0 && !EXCLUDED_FS.includes(fs.type))
      .map(fs => ({
        mount:        fs.mount,
        fs:           fs.type,
        totalGB:      toGB(fs.size),
        usedGB:       toGB(fs.used),
        freeGB:       toGB(fs.available),
        usagePercent: fs.use,
      }));

    const ifaces = Array.isArray(networkIfaces) ? networkIfaces : [networkIfaces];
    const network = ifaces
      .filter(i => i.ip4 && i.ip4 !== '127.0.0.1' && !i.internal)
      .map(i => ({
        iface: i.iface,
        ip4:   i.ip4,
        mac:   i.mac,
        speed: i.speed > 0 ? i.speed : null,
      }));

    // Batterie — hasBattery=false sur PC fixe ou VM
    const battery = batteryData.hasBattery ? {
      hasBattery:    true,
      percent:       batteryData.percent,
      isCharging:    batteryData.isCharging,
      timeRemaining: batteryData.timeRemaining ?? null,
      model:         batteryData.model   || null,
      type:          batteryData.type    || null,
      voltage:       batteryData.voltage > 0 ? batteryData.voltage : null,
      cycleCount:    batteryData.cycleCount > 0 ? batteryData.cycleCount : null,
    } : { hasBattery: false };

    res.json({
      cpu: {
        model:         cpuData.brand,
        manufacturer:  cpuData.manufacturer,
        cores:         cpuData.cores,
        physicalCores: cpuData.physicalCores,
        speedGHz:      cpuData.speed,
        usagePercent:  Math.round(cpuLoad.currentLoad * 10) / 10,
        temperature:   cpuTemp,
      },
      ram: {
        totalGB:      toGB(mem.total),
        usedGB:       toGB(mem.used),
        freeGB:       toGB(mem.free),
        usagePercent: Math.round((mem.used / mem.total) * 1000) / 10,
      },
      disks,
      network,
      battery,
      os: {
        platform: osInfo.platform,
        distro:   osInfo.distro,
        release:  osInfo.release,
        arch:     osInfo.arch,
        hostname: osInfo.hostname,
        uptime:   Math.floor(time.uptime),
      },
      fetchedAt: new Date().toISOString(),
    });

  } catch (err) {
    console.error('[system/info]', err);
    res.status(500).json({ error: 'Impossible de récupérer les infos système' });
  }
});

export default router;