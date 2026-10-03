import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer } from 'http';
import { createServer as createTcpServer } from 'net';

let httpServer;
let publicServer;
let lanBase;
let publicBase;

beforeAll(async () => {
  // port public choisi d'abord pour pouvoir le passer via l'environnement
  publicServer = createTcpServer(socket => httpServer.emit('connection', socket));
  await new Promise(resolve => publicServer.listen(0, '127.0.0.1', resolve));
  process.env.PUBLIC_PORT = String(publicServer.address().port);
  const { lanOnly } = await import('./networkZone.js');

  const app = express();
  app.get('/device', lanOnly, (_req, res) => res.json({ ok: true }));
  app.get('/user', (_req, res) => res.json({ ok: true }));
  httpServer = createServer(app);
  await new Promise(resolve => httpServer.listen(0, '127.0.0.1', resolve));

  lanBase = `http://127.0.0.1:${httpServer.address().port}`;
  publicBase = `http://127.0.0.1:${publicServer.address().port}`;
});

afterAll(() => {
  publicServer?.close();
  httpServer?.close();
});

describe('zones réseau', () => {
  it('sert les routes appareils sur le listener LAN', async () => {
    expect((await fetch(`${lanBase}/device`)).status).toBe(200);
  });

  it('masque les routes appareils sur le listener public (tunnel)', async () => {
    expect((await fetch(`${publicBase}/device`)).status).toBe(404);
  });

  it('sert les routes utilisateur sur les deux listeners', async () => {
    expect((await fetch(`${publicBase}/user`)).status).toBe(200);
    expect((await fetch(`${lanBase}/user`)).status).toBe(200);
  });
});
