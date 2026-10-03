import { describe, it, expect } from 'vitest';
import {
  splitStreamCredentials, encryptCameraCredentials, resolveCameraSourceUrl, publicCameraFields,
} from './credentials.js';

describe('identifiants RTSP', () => {
  it('sépare l\'URL et les identifiants (caractères spéciaux décodés)', () => {
    expect(splitStreamCredentials('rtsp://admin:p%40ss%3Aw0rd@192.168.10.20:554/h264Preview_01_sub')).toEqual({
      cleanUrl: 'rtsp://192.168.10.20:554/h264Preview_01_sub',
      username: 'admin',
      password: 'p@ss:w0rd',
    });
  });

  it('laisse une URL sans identifiants intacte', () => {
    expect(splitStreamCredentials('rtsp://192.168.0.30:8554/cam1')).toEqual({
      cleanUrl: 'rtsp://192.168.0.30:8554/cam1', username: '', password: '',
    });
  });

  it('reconstruit l\'URL complète uniquement à partir du chiffré', () => {
    const camera = {
      id: 5,
      rtsp_url: 'rtsp://192.168.10.20:554/h264Preview_01_sub',
      credentials_enc: encryptCameraCredentials(5, { username: 'admin', password: 'p@ss:w0rd' }),
    };
    expect(camera.credentials_enc).not.toContain('admin');
    expect(resolveCameraSourceUrl(camera)).toBe('rtsp://admin:p%40ss%3Aw0rd@192.168.10.20:554/h264Preview_01_sub');
  });

  it('refuse un chiffré déplacé vers une autre caméra (AAD)', () => {
    const credentials_enc = encryptCameraCredentials(5, { username: 'a', password: 'b' });
    expect(() => resolveCameraSourceUrl({ id: 6, rtsp_url: 'rtsp://x/y', credentials_enc })).toThrow();
  });

  it('n\'expose jamais le chiffré', () => {
    const view = publicCameraFields({ id: 1, name: 'Entrée', credentials_enc: 'v1.x' });
    expect(view.credentials_enc).toBeUndefined();
    expect(view.hasCredentials).toBe(true);
  });
});
