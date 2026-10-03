export function getHostFromStreamUrl(streamUrl) {
  const value = String(streamUrl || '').trim();
  if (!value) return '';
  try {
    const parsed = /^[a-z]+:/i.test(value) ? new URL(value) : new URL(`http://${value}`);
    return parsed.hostname || parsed.host || '';
  } catch {
    return '';
  }
}

export function maskStreamUrl(streamUrl) {
  const value = String(streamUrl || '').trim();
  if (!value) return value;
  try {
    const parsed = /^[a-z]+:/i.test(value) ? new URL(value) : new URL(`http://${value}`);
    if (parsed.username) parsed.username = '***';
    if (parsed.password) parsed.password = '***';
    return parsed.toString();
  } catch {
    return value.replace(/\/\/([^:@/]+):([^@/]+)@/g, '//***:***@');
  }
}

// retire user:pass@ d'une URL de flux (identifiants jamais stockés hors table cameras)
export function stripStreamCredentials(streamUrl) {
  const value = String(streamUrl || '').trim();
  if (!value) return value;
  try {
    const parsed = /^[a-z]+:/i.test(value) ? new URL(value) : new URL(`http://${value}`);
    if (!parsed.username && !parsed.password) return value;
    parsed.username = '';
    parsed.password = '';
    return parsed.toString();
  } catch {
    return value.replace(/\/\/[^/@\s]+@/g, '//');
  }
}
