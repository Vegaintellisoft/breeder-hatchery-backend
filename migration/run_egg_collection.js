/**
 * KRISHI - Egg Collection Migration
 * Run: node migration/run_egg_collection.js
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
    console.log('\n🚀 Running KRISHI Egg Collection Migration...\n');
    await client.query('BEGIN');

    // ── 1. EGG COLLECTIONS HEADER ─────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS egg_collections (
        id               SERIAL PRIMARY KEY,
        collection_date  DATE        NOT NULL,
        collection_id    VARCHAR(50) NOT NULL,
        schedule_time    TIME        NOT NULL,
        collected_time   TIME        NOT NULL,
        shed_count       INT         NOT NULL CHECK (shed_count BETWEEN 1 AND 12),
        created_at       TIMESTAMP   DEFAULT NOW(),
        updated_at       TIMESTAMP   DEFAULT NOW(),
        CONSTRAINT uq_collection_date_id UNIQUE (collection_date, collection_id)
      );
    `);
    console.log('  ✔ Table: egg_collections');

    // ── 2. EGG COLLECTION LINES (egg type grid per shed per line) ──────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS egg_collection_lines (
        id               SERIAL PRIMARY KEY,
        collection_id    INT NOT NULL REFERENCES egg_collections(id) ON DELETE CASCADE,
        shed_number      INT NOT NULL CHECK (shed_number BETWEEN 1 AND 12),
        line_number      INT NOT NULL CHECK (line_number BETWEEN 1 AND 12),
        broiler_egg      INT NOT NULL DEFAULT 0,
        crack_egg        INT NOT NULL DEFAULT 0,
        jumbo_egg        INT NOT NULL DEFAULT 0,
        table_egg        INT NOT NULL DEFAULT 0,
        waste_reject_egg INT NOT NULL DEFAULT 0,
        line_total       INT GENERATED ALWAYS AS (
                           broiler_egg + crack_egg + jumbo_egg + table_egg + waste_reject_egg
                         ) STORED,
        created_at       TIMESTAMP DEFAULT NOW(),
        updated_at       TIMESTAMP DEFAULT NOW(),
        CONSTRAINT uq_collection_shed_line UNIQUE (collection_id, shed_number, line_number)
      );
    `);
    console.log('  ✔ Table: egg_collection_lines (line_total auto-calculated)');

    // ── 3. EGG GRADING QUICK (one selected grade per shed) ─────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS egg_grading_quick (
        id               SERIAL PRIMARY KEY,
        collection_id    INT NOT NULL REFERENCES egg_collections(id) ON DELETE CASCADE,
        shed_number      INT NOT NULL CHECK (shed_number BETWEEN 1 AND 12),
        selected_grade   VARCHAR(20) NOT NULL,
        created_at       TIMESTAMP DEFAULT NOW(),
        updated_at       TIMESTAMP DEFAULT NOW(),
        CONSTRAINT uq_grading_collection_shed UNIQUE (collection_id, shed_number),
        CONSTRAINT chk_selected_grade CHECK (
          selected_grade IN (
            '7_to_8','9_to_10','10_to_11','11_to_1',
            '1_to_2','2_to_3','3_to_4','4_to_5_30',
            '7_to_8_b','cum'
          )
        )
      );
    `);
    console.log('  ✔ Table: egg_grading_quick (one selected_grade per shed)');

    // ── 4. EGG COLLECTION SUMMARY (manually entered, per shed per line) ────
    await client.query(`
      CREATE TABLE IF NOT EXISTS egg_collection_summary (
        id               SERIAL PRIMARY KEY,
        collection_id    INT NOT NULL REFERENCES egg_collections(id) ON DELETE CASCADE,
        shed_number      INT NOT NULL CHECK (shed_number BETWEEN 1 AND 12),
        line_number      INT NOT NULL CHECK (line_number BETWEEN 1 AND 12),
        hatching_egg     INT NOT NULL DEFAULT 0,
        table_egg        INT NOT NULL DEFAULT 0,
        jumbo_egg        INT NOT NULL DEFAULT 0,
        crack_egg        INT NOT NULL DEFAULT 0,
        waste_reject_egg INT NOT NULL DEFAULT 0,
        grand_total      INT GENERATED ALWAYS AS (
                           hatching_egg + table_egg + jumbo_egg + crack_egg + waste_reject_egg
                         ) STORED,
        created_at       TIMESTAMP DEFAULT NOW(),
        updated_at       TIMESTAMP DEFAULT NOW(),
        CONSTRAINT uq_summary_collection_shed_line UNIQUE (collection_id, shed_number, line_number)
      );
    `);
    console.log('  ✔ Table: egg_collection_summary (grand_total auto-calculated)');

    // ── 5. INDEXES ─────────────────────────────────────────────────────────
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_ecl_collection_id ON egg_collection_lines(collection_id);
      CREATE INDEX IF NOT EXISTS idx_ecl_shed          ON egg_collection_lines(shed_number);
      CREATE INDEX IF NOT EXISTS idx_egq_collection_id ON egg_grading_quick(collection_id);
      CREATE INDEX IF NOT EXISTS idx_ecs_collection_id ON egg_collection_summary(collection_id);
      CREATE INDEX IF NOT EXISTS idx_ecs_shed          ON egg_collection_summary(shed_number);
      CREATE INDEX IF NOT EXISTS idx_ec_date           ON egg_collections(collection_date);
    `);
    console.log('  ✔ Indexes created');

    await client.query('COMMIT');

    console.log('\n✅ Egg Collection Migration completed!');
    console.log('───────────────────────────────────────────────────────────────────');
    console.log('  Tables  : egg_collections');
    console.log('            egg_collection_lines   (broiler/crack/jumbo/table/waste per line)');
    console.log('            egg_grading_quick      (one selected grade per shed)');
    console.log('            egg_collection_summary (hatching/table/jumbo/crack/waste per line)');
    console.log('  Note    : line_total and grand_total auto-calculated by PostgreSQL');
    console.log('  Grades  : 7_to_8 | 9_to_10 | 10_to_11 | 11_to_1 | 1_to_2');
    console.log('            2_to_3 | 3_to_4  | 4_to_5_30 | 7_to_8_b | cum');
    console.log('───────────────────────────────────────────────────────────────────\n');

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
