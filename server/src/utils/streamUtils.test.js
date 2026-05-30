import { describe, it, expect } from 'vitest';
import { getHostFromStreamUrl, maskStreamUrl } from './streamUtils.js';

describe('getHostFromStreamUrl', () => {
  it('extrait le hostname d\'une URL RTSP', () => {
    expect(getHostFromStreamUrl('rtsp://192.168.1.10:8554/cam1')).toBe('192.168.1.10');
  });

  it('extrait le hostname d\'une URL HTTP', () => {
    expect(getHostFromStreamUrl('http://monserveur.local/stream')).toBe('monserveur.local');
  });

  it('gère une adresse IP sans protocole', () => {
    expect(getHostFromStreamUrl('192.168.1.5')).toBe('192.168.1.5');
  });

  it('retourne une chaîne vide si l\'URL est vide', () => {
    expect(getHostFromStreamUrl('')).toBe('');
  });

  it('retourne une chaîne vide si l\'URL est null', () => {
    expect(getHostFromStreamUrl(null)).toBe('');
  });

  it('retourne une chaîne vide si l\'URL est undefined', () => {
    expect(getHostFromStreamUrl(undefined)).toBe('');
  });

  it('extrait le hostname d\'une URL avec credentials', () => {
    expect(getHostFromStreamUrl('rtsp://admin:pass@192.168.1.20:8554/live')).toBe('192.168.1.20');
  });
});

describe('maskStreamUrl', () => {
  it('masque login et mot de passe dans une URL RTSP', () => {
    const result = maskStreamUrl('rtsp://admin:secret@192.168.1.10:8554/cam1');
    expect(result).not.toContain('secret');
    expect(result).not.toContain('admin');
    expect(result).toContain('***');
    expect(result).toContain('192.168.1.10');
  });

  it('laisse une URL sans credentials inchangée', () => {
    const url = 'rtsp://192.168.1.10:8554/cam1';
    expect(maskStreamUrl(url)).toBe(url);
  });

  it('masque uniquement le mot de passe si seul le password est présent', () => {
    const result = maskStreamUrl('rtsp://user:monmotdepasse@192.168.1.1/stream');
    expect(result).not.toContain('monmotdepasse');
  });

  it('retourne une chaîne vide si l\'entrée est vide', () => {
    expect(maskStreamUrl('')).toBe('');
  });

  it('retourne la valeur brute si l\'URL est non parsable', () => {
    const malformed = 'not-a-url://admin:pass@somewhere';
    const result = maskStreamUrl(malformed);
    expect(typeof result).toBe('string');
  });
});
