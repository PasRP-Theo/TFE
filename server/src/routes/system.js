import { Router } from 'express';
import si from 'systeminformation';

const router = Router();

router.get('/info', async (req, res) => {
  try {
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

    const battery = {
      hasBattery: batteryData.hasbattery === true || batteryData.hasBattery === true,
      percent: batteryData.percent != null ? Number(batteryData.percent) : undefined,
      isCharging: batteryData.ischarging === true || batteryData.isCharging === true,
      timeRemaining: batteryData.timeremaining != null ? Number(batteryData.timeremaining) : batteryData.timeRemaining != null ? Number(batteryData.timeRemaining) : null,
      model: batteryData.model || null,
      type: batteryData.type || null,
      voltage: batteryData.voltage != null ? Number(batteryData.voltage) : null,
      cycleCount: batteryData.cyclecount != null ? Number(batteryData.cyclecount) : batteryData.cycleCount != null ? Number(batteryData.cycleCount) : null,
    };

    const os = {
      platform: osData.platform || 'unknown',
      distro: osData.distro || 'unknown',
      release: osData.release || 'unknown',
      arch: osData.arch || 'unknown',
      hostname: osData.hostname || 'unknown',
      uptime: Number(osData.uptime) || 0,
    };

    res.json({
      cpu,
      ram,
      disks,
      network,
      os,
      battery,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[SYSTEM INFO]', err);
    res.status(500).json({ error: 'Erreur serveur lors de la récupération des infos système' });
  }
});

export default router;
