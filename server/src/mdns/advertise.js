import multicastDns from 'multicast-dns';
import { networkInterfaces } from 'os';

const HOSTNAME   = 'sentys.local';
const SERVER_PORT = Number(process.env.PORT || 4000);

function getLocalIpv4() {
  const ifaces = networkInterfaces();
  for (const iface of Object.values(ifaces).flat()) {
    if (iface.family === 'IPv4' && !iface.internal) return iface.address;
  }
  return '127.0.0.1';
}

export function startMdnsAdvertisement() {
  const mdns = multicastDns();
  const ip   = getLocalIpv4();

  mdns.on('query', (query) => {
    const relevant = (query.questions || []).some(
      q => (q.name === HOSTNAME || q.name === 'sentys') && ['A', 'ANY'].includes(q.type)
    );
    if (!relevant) return;

    mdns.respond({
      answers: [
        { type: 'A',   name: HOSTNAME, ttl: 300, data: ip },
        { type: 'SRV', name: `sentys._http._tcp.local`, ttl: 300,
          data: { target: HOSTNAME, port: SERVER_PORT, priority: 0, weight: 0 } },
        { type: 'TXT', name: `sentys._http._tcp.local`, ttl: 300,
          data: [`version=1`, `port=${SERVER_PORT}`] },
        { type: 'PTR', name: `_sentys._tcp.local`, ttl: 300,
          data: `sentys._sentys._tcp.local` },
      ],
    });
  });

  mdns.on('error', (err) => {
    console.warn('[MDNS ADVERTISE] Avertissement :', err.message);
  });

  console.log(`[MDNS] Serveur annoncé : ${HOSTNAME} → ${ip}:${SERVER_PORT}`);
  return mdns;
}
