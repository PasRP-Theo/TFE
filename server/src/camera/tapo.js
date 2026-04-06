const TAPO_STREAM_PATHS = {
  main: 'stream1',
  sub: 'stream2',
};

function cleanHost(value) {
  const input = String(value || '').trim();
  if (!input) return '';

  try {
    const parsed = /^[a-z]+:/i.test(input) ? new URL(input) : new URL(`http://${input}`);
    return parsed.hostname || parsed.host || '';
  } catch {
    return input.replace(/^[a-z]+:\/\//i, '').replace(/\/.*$/, '').trim();
  }
}

function resolveStreamPath(value) {
  const input = String(value || 'main').trim().toLowerCase();
  if (input in TAPO_STREAM_PATHS) return TAPO_STREAM_PATHS[input];
  if (/^stream[12]$/i.test(input)) return input;
  return TAPO_STREAM_PATHS.main;
}

export function buildTapoRtspUrl({ host, username, password, stream = 'main' }) {
  const clean = cleanHost(host);
  const user = String(username || '').trim();
  const pass = String(password || '').trim();
  const streamPath = resolveStreamPath(stream);

  if (!clean || !user || !pass) {
    throw new Error('Hote, identifiant et mot de passe Tapo requis');
  }

  const url = new URL(`rtsp://${clean}:554/${streamPath}`);
  url.username = user;
  url.password = pass;
  return url.toString();
}

export function normalizeTapoCameraInput(body = {}) {
  const host = cleanHost(body.tapoHost || body.host || body.ip || '');
  const username = String(body.tapoUsername || body.username || '').trim();
  const password = String(body.tapoPassword || body.password || '').trim();
  const stream = String(body.tapoStream || body.stream || 'main').trim().toLowerCase();
  const model = String(body.model || body.cameraModel || 'Tapo C220').trim() || 'Tapo C220';

  if (!host) {
    return { ok: false, error: 'Adresse IP ou hote Tapo requis' };
  }
  if (!username || !password) {
    return { ok: false, error: 'Compte camera Tapo requis (identifiant et mot de passe)' };
  }

  return {
    ok: true,
    host,
    username,
    password,
    stream,
    model,
    rtspUrl: buildTapoRtspUrl({ host, username, password, stream }),
  };
}