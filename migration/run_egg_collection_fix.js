/**
 * Fix egg collection v2 tables — add missing columns + UNIQUE constraints
 * Run: npm run migrate:egg:fix
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../src/config/db');

async function run() {
  const client = await pool.connect();
  try {
    console.log('\n🚀 Fixing egg collection v2 tables...\n');
    await client.query('BEGIN');

    // ── egg_collection_header ─────────────────────────────────────────────
    await client.query(`
      ALTER TABLE egg_collection_header
        ADD COLUMN IF NOT EXISTS age_days    INT,
        ADD COLUMN IF NOT EXISTS season      VARCHAR(50),
        ADD COLUMN IF NOT EXISTS entered_by  INT REFERENCES admin(id),
        ADD COLUMN IF NOT EXISTS sap_synced  BOOLEAN   DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS sap_synced_at TIMESTAMP DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMP DEFAULT NOW()
    `);
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE egg_collection_header
          ADD CONSTRAINT uq_egg_header_flock_date UNIQUE (flock_no, collection_date);
      EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL;
      END $$
    `);
    console.log('  ✔ egg_collection_header');

    // ── egg_collection_slots ──────────────────────────────────────────────
    await client.query(`
      ALTER TABLE egg_collection_slots
        ADD COLUMN IF NOT EXISTS egg_weight_time VARCHAR(20),
        ADD COLUMN IF NOT EXISTS updated_at      TIMESTAMP DEFAULT NOW()
    `);
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE egg_collection_slots
          ADD CONSTRAINT uq_egg_slots_header_time UNIQUE (header_id, schedule_time);
      EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL;
      END $$
    `);
    console.log('  ✔ egg_collection_slots');

    // ── egg_collection_rows ───────────────────────────────────────────────
    await client.query(`
      ALTER TABLE egg_collection_rows
        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()
    `);
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE egg_collection_rows
          ADD CONSTRAINT uq_egg_rows_slot_shed_part_line UNIQUE (slot_id, shed_id, part_id, line_id);
      EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL;
      END $$
    `);
    console.log('  ✔ egg_collection_rows');

    // ── egg_collection_summary_v2 — add missing columns ───────────────────
    await client.query(`
      ALTER TABLE egg_collection_summary_v2
        ADD COLUMN IF NOT EXISTS summary_type VARCHAR(10) NOT NULL DEFAULT 'slot',
        ADD COLUMN IF NOT EXISTS schedule_time VARCHAR(20),
        ADD COLUMN IF NOT EXISTS updated_at   TIMESTAMP DEFAULT NOW()
    `);
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE egg_collection_summary_v2
          ADD CONSTRAINT uq_egg_summary_header_slot UNIQUE (header_id, slot_id);
      EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL;
      END $$
    `);
    console.log('  ✔ egg_collection_summary_v2  (added summary_type, schedule_time)');

    // ── Indexes ───────────────────────────────────────────────────────────
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ech_flock_date ON egg_collection_header(flock_no, collection_date)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ecs_header     ON egg_collection_slots(header_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ecr_slot       ON egg_collection_rows(slot_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ecr_header     ON egg_collection_rows(header_id)`);
    console.log('  ✔ Indexes');

    await client.query('COMMIT');
    console.log('\n✅ Egg collection fix complete! Now run: npm start\n');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error:', err.message);
    process.exit(1);
  } finally {
    client.release();
    process.exit(0);
  }
}
run();
