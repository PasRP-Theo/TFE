import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import express from 'express';

vi.mock('../db/index.js', () => ({
  pool: {
    query: vi.fn(async () => ({
      rows: [{
        app_name: 'SENTYS', app_subtitle: 'Système de surveillance', system_version: 'v2.4.1',
        login_message: 'Connexion sécurisée', interface_language: 'fr-FR', time_format: '24h',
        show_system_version: false, ui_density: 'standard', camera_card_size: 'standard',
        show_status_panel: true, camera_autostart_enabled: true, camera_refresh_seconds: 3,
        show_offline_cameras: true, default_camera_add_mode: 'discover', camera_discovery_interval_seconds: 5,
        alerts_realtime_enabled: true, alerts_daily_summary_enabled: false, alerts_sound_enabled: true,
        alerts_disconnect_enabled: true, pin_hash: 'x'.repeat(64), surveillance_mode: false, push_minimal_content: true,
      }],
    })),
  },
}));
vi.mock('../auth/tokens.js', () => ({
  authenticateAccessToken: vi.fn(async token => (token === 'valid' ? { id: 1, username: 'alice', role: 'user' } : null)),
}));
vi.mock('../middleware/auth.js', () => ({ requireAuth: vi.fn(), requireAdmin: vi.fn() }));
vi.mock('../camera/manager.js', () => ({ stopAllCameras: vi.fn(), startCamera: vi.fn() }));
vi.mock('../audit/log.js', () => ({ logAudit: vi.fn() }));

const { default: appConfigRouter } = await import('./appConfig.js');

let server;
let base;

beforeAll(async () => {
  const app = express();
  app.use('/api/app-config', appConfigRouter);
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => server?.close());

describe('GET /api/app-config', () => {
  it('sans session, ne révèle ni l\'état d\'armement ni le PIN', async () => {
    const config = await (await fetch(`${base}/api/app-config`)).json();
    expect(config.appName).toBe('SENTYS');
    expect(config).not.toHaveProperty('surveillanceMode');
    expect(config).not.toHaveProperty('pinConfigured');
    expect(config).not.toHaveProperty('alertsRealtimeEnabled');
  });

  it('avec un jeton invalide, renvoie aussi la version publique', async () => {
    const res = await fetch(`${base}/api/app-config`, { headers: { Authorization: 'Bearer forged' } });
    expect(await res.json()).not.toHaveProperty('surveillanceMode');
  });

  it('avec une session valide, renvoie la configuration complète', async () => {
    const res = await fetch(`${base}/api/app-config`, { headers: { Authorization: 'Bearer valid' } });
    const config = await res.json();
    expect(config.surveillanceMode).toBe(false);
    expect(config.pinConfigured).toBe(true);
  });
});
