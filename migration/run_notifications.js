/**
 * KRISHI - Notifications Migration
 * Run: node migration/run_notifications.js
 */

const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     process.env.DB_PORT     || 5432,
  database: process.env.DB_NAME     || 'krishi_db',
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});

async function run() {
  const client = await pool.connect();
  try {
    console.log('\n🚀 Running Notifications Migration...\n');
    await client.query('BEGIN');

    // ── 1. FARM CONFIG (stores current_day / flock start date) ───────────
    // Cron uses this to know what day the flock is on
    await client.query(`
      CREATE TABLE IF NOT EXISTS farm_config (
        id              SERIAL PRIMARY KEY,
        config_key      VARCHAR(100) NOT NULL UNIQUE,
        config_value    VARCHAR(500) NOT NULL,
        updated_at      TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('  ✔ Table: farm_config');

    // Seed flock_start_date — update this when a new flock starts
    await client.query(`
      INSERT INTO farm_config (config_key, config_value)
      VALUES ('flock_start_date', CURRENT_DATE::TEXT)
      ON CONFLICT (config_key) DO NOTHING;
    `);
    console.log('  ✔ Seeded: flock_start_date = today');

    // ── 2. NOTIFICATIONS TABLE ────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id              SERIAL PRIMARY KEY,
        type            VARCHAR(50)  NOT NULL DEFAULT 'vaccination',
        title           VARCHAR(200) NOT NULL,
        message         TEXT         NOT NULL,
        vaccine_id      INT          REFERENCES vaccination_schedule(id) ON DELETE SET NULL,
        vaccine_name    VARCHAR(200),
        day_number      INT,
        status          VARCHAR(20)  NOT NULL,
        -- status: 'due_today' | 'overdue'
        notif_date      DATE         NOT NULL,   -- date this notification was generated
        is_read         BOOLEAN      DEFAULT FALSE,
        created_at      TIMESTAMP    DEFAULT NOW()
      );
    `);
    console.log('  ✔ Table: notifications');

    // ── 3. INDEXES ────────────────────────────────────────────────────────
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_notif_date    ON notifications(notif_date);
      CREATE INDEX IF NOT EXISTS idx_notif_is_read ON notifications(is_read);
      CREATE INDEX IF NOT EXISTS idx_notif_type    ON notifications(type);
    `);
    console.log('  ✔ Indexes created');

    await client.query('COMMIT');

    console.log('\n✅ Notifications Migration completed!');
    console.log('──────────────────────────────────────────────────────────────');
    console.log('  Tables  : farm_config, notifications');
    console.log('  Cron    : runs daily at 8:00 AM');
    console.log('  Trigger : due_today + overdue vaccines → saved to DB');
    console.log('  App     : polls GET /api/notifications to show alerts');
    console.log('  Note    : update flock_start_date in farm_config when flock starts');
    console.log('──────────────────────────────────────────────────────────────\n');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n❌ Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
