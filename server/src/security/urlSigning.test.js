import { describe, it, expect, vi, afterEach } from 'vitest';
import { signRecordingUrl, verifyRecordingRequest, signLivePrefix, verifyLiveCapability } from './urlSigning.js';

function parse(url) {
  const [pathPart, queryPart] = url.split('?');
  return { path: decodeURIComponent(pathPart), query: Object.fromEntries(new URLSearchParams(queryPart)) };
}

describe('URLs signées des enregistrements', () => {
  afterEach(() => vi.useRealTimers());

  it('accepte une URL valide et renvoie l\'utilisateur', () => {
    const { path, query } = parse(signRecordingUrl('/recordings/3/2026-10-03T10-00-00.mp4', 7));
    expect(verifyRecordingRequest(path, query)).toMatchObject({ userId: '7' });
  });

  it('refuse un autre fichier avec la même signature', () => {
    const { query } = parse(signRecordingUrl('/recordings/3/a.mp4', 7));
    expect(verifyRecordingRequest('/recordings/3/b.mp4', query)).toBeNull();
  });

  it('refuse un uid modifié', () => {
    const { path, query } = parse(signRecordingUrl('/recordings/3/a.mp4', 7));
    expect(verifyRecordingRequest(path, { ...query, uid: '1' })).toBeNull();
  });

  it('refuse une URL expirée', () => {
    vi.useFakeTimers();
    const { path, query } = parse(signRecordingUrl('/recordings/3/a.mp4', 7, 60));
    vi.advanceTimersByTime(61_000);
    expect(verifyRecordingRequest(path, query)).toBeNull();
  });

  it('refuse une requête sans signature', () => {
    expect(verifyRecordingRequest('/recordings/3/a.mp4', {})).toBeNull();
  });
});

describe('préfixe live signé', () => {
  it('est lié à la caméra', () => {
    const prefix = signLivePrefix(2, 5);
    const capability = prefix.split('/')[3];
    expect(verifyLiveCapability(capability, 2)).toMatchObject({ userId: '5' });
    expect(verifyLiveCapability(capability, 3)).toBeNull();
  });

  it('refuse une capacité malformée', () => {
    expect(verifyLiveCapability('abc', 2)).toBeNull();
    expect(verifyLiveCapability('', 2)).toBeNull();
  });
});
