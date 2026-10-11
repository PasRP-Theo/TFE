import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createHash } from 'crypto';
import { startFakeOnvifCamera, startFakeDiscoveryResponder } from '../../test/fakeOnvifCamera.js';
import {
  buildSecurityHeader, chooseProfile, connectOnvifCamera, discoverOnvifDevices,
  isCameraHostAllowed, isPrivateIpv4, parseProbeMatch, xmlText,
} from './onvif.js';

beforeAll(() => { process.env.ONVIF_ALLOW_LOOPBACK = '1'; });
afterAll(() => { delete process.env.ONVIF_ALLOW_LOOPBACK; });

const cameras = [];
afterEach(async () => { await Promise.all(cameras.splice(0).map(c => c.close())); });
const fakeCamera = async (options) => {
  const camera = await startFakeOnvifCamera(options);
  cameras.push(camera);
  return camera;
};

describe('hôtes autorisés', () => {
  it('réseau local uniquement', () => {
    expect(isPrivateIpv4('192.168.0.21')).toBe(true);
    expect(isPrivateIpv4('10.0.0.5')).toBe(true);
    expect(isPrivateIpv4('172.20.1.1')).toBe(true);
    expect(isPrivateIpv4('172.32.1.1')).toBe(false);
    expect(isPrivateIpv4('8.8.8.8')).toBe(false);
    expect(isPrivateIpv4('192.168.0.21.evil.com')).toBe(false);
  });

  it('boucle locale refusée hors tests', () => {
    delete process.env.ONVIF_ALLOW_LOOPBACK;
    try {
      expect(isCameraHostAllowed('127.0.0.1')).toBe(false);
    } finally {
      process.env.ONVIF_ALLOW_LOOPBACK = '1';
    }
  });
});

describe('WS-Security', () => {
  it('signe le mot de passe (jamais en clair) selon la norme', () => {
    const nonce = Buffer.from('0123456789abcdef');
    const created = '2026-10-11T10:00:00.000Z';
    const header = buildSecurityHeader('admin', 'p<a>ss', created, nonce);
    const expected = createHash('sha1').update(Buffer.concat([nonce, Buffer.from(created), Buffer.from('p<a>ss')])).digest('base64');
    expect(xmlText(header, 'Password')).toBe(expected);
    expect(header).not.toContain('p<a>ss');
    expect(xmlText(header, 'Nonce')).toBe(nonce.toString('base64'));
  });

  it('échappe un identifiant contenant des caractères XML', () => {
    expect(buildSecurityHeader('a&b<c', 'x')).toContain('<Username>a&amp;b&lt;c</Username>');
  });
});

describe('découverte', () => {
  const probeMatch = (xaddrs, scopes = '') => `<d:ProbeMatches><d:ProbeMatch><wsa:EndpointReference><wsa:Address>urn:uuid:1</wsa:Address></wsa:EndpointReference><d:Scopes>${scopes}</d:Scopes><d:XAddrs>${xaddrs}</d:XAddrs></d:ProbeMatch></d:ProbeMatches>`;

  it('lit le nom et le modèle annoncés', () => {
    const device = parseProbeMatch(
      probeMatch('http://192.168.0.21:8000/onvif/device_service', 'onvif://www.onvif.org/name/Jardin%20Nord onvif://www.onvif.org/hardware/RLC-510A'),
      '192.168.0.21'
    );
    expect(device).toMatchObject({ host: '192.168.0.21', xaddr: 'http://192.168.0.21:8000/onvif/device_service', name: 'Jardin Nord', hardware: 'RLC-510A' });
  });

  it('une réponse ne peut pas rediriger vers une autre machine', () => {
    const device = parseProbeMatch(probeMatch('http://203.0.113.9/onvif/device_service'), '192.168.0.21');
    expect(new URL(device.xaddr).hostname).toBe('192.168.0.21');
  });

  it('ignore une réponse sans adresse HTTP', () => {
    expect(parseProbeMatch(probeMatch('file:///etc/passwd'), '192.168.0.21')).toBeNull();
  });

  it('trouve une caméra qui répond à la sonde', async () => {
    const responder = await startFakeDiscoveryResponder({
      xaddrs: 'http://127.0.0.1:8000/onvif/device_service',
      scopes: ['onvif://www.onvif.org/hardware/C210'],
    });
    try {
      const devices = await discoverOnvifDevices({ timeoutMs: 300, targets: [responder.target], isAllowed: () => true });
      expect(devices).toEqual([expect.objectContaining({ host: '127.0.0.1', hardware: 'C210' })]);
      expect(responder.probes[0]).toContain('NetworkVideoTransmitter');
    } finally {
      await responder.close();
    }
  });

  it('ignore les réponses venant d\'adresses non autorisées', async () => {
    const responder = await startFakeDiscoveryResponder({ xaddrs: 'http://127.0.0.1/onvif/device_service' });
    try {
      const devices = await discoverOnvifDevices({ timeoutMs: 300, targets: [responder.target], isAllowed: () => false });
      expect(devices).toEqual([]);
    } finally {
      await responder.close();
    }
  });
});

describe('choix du profil', () => {
  it('le plus grand flux H.264', () => {
    const choice = chooseProfile([
      { token: 'a', encoding: 'H264', width: 640, height: 360 },
      { token: 'b', encoding: 'H265', width: 3840, height: 2160 },
      { token: 'c', encoding: 'H264', width: 1920, height: 1080 },
    ]);
    expect(choice).toEqual({ profile: expect.objectContaining({ token: 'c' }), transcode: false });
  });

  it('caméra 100 % H.265 : le plus grand flux, à convertir', () => {
    expect(chooseProfile([{ token: 'a', encoding: 'H265', width: 2560, height: 1440 }]).transcode).toBe(true);
  });
});

describe('connexion à une caméra', () => {
  it('récupère marque, modèle, profils et adresse RTSP (sans identifiants)', async () => {
    const camera = await fakeCamera();
    const result = await connectOnvifCamera({ host: '127.0.0.1', xaddr: camera.xaddr, username: 'admin', password: 'secret' });
    expect(result).toMatchObject({
      manufacturer: 'Reolink', model: 'RLC-510A', transcode: false,
      chosen: { token: '000', encoding: 'H264', width: 2560, height: 1920 },
      streamUrl: 'rtsp://127.0.0.1:554/h264Preview_01_main?a=1&b=2',
    });
    expect(result.profiles).toHaveLength(2);
    // le mot de passe n'a jamais circulé en clair
    expect(camera.requests.every(r => !r.body.includes('secret'))).toBe(true);
  });

  it('mot de passe faux : erreur « auth » explicite', async () => {
    const camera = await fakeCamera();
    await expect(connectOnvifCamera({ host: '127.0.0.1', xaddr: camera.xaddr, username: 'admin', password: 'faux' }))
      .rejects.toMatchObject({ code: 'auth' });
  });

  it('caméra à l\'heure fausse : la signature est recalée sur son horloge', async () => {
    const camera = await fakeCamera({ clockSkewMs: 3 * 3600 * 1000 });
    const result = await connectOnvifCamera({ host: '127.0.0.1', xaddr: camera.xaddr, username: 'admin', password: 'secret' });
    expect(result.model).toBe('RLC-510A');
  });

  it('adresses annoncées fausses (autre IP) : ramenées à la caméra choisie', async () => {
    const camera = await fakeCamera({ advertisedHost: '10.66.66.66' });
    const result = await connectOnvifCamera({ host: '127.0.0.1', xaddr: `http://127.0.0.1:${camera.port}/onvif/device_service`, username: 'admin', password: 'secret' });
    expect(new URL(result.streamUrl).hostname).toBe('127.0.0.1');
  });

  it('refuse une adresse hors du réseau local, sans aucune requête', async () => {
    await expect(connectOnvifCamera({ host: '8.8.8.8', username: 'admin', password: 'x' }))
      .rejects.toMatchObject({ code: 'invalid_host' });
  });

  it('aucun service ONVIF : erreur « not_onvif »', async () => {
    await expect(connectOnvifCamera({ host: '127.0.0.1', xaddr: 'http://127.0.0.1:9/onvif/device_service', username: 'a', password: 'b' }))
      .rejects.toMatchObject({ code: 'not_onvif' });
  }, 15_000);
});
