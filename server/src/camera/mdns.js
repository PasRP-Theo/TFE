import multicastDns from 'multicast-dns';

const HTTP_SERVICE_NAME = '_http._tcp.local';
const DEFAULT_STREAM_PATH = '/stream';
const MDNS_TIMEOUT_MS = Number(process.env.CAMERA_MDNS_TIMEOUT || 2500);

function normalizeHost(value) {
  return String(value || '').trim().replace(/\.$/, '');
}

function normalizeTxtValue(value) {
  if (typeof value === 'string') return value;
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  if (Array.isArray(value)) return Buffer.from(value).toString('utf8');
  return String(value || '');
}

function parseTxtRecord(record) {
  const txt = {};
  const entries = Array.isArray(record?.data) ? record.data : [];

  for (const entry of entries) {
    const raw = normalizeTxtValue(entry);
    const separatorIndex = raw.indexOf('=');
    if (separatorIndex <= 0) continue;
    const key = raw.slice(0, separatorIndex).trim();
    const value = raw.slice(separatorIndex + 1).trim();
    if (key) txt[key] = value;
  }

  return txt;
}

function buildRecordIndex(records) {
  const index = new Map();

  for (const record of records) {
    const key = `${record.type}:${record.name}`;
    const list = index.get(key) || [];
    list.push(record);
    index.set(key, list);
  }

  return index;
}

function getFirstRecord(index, type, name) {
  const list = index.get(`${type}:${name}`) || [];
  return list[0] || null;
}

function ensurePathname(value) {
  const path = String(value || DEFAULT_STREAM_PATH).trim() || DEFAULT_STREAM_PATH;
  return path.startsWith('/') ? path : `/${path}`;
}

function looksLikeEsp32Camera({ instanceName, target, txt, port }) {
  const haystack = [
    instanceName,
    target,
    txt.name,
    txt.model,
    txt.deviceId,
    txt.path,
  ].join(' ').toLowerCase();

  if (/esp32|camera|cam|ai-thinker|aithinker|espressif/.test(haystack)) return true;
  if (Number(port) === 81) return true;
  return txt.path === '/stream';
}

export async function discoverMdnsEsp32Cameras({ timeoutMs = MDNS_TIMEOUT_MS } = {}) {
  const mdns = multicastDns();
  const packets = [];

  return new Promise((resolve) => {
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      mdns.removeListener('response', onResponse);
      mdns.removeListener('warning', onWarning);
      mdns.removeListener('error', onError);
      mdns.destroy();

      const records = packets.flatMap((packet) => [
        ...(Array.isArray(packet.answers) ? packet.answers : []),
        ...(Array.isArray(packet.additionals) ? packet.additionals : []),
      ]);
      const index = buildRecordIndex(records);
      const ptrRecords = records.filter((record) => record.type === 'PTR' && record.name === HTTP_SERVICE_NAME);
      const instances = [...new Set(ptrRecords.map((record) => record.data).filter(Boolean))];
      const devices = [];
      const seen = new Set();

      for (const instanceName of instances) {
        const srv = getFirstRecord(index, 'SRV', instanceName);
        const txt = parseTxtRecord(getFirstRecord(index, 'TXT', instanceName));
        const target = normalizeHost(srv?.data?.target || txt.host || '');
        const port = Number(srv?.data?.port || txt.port || 80);
        const addressRecord = target
          ? getFirstRecord(index, 'A', target) || getFirstRecord(index, 'AAAA', target)
          : null;
        const host = normalizeHost(addressRecord?.data || target);

        if (!host) continue;
        if (!looksLikeEsp32Camera({ instanceName, target: host, txt, port })) continue;

        const pathname = ensurePathname(txt.path || txt.streamPath || DEFAULT_STREAM_PATH);
        const deviceId = txt.deviceId || `mdns:${normalizeHost(instanceName)}`;
        const name = txt.name || normalizeHost(instanceName).replace('._http._tcp.local', '') || 'ESP32-CAM';
        const location = txt.location || '';
        const model = txt.model || 'ESP32-CAM';
        const streamUrl = `http://${host}:${port}${pathname}`;
        const dedupeKey = `${host}:${port}${pathname}`;

        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);

        devices.push({
          deviceId,
          name,
          host,
          streamUrl,
          location,
          model,
          source: 'mdns',
        });
      }

      resolve(devices);
    };

    const timer = setTimeout(finish, timeoutMs);

    const onResponse = (packet) => {
      packets.push(packet);
    };

    const onWarning = (warning) => {
      console.warn('[CAM MDNS]', warning?.message || warning);
    };

    const onError = (error) => {
      clearTimeout(timer);
      console.error('[CAM MDNS]', error);
      finish();
    };

    mdns.on('response', onResponse);
    mdns.on('warning', onWarning);
    mdns.on('error', onError);

    mdns.query({
      questions: [{ name: HTTP_SERVICE_NAME, type: 'PTR' }],
    });
  });
}
