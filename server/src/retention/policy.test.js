import { describe, it, expect, afterEach, vi } from 'vitest';
import { getRetentionPolicy } from './policy.js';

const KEYS = ['RECORDINGS_RETENTION_DAYS', 'ALERTS_RETENTION_DAYS', 'AUDIT_RETENTION_DAYS', 'MOTION_EVENTS_RETENTION_DAYS'];

afterEach(() => {
  for (const key of KEYS) delete process.env[key];
  vi.restoreAllMocks();
});

describe('politique de conservation', () => {
  it('applique les valeurs par défaut documentées', () => {
    expect(getRetentionPolicy()).toMatchObject({ recordingsDays: 30, alertsDays: 90, motionEventsDays: 30, auditDays: 365 });
  });

  it('plafonne les images à 30 jours (loi caméras)', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    process.env.RECORDINGS_RETENTION_DAYS = '90';
    expect(getRetentionPolicy().recordingsDays).toBe(30);
  });

  it('accepte une durée plus courte', () => {
    process.env.RECORDINGS_RETENTION_DAYS = '7';
    expect(getRetentionPolicy().recordingsDays).toBe(7);
  });

  it('ignore une valeur invalide', () => {
    process.env.AUDIT_RETENTION_DAYS = 'abc';
    expect(getRetentionPolicy().auditDays).toBe(365);
  });
});
