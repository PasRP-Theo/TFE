/**
 * Sentys Demo — Simulateur de paquets de détection
 *
 * Lance avec : node simulate.js
 * Envoie des événements de mouvement toutes les N secondes.
 */

const SERVER = 'http://localhost:4000';
const INTERVAL_MS = 5000; // délai entre deux détections

// ── ANSI ─────────────────────────────────────────────────────────────────────
const R = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const RED = '\x1b[31m';
const MAGENTA = '\x1b[35m';

// ── Nœuds Pi fictifs ─────────────────────────────────────────────────────────
const NODES = [
  {
    deviceId: 'demo-pi-salon',
    name: 'Caméra Salon',
    location: 'Salon',
    host: '192.168.0.100',
    streamUrl: 'rtsp://192.168.0.100:8554/cam1',
    model: 'Raspberry Pi Zero 2W',
    source: 'pi-node',
  },
  {
    deviceId: 'demo-pi-entree',
    name: "Caméra Entrée",
    location: 'Entrée',
    host: '192.168.0.101',
    streamUrl: 'rtsp://192.168.0.101:8554/cam1',
    model: 'Raspberry Pi Zero 2W',
    source: 'pi-node',
  },
  {
    deviceId: 'demo-pi-jardin',
    name: 'Caméra Jardin',
    location: 'Jardin',
    host: '192.168.0.102',
    streamUrl: 'rtsp://192.168.0.102:8554/cam1',
    model: 'Raspberry Pi Zero 2W',
    source: 'pi-node',
  },
];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function fakePacket(node) {
  return {
    deviceId: node.deviceId,
    motion: true,
    detectedAt: new Date().toISOString(),
  };
}

async function post(path, body) {
  const res = await fetch(`${SERVER}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

// ── Announce all demo nodes ──────────────────────────────────────────────────
async function announceNodes() {
  console.log(`${CYAN}Enregistrement des nœuds Pi demo...${R}`);
  for (const node of NODES) {
    const { status } = await post('/api/camera-nodes/announce', node);
    const ok = status < 300;
    console.log(`  ${ok ? GREEN + '✓' : RED + '✗'}${R} ${node.name} (${node.deviceId}) — HTTP ${status}`);
  }
  console.log();
}

// ── Send motion event ─────────────────────────────────────────────────────────
let count = 0;

async function sendMotion() {
  const node = pick(NODES);
  const packet = fakePacket(node);
  count++;

  const ts = new Date().toLocaleTimeString('fr-FR');
  process.stdout.write(`${DIM}[${ts}]${R} ${BOLD}#${String(count).padStart(3,'0')}${R} Envoi → `);
  process.stdout.write(`${MAGENTA}${node.name}${R} `);

  const { status, data } = await post('/api/camera-nodes/motion', packet);
  const ok = status < 300;

  if (ok) {
    process.stdout.write(`${GREEN}✓ ${status}${R} `);
    const active = data?.node?.motionActive ? `${YELLOW}⚡ ACTIF${R}` : `${DIM}inactif${R}`;
    console.log(active);
  } else {
    console.log(`${RED}✗ ${status} — ${JSON.stringify(data)}${R}`);
  }

  if (ok) {
    console.log(`   ${DIM}Payload envoyé :${R} ${JSON.stringify(packet)}`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
process.stdout.write('\x1bc');
console.log(`${BOLD}${CYAN}╔══════════════════════════════════════════════════════════════╗${R}`);
console.log(`${BOLD}${CYAN}║          SENTYS — Simulateur de détection de mouvement       ║${R}`);
console.log(`${BOLD}${CYAN}╚══════════════════════════════════════════════════════════════╝${R}`);
console.log();
console.log(`${DIM}Serveur : ${SERVER}${R}`);
console.log(`${DIM}Intervalle : ${INTERVAL_MS / 1000}s entre chaque détection${R}`);
console.log();

await announceNodes();

console.log(`${GREEN}Simulation démarrée — Ctrl+C pour arrêter${R}`);
console.log(`${DIM}${'─'.repeat(65)}${R}`);

// première détection immédiate
await sendMotion();

const interval = setInterval(sendMotion, INTERVAL_MS);

process.on('SIGINT', () => {
  clearInterval(interval);
  console.log(`\n${CYAN}${count} paquets envoyés. Au revoir.${R}\n`);
  process.exit(0);
});
