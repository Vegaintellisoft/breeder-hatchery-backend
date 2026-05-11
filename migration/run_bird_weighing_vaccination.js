/**
 * KRISHI - Bird Weighing + Vaccination Program Migration
 * Run: node migration/run_bird_weighing_vaccination.js
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
    console.log('\n🚀 Running Bird Weighing + Vaccination Migration...\n');
    await client.query('BEGIN');

    // ── 1. BIRD WEIGHING ENTRIES ──────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS bird_weighing (
        id                   SERIAL PRIMARY KEY,
        entry_date           DATE         NOT NULL,
        hen_type_id          INT          REFERENCES hen_types(id) ON DELETE SET NULL,
        gender               VARCHAR(10)  NOT NULL CHECK (gender IN ('male','female')),

        -- Subject Details
        actual_weight_g      NUMERIC(10,3) NOT NULL DEFAULT 0,
        sample_weight_g      NUMERIC(10,3) NOT NULL DEFAULT 0,
        sample_weight_pct    NUMERIC(8,4)  GENERATED ALWAYS AS (
                               CASE WHEN actual_weight_g > 0
                               THEN ROUND((sample_weight_g / actual_weight_g * 100)::NUMERIC, 4)
                               ELSE 0 END
                             ) STORED,

        -- Grading Schedule
        schedule             VARCHAR(200),
        std_dev_pct          NUMERIC(8,3)  NOT NULL DEFAULT 10.0,
        uniformity_pct       NUMERIC(8,3)  NOT NULL DEFAULT 80.0,

        created_at           TIMESTAMP    DEFAULT NOW(),
        updated_at           TIMESTAMP    DEFAULT NOW(),
        CONSTRAINT uq_bw_date_hentype_gender UNIQUE (entry_date, hen_type_id, gender)
      );
    `);
    console.log('  ✔ Table: bird_weighing (sample_weight_pct auto-calculated)');

    // ── 2. VACCINATION SCHEDULE ───────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS vaccination_schedule (
        id            SERIAL PRIMARY KEY,
        day_number    INT          NOT NULL,          -- e.g. 1, 3, 7, 9...
        vaccine_name  VARCHAR(200) NOT NULL,
        sub_label     VARCHAR(200),                  -- e.g. IB H120, ND B1
        category      VARCHAR(20)  NOT NULL DEFAULT 'vaccine'
                      CHECK (category IN ('vaccine','antibiotic','activity','grading','other')),
        is_active     BOOLEAN      DEFAULT TRUE,
        created_at    TIMESTAMP    DEFAULT NOW(),
        updated_at    TIMESTAMP    DEFAULT NOW()
      );
    `);
    console.log('  ✔ Table: vaccination_schedule');

    // ── 3. INDEXES ────────────────────────────────────────────────────────
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_bw_entry_date ON bird_weighing(entry_date);
      CREATE INDEX IF NOT EXISTS idx_bw_hen_type   ON bird_weighing(hen_type_id);
      CREATE INDEX IF NOT EXISTS idx_vs_day_number ON vaccination_schedule(day_number);
      CREATE INDEX IF NOT EXISTS idx_vs_name       ON vaccination_schedule(vaccine_name);
    `);
    console.log('  ✔ Indexes created');

    // ── 4. SEED VACCINATION SCHEDULE ─────────────────────────────────────
    await client.query(`
      INSERT INTO vaccination_schedule (day_number, vaccine_name, sub_label, category) VALUES
        (1,  'IB LV-1',       'IB H120',                    'vaccine'),
        (3,  'Antibiotic',    'Due: 3 - Jan - 00',          'antibiotic'),
        (7,  'ND L',          'ND B1',                      'vaccine'),
        (9,  'Debeak-1/2',    'Beak Debeaking, 3 days',     'activity'),
        (15, 'Grading-1/5',   'Grading 100%, 1/5',          'grading'),
        (24, 'IBDL - 2/2',    'IBD Intermediate plus',      'vaccine'),
        (26, 'IB - 1/3',      'IB MAS',                     'vaccine')
      ON CONFLICT DO NOTHING;
    `);
    console.log('  ✔ Seeded: vaccination_schedule (7 items)');

    await client.query('COMMIT');

    console.log('\n✅ Bird Weighing + Vaccination Migration completed!');
    console.log('──────────────────────────────────────────────────────────────');
    console.log('  Tables    : bird_weighing, vaccination_schedule');
    console.log('  Auto-calc : sample_weight_pct = (sample_weight_g / actual_weight_g) * 100');
    console.log('  Defaults  : std_dev_pct=10.0, uniformity_pct=80.0');
    console.log('  Unique    : entry_date + hen_type_id + gender');
    console.log('  Seeded    : 7 vaccination schedule items');
    console.log('  Status    : auto-calculated at query time based on flock start day');
    console.log('──────────────────────────────────────────────────────────────\n');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n❌ Migration failed:', err.message);
    console.error(err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
