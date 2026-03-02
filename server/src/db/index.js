import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

export const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME     || 'aubepines',
  user:     process.env.DB_USER     || 'postgres',
  password: String(process.env.DB_PASSWORD || 'admin'),
});

pool.on('error', err => console.error('❌ PostgreSQL:', err.message));

export async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id         SERIAL PRIMARY KEY,
        email      VARCHAR(255) UNIQUE NOT NULL,
        password   VARCHAR(255) NOT NULL,
        role       VARCHAR(20)  DEFAULT 'user',
        created_at TIMESTAMP    DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS sensors (
        id         SERIAL PRIMARY KEY,
        name       VARCHAR(100) NOT NULL,
        type       VARCHAR(50)  NOT NULL,
        location   VARCHAR(100),
        mqtt_topic VARCHAR(200) UNIQUE,
        unit       VARCHAR(20),
        alert_at   FLOAT,
        active     BOOLEAN     DEFAULT true,
        created_at TIMESTAMP   DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS sensor_readings (
        id          SERIAL PRIMARY KEY,
        sensor_id   INT REFERENCES sensors(id) ON DELETE CASCADE,
        value       FLOAT       NOT NULL,
        status      VARCHAR(20) DEFAULT 'OK',
        recorded_at TIMESTAMP   DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS grocery_items (
        id         SERIAL PRIMARY KEY,
        name       VARCHAR(200) NOT NULL,
        category   VARCHAR(100),
        quantity   FLOAT       DEFAULT 1,
        unit       VARCHAR(30),
        checked    BOOLEAN     DEFAULT false,
        created_at TIMESTAMP   DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_readings_sensor
        ON sensor_readings(sensor_id, recorded_at DESC);
    `);
    console.log('✅ Base de données "aubepines" initialisée');
  } finally {
    client.release();
  }
}