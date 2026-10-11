import { describe, it, expect, vi } from 'vitest';
import { connectCamera, CAMERA_BRANDS } from './connectCamera.js';
import { OnvifError } from './onvif.js';

const onvifDevice = (overrides = {}) => ({
  manufacturer: 'Reolink', model: 'RLC-510A', firmware: 'v3',
  profiles: [], chosen: { token: '000', encoding: 'H264', width: 2560, height: 1920 },
  transcode: false, streamUrl: 'rtsp://192.168.0.21:554/h264Preview_01_main', ...overrides,
});
const h264 = { ok: true, codec: 'h264', width: 2560, height: 1920 };

describe('connectCamera — ONVIF', () => {
  it('caméra ONVIF en H.264 : prête, vérifiée, sans conversion', async () => {
    const probe = vi.fn(async () => h264);
    const result = await connectCamera(
      { host: '192.168.0.21', username: 'admin', password: 'p@ss:word' },
      { onvif: async () => onvifDevice(), probe }
    );
    expect(result).toMatchObject({
      method: 'onvif', suggestedName: 'Reolink RLC-510A', codecLabel: 'H.264', transcode: false, verified: true, warning: null,
      streamUrl: 'rtsp://192.168.0.21:554/h264Preview_01_main',
    });
    // la vérification utilise les identifiants (encodés), la réponse jamais
    expect(probe).toHaveBeenCalledWith('rtsp://admin:p%40ss%3Aword@192.168.0.21:554/h264Preview_01_main');
    expect(JSON.stringify(result)).not.toContain('p@ss');
  });

  it('le codec réel prime sur ce qu\'annonce la caméra (H.265 → conversion)', async () => {
    const result = await connectCamera(
      { host: '192.168.0.21', username: 'a', password: 'b' },
      { onvif: async () => onvifDevice(), probe: async () => ({ ok: true, codec: 'hevc', width: 3840, height: 2160 }) }
    );
    expect(result).toMatchObject({ transcode: true, codecLabel: 'H.265', width: 3840 });
    expect(result.warning).toMatch(/converti/);
  });

  it('identifiants refusés par le flux RTSP : erreur « auth »', async () => {
    await expect(connectCamera(
      { host: '192.168.0.21', username: 'a', password: 'b' },
      { onvif: async () => onvifDevice(), probe: async () => ({ ok: false, error: 'auth' }) }
    )).rejects.toMatchObject({ code: 'auth' });
  });

  it('flux non vérifiable (ffmpeg absent…) : ajout possible, avec avertissement', async () => {
    const result = await connectCamera(
      { host: '192.168.0.21', username: 'a', password: 'b' },
      { onvif: async () => onvifDevice(), probe: async () => ({ ok: false, error: 'timeout' }) }
    );
    expect(result).toMatchObject({ verified: false, codec: 'h264', transcode: false });
    expect(result.warning).toMatch(/non vérifié/);
  });

  it('pas d\'ONVIF : demande la marque et propose la liste', async () => {
    const error = await connectCamera(
      { host: '192.168.0.21', username: 'a', password: 'b' },
      { onvif: async () => { throw new OnvifError('not_onvif', 'x'); }, probe: vi.fn() }
    ).catch(err => err);
    expect(error.code).toBe('needs_brand');
    expect(error.brands.map(b => b.id)).toContain('tapo');
  });

  it('refuse une adresse publique', async () => {
    await expect(connectCamera({ host: '8.8.8.8' }, { onvif: vi.fn(), probe: vi.fn() }))
      .rejects.toMatchObject({ code: 'invalid_host' });
  });
});

describe('connectCamera — par marque', () => {
  it('essaie les chemins de la marque jusqu\'au premier flux lisible', async () => {
    const probe = vi.fn(async url => (url.endsWith('/stream2') ? h264 : { ok: false, error: 'not_found' }));
    const result = await connectCamera(
      { host: '192.168.0.34', username: 'cam', password: 'pw', brand: 'tapo' },
      { onvif: vi.fn(), probe }
    );
    expect(result).toMatchObject({ method: 'brand', manufacturer: 'TP-Link Tapo', streamUrl: 'rtsp://192.168.0.34:554/stream2' });
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it('mot de passe refusé : arrêt immédiat (pas de rafale de tentatives)', async () => {
    const probe = vi.fn(async () => ({ ok: false, error: 'auth' }));
    await expect(connectCamera({ host: '192.168.0.34', username: 'a', password: 'b', brand: 'hikvision' }, { onvif: vi.fn(), probe }))
      .rejects.toMatchObject({ code: 'auth' });
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('aucun chemin ne répond : message qui cite la marque', async () => {
    const brand = CAMERA_BRANDS.find(b => b.id === 'dahua');
    await expect(connectCamera(
      { host: '192.168.0.40', username: 'a', password: 'b', brand: 'dahua' },
      { onvif: vi.fn(), probe: async () => ({ ok: false, error: 'not_found' }) }
    )).rejects.toThrow(brand.label);
  });
});
