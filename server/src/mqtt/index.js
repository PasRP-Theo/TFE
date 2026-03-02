import mqtt     from 'mqtt';
import { pool } from '../db/index.js';

let mqttClient   = null;
const wsClients  = new Set();

export function registerWsClient(ws) {
  wsClients.add(ws);
  ws.on('close', () => wsClients.delete(ws));
}

function broadcast(type, payload) {
  const msg = JSON.stringify({ type, payload, ts: Date.now() });
  wsClients.forEach(ws => { if (ws.readyState === 1) ws.send(msg); });
}

async function handleMessage(topic, message) {
  const value = parseFloat(message.toString().trim());
  if (isNaN(value)) return;

  try {
    const { rows } = await pool.query(
      'SELECT * FROM sensors WHERE mqtt_topic=$1 AND active=true',
      [topic]
    );
    const sensor = rows[0];
    if (!sensor) return;

    const status = sensor.alert_at !== null && value >= sensor.alert_at ? 'ALERTE' : 'OK';

    await pool.query(
      'INSERT INTO sensor_readings (sensor_id, value, status) VALUES ($1,$2,$3)',
      [sensor.id, value, status]
    );

    broadcast('sensor_update', {
      sensorId: sensor.id, sensorName: sensor.name,
      topic, value, unit: sensor.unit, status,
    });

    if (status === 'ALERTE') {
      broadcast('sensor_alert', {
        sensorId: sensor.id, sensorName: sensor.name,
        value, unit: sensor.unit, alertAt: sensor.alert_at,
      });
    }
  } catch (err) {
    console.error('❌ MQTT handler:', err.message);
  }
}

export function connectMQTT() {
  const opts = {
    clientId:        `surveillance_${Math.random().toString(16).slice(2, 8)}`,
    clean:           true,
    reconnectPeriod: 5000,
  };
  if (process.env.MQTT_USERNAME) opts.username = process.env.MQTT_USERNAME;
  if (process.env.MQTT_PASSWORD) opts.password = process.env.MQTT_PASSWORD;

  mqttClient = mqtt.connect(process.env.MQTT_BROKER, opts);

  mqttClient.on('connect', () => {
    console.log(`✅ MQTT connecté à ${process.env.MQTT_BROKER}`);
    mqttClient.subscribe('home/sensors/#', { qos: 1 }, err => {
      if (err) console.error('❌ Subscribe MQTT:', err.message);
      else     console.log('📡 Abonné à home/sensors/#');
    });
  });

  mqttClient.on('message',   handleMessage);
  mqttClient.on('error',     err => console.error('❌ MQTT:', err.message));
  mqttClient.on('reconnect', ()  => console.log('🔄 MQTT reconnexion...'));

  return mqttClient;
}

export function publish(topic, message) {
  if (mqttClient?.connected)
    mqttClient.publish(topic, String(message), { qos: 1 });
}