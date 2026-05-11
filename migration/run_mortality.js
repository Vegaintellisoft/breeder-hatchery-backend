/**
 * KRISHI - Mortality & Cull Kill Migration
 * Run: node migration/run_mortality.js
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
    console.log('\n🚀 Running KRISHI Mortality & Cull Kill Migration...\n');
    await client.query('BEGIN');

    // ── 1. HEN TYPES (fixed dropdown options) ────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS hen_types (
        id         SERIAL PRIMARY KEY,
        type_name  VARCHAR(100) NOT NULL UNIQUE,
        is_active  BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('  ✔ Table: hen_types');

    // ── 2. MORTALITY ENTRIES (main form) ─────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS mortality_entries (
        id                SERIAL PRIMARY KEY,
        entry_date        DATE        NOT NULL,
        hen_type_id       INT         REFERENCES hen_types(id) ON DELETE SET NULL,

        -- Items section
        shed_no           VARCHAR(50),
        part_row_no       VARCHAR(50),
        line_no           VARCHAR(50),
        no_of_birds       INT         NOT NULL DEFAULT 0,
        male_count        INT         NOT NULL DEFAULT 0,
        female_count      INT         NOT NULL DEFAULT 0,
        reason            TEXT,

        -- Reporting Schedule
        morning           INT         NOT NULL DEFAULT 0,
        afternoon         INT         NOT NULL DEFAULT 0,
        evening           INT         NOT NULL DEFAULT 0,
        total             INT GENERATED ALWAYS AS (morning + afternoon + evening) STORED,

        created_at        TIMESTAMP   DEFAULT NOW(),
        updated_at        TIMESTAMP   DEFAULT NOW(),
        CONSTRAINT uq_mortality_date UNIQUE (entry_date, shed_no, hen_type_id)
      );
    `);
    console.log('  ✔ Table: mortality_entries (total auto-calculated)');

    // ── 3. MORTALITY IMAGES (multiple images per upload field) ────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS mortality_images (
        id            SERIAL PRIMARY KEY,
        mortality_id  INT         NOT NULL REFERENCES mortality_entries(id) ON DELETE CASCADE,
        field_type    VARCHAR(50) NOT NULL,
        -- field_type values:
        --   'collection_photo'
        --   'dead_bird_collection_bin'
        --   'hygiene_dead_bird_disposal'
        --   'mortality_dip_ms_solution'
        --   'mortality_pit_fly_control'
        --   'mortality_pit_odour_control'
        file_name     VARCHAR(255) NOT NULL,
        file_path     VARCHAR(500) NOT NULL,   -- path on server disk
        file_size     INT,                     -- bytes
        mime_type     VARCHAR(100),
        created_at    TIMESTAMP    DEFAULT NOW(),
        CONSTRAINT chk_field_type CHECK (
          field_type IN (
            'collection_photo',
            'dead_bird_collection_bin',
            'hygiene_dead_bird_disposal',
            'mortality_dip_ms_solution',
            'mortality_pit_fly_control',
            'mortality_pit_odour_control'
          )
        )
      );
    `);
    console.log('  ✔ Table: mortality_images (multiple images per field_type)');

    // ── 4. INDEXES ────────────────────────────────────────────────────────
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_me_entry_date   ON mortality_entries(entry_date);
      CREATE INDEX IF NOT EXISTS idx_me_hen_type     ON mortality_entries(hen_type_id);
      CREATE INDEX IF NOT EXISTS idx_mi_mortality_id ON mortality_images(mortality_id);
      CREATE INDEX IF NOT EXISTS idx_mi_field_type   ON mortality_images(field_type);
    `);
    console.log('  ✔ Indexes created');

    // ── 5. SEED HEN TYPES ─────────────────────────────────────────────────
    await client.query(`
      INSERT INTO hen_types (type_name) VALUES
        ('Broiler'),
        ('Breeder'),
        ('Layer'),
        ('Pullet'),
        ('Cockerel'),
        ('Rooster')
      ON CONFLICT (type_name) DO NOTHING;
    `);
    console.log('  ✔ Seeded: hen_types (6 types)');

    await client.query('COMMIT');

    console.log('\n✅ Mortality Migration completed!');
    console.log('──────────────────────────────────────────────────────────────');
    console.log('  Tables  : hen_types, mortality_entries, mortality_images');
    console.log('  Hen Types: Broiler, Breeder, Layer, Pullet, Cockerel, Rooster');
    console.log('  Images  : stored on disk, path saved in DB');
    console.log('  Fields  : collection_photo | dead_bird_collection_bin');
    console.log('            hygiene_dead_bird_disposal | mortality_dip_ms_solution');
    console.log('            mortality_pit_fly_control | mortality_pit_odour_control');
    console.log('  Note    : total (morning+afternoon+evening) auto-calculated');
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

// ── PATCH: Add male/female columns to mortality_entries ───────────────────
// Run this if table already exists:
// ALTER TABLE mortality_entries ADD COLUMN IF NOT EXISTS male_count INT NOT NULL DEFAULT 0;
// ALTER TABLE mortality_entries ADD COLUMN IF NOT EXISTS female_count INT NOT NULL DEFAULT 0;
