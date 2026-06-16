/**
 * Sentys Demo — Moniteur temps réel des paquets de détection
 *
 * Lance avec : node monitor.js
 * Nécessite : npm install (dans ce dossier)
 */

import { io } from 'socket.io-client';

const SERVER = 'http://localhost:4000';
const USERNAME = 'root';
const PASSWORD = 'root';

// ── ANSI colors ──────────────────────────────────────────────────────────────
const R = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const MAGENTA = '\x1b[35m';
const CYAN = '\x1b[36m';
const WHITE = '\x1b[37m';
const BG_RED = '\x1b[41m';
const BG_YELLOW = '\x1b[43m';
const BG_BLUE = '\x1b[44m';

function clear() { process.stdout.write('\x1bc'); }

function header() {
  console.log(`${BOLD}${CYAN}╔══════════════════════════════════════════════════════════════╗${R}`);
  console.log(`${BOLD}${CYAN}║          SENTYS — Moniteur de détection en temps réel        ║${R}`);
  console.log(`${BOLD}${CYAN}╚══════════════════════════════════════════════════════════════╝${R}`);
  console.log();
}

function levelColor(level) {
  switch ((level || '').toLowerCase()) {
    case 'critical': return `${BG_RED}${WHITE}${BOLD} CRITIQUE ${R}`;
    case 'warning':  return `${BG_YELLOW}        ${BOLD} ATTENTION ${R}`;
    default:         return `${BG_BLUE}${WHITE}${BOLD} INFO     ${R}`;
  }
}

function typeIcon(type) {
  switch ((type || '').toLowerCase()) {
    case 'person':  return `${RED}${BOLD}👤 PERSONNE${R}`;
    case 'animal':  return `${YELLOW}${BOLD}🐾 ANIMAL  ${R}`;
    case 'vehicle': return `${BLUE}${BOLD}🚗 VEHICULE${R}`;
    default:        return `${MAGENTA}${BOLD}📡 MOUVEMENT${R}`;
  }
}

let packetCount = 0;

function printAlert(alert) {
  packetCount++;
  const ts = new Date(alert.created_at || Date.now()).toLocaleTimeString('fr-FR');
  const conf = alert.confidence > 0 ? `${Math.round(alert.confidence * 100)}%` : '—';

  console.log(`${DIM}─────────────────────────────────────────────────────────────${R}`);
  console.log(`${BOLD}[#${String(packetCount).padStart(3, '0')}]${R}  ${ts}  ${levelColor(alert.level)}  ${typeIcon(alert.type)}`);
  console.log();
  console.log(`  ${BOLD}Titre      :${R} ${alert.title || '—'}`);
  console.log(`  ${BOLD}Message    :${R} ${alert.message || '—'}`);
  console.log(`  ${BOLD}Caméra     :${R} ${alert.camera_name || alert.device_id || '—'}`);
  console.log(`  ${BOLD}Confiance  :${R} ${conf}`);
  console.log(`  ${BOLD}Dédupe key :${R} ${DIM}${alert.dedupe_key || '—'}${R}`);
  console.log();
}

// ── Login ────────────────────────────────────────────────────────────────────
async function login() {
  const res = await fetch(`${SERVER}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`Login échoué (${res.status})`);
  const data = await res.json();
  return data.token;
}

// ── Main ─────────────────────────────────────────────────────────────────────
clear();
header();
console.log(`${CYAN}Connexion à ${SERVER}...${R}`);

let token;
try {
  token = await login();
  console.log(`${GREEN}${BOLD}✓ Authentifié (${USERNAME})${R}`);
} catch (err) {
  console.error(`${RED}✗ ${err.message}${R}`);
  process.exit(1);
}

const socket = io(SERVER, {
  auth: { token },
  transports: ['websocket'],
});

socket.on('connect', () => {
  console.log(`${GREEN}✓ Socket.IO connecté (${socket.id})${R}`);
  console.log();
  console.log(`${DIM}En attente de paquets de détection... (Ctrl+C pour quitter)${R}`);
  console.log();
});

socket.on('new_alert', (alert) => {
  printAlert(alert);
});

socket.on('connect_error', (err) => {
  console.error(`${RED}✗ Erreur Socket.IO : ${err.message}${R}`);
});

socket.on('disconnect', (reason) => {
  console.log(`${YELLOW}⚠ Déconnecté : ${reason}${R}`);
});

process.on('SIGINT', () => {
  console.log(`\n${CYAN}${packetCount} paquets reçus. Au revoir.${R}\n`);
  process.exit(0);
});
