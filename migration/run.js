/**
 * KRISHI - Breeder Daily Entry
 * Run: node migration/run.js
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
    console.log('\n🚀 Running KRISHI Breeder Migration...\n');

    await client.query('BEGIN');

    // ── 1. UNITS ────────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS units (
        id         SERIAL PRIMARY KEY,
        unit_name  VARCHAR(100) NOT NULL UNIQUE,
        location   VARCHAR(200),
        is_active  BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('  ✔ Table: units');

    // ── 2. FLOCKS (unit_id lives here only) ─────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS flocks (
        id                   SERIAL PRIMARY KEY,
        flock_no             VARCHAR(50)  NOT NULL UNIQUE,
        unit_id              INT REFERENCES units(id) ON DELETE SET NULL,
        breed                VARCHAR(100),
        start_date           DATE,
        male_opening_stock   INT NOT NULL DEFAULT 0,
        female_opening_stock INT NOT NULL DEFAULT 0,
        is_active            BOOLEAN DEFAULT TRUE,
        created_at           TIMESTAMP DEFAULT NOW(),
        updated_at           TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('  ✔ Table: flocks');

    // ── 3. BREEDER DAILY ENTRIES (flock_id only, no unit_id) ────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS breeder_daily_entries (
        id                    SERIAL PRIMARY KEY,

        flock_id              INT NOT NULL REFERENCES flocks(id) ON DELETE CASCADE,

        entry_date            DATE        NOT NULL,
        day_name              VARCHAR(20),
        week_label            VARCHAR(50),
        age_years             NUMERIC(5,2),

        male_opening_stock    INT NOT NULL DEFAULT 0,
        male_mortality        INT NOT NULL DEFAULT 0,
        male_culls_kill       INT NOT NULL DEFAULT 0,
        male_culls_sale       INT NOT NULL DEFAULT 0,
        male_transfer_in      INT NOT NULL DEFAULT 0,
        male_transfer_out     INT NOT NULL DEFAULT 0,
        male_sales            INT NOT NULL DEFAULT 0,
        male_closing_stock    INT GENERATED ALWAYS AS (
                                male_opening_stock
                                - male_mortality
                                - male_culls_kill
                                - male_culls_sale
                                - male_transfer_out
                                - male_sales
                                + male_transfer_in
                              ) STORED,

        female_opening_stock  INT NOT NULL DEFAULT 0,
        female_mortality      INT NOT NULL DEFAULT 0,
        female_culls_kill     INT NOT NULL DEFAULT 0,
        female_culls_sale     INT NOT NULL DEFAULT 0,
        female_transfer_in    INT NOT NULL DEFAULT 0,
        female_transfer_out   INT NOT NULL DEFAULT 0,
        female_sales          INT NOT NULL DEFAULT 0,
        female_closing_stock  INT GENERATED ALWAYS AS (
                                female_opening_stock
                                - female_mortality
                                - female_culls_kill
                                - female_culls_sale
                                - female_transfer_out
                                - female_sales
                                + female_transfer_in
                              ) STORED,

        feeding_notes         TEXT,
        shed_hygiene_notes    TEXT,
        body_weight_avg_kg    NUMERIC(8,3),
        egg_collections       INT NOT NULL DEFAULT 0,

        temp_min_celsius      NUMERIC(5,2),
        temp_max_celsius      NUMERIC(5,2),
        humidity_min          NUMERIC(5,2),
        humidity_max          NUMERIC(5,2),
        lighting_start        TIME,
        lighting_end          TIME,

        remarks               TEXT,

        created_at            TIMESTAMP DEFAULT NOW(),
        updated_at            TIMESTAMP DEFAULT NOW(),

        CONSTRAINT uq_flock_entry_date UNIQUE (flock_id, entry_date)
      );
    `);
    console.log('  ✔ Table: breeder_daily_entries (unit_id removed, closing_stock auto-calculated)');

    // ── 4. INDEXES ──────────────────────────────────────────────────────────
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_bde_flock_id   ON breeder_daily_entries(flock_id);
      CREATE INDEX IF NOT EXISTS idx_bde_entry_date ON breeder_daily_entries(entry_date);
    `);
    console.log('  ✔ Indexes created');

    // ── 5. SEED UNITS ────────────────────────────────────────────────────────
    await client.query(`
      INSERT INTO units (unit_name, location) VALUES
        ('Unit A', 'Farm Block 1'),
        ('Unit B', 'Farm Block 2'),
        ('Unit C', 'Farm Block 3')
      ON CONFLICT (unit_name) DO NOTHING;
    `);
    console.log('  ✔ Seeded: units (Unit A, Unit B, Unit C)');

    // ── 6. SEED FLOCKS ───────────────────────────────────────────────────────
    const flockData = [
      { flock_no: 'FL-001', unit: 'Unit A', breed: 'Ross 308',    start: '2023-01-10', male: 500, female: 4500 },
      { flock_no: 'FL-002', unit: 'Unit A', breed: 'Cobb 500',    start: '2023-03-15', male: 480, female: 4320 },
      { flock_no: 'FL-003', unit: 'Unit B', breed: 'Ross 308',    start: '2023-06-01', male: 520, female: 4680 },
      { flock_no: 'FL-004', unit: 'Unit B', breed: 'Hubbard F15', start: '2023-09-20', male: 460, female: 4140 },
      { flock_no: 'FL-005', unit: 'Unit C', breed: 'Cobb 500',    start: '2024-01-05', male: 510, female: 4590 },
      { flock_no: 'FL-006', unit: 'Unit C', breed: 'Ross 308',    start: '2024-04-12', male: 495, female: 4455 },
    ];

    for (const f of flockData) {
      const unitRes = await client.query(`SELECT id FROM units WHERE unit_name = $1`, [f.unit]);
      const unitId  = unitRes.rows[0].id;
      await client.query(`
        INSERT INTO flocks (flock_no, unit_id, breed, start_date, male_opening_stock, female_opening_stock)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (flock_no) DO UPDATE SET
          unit_id              = EXCLUDED.unit_id,
          male_opening_stock   = EXCLUDED.male_opening_stock,
          female_opening_stock = EXCLUDED.female_opening_stock;
      `, [f.flock_no, unitId, f.breed, f.start, f.male, f.female]);
    }
    console.log('  ✔ Seeded: flocks FL-001 to FL-006 with male/female opening stock');

    await client.query('COMMIT');

    console.log('\n✅ Migration completed successfully!');
    console.log('─────────────────────────────────────────────────────');
    console.log('  Tables : units, flocks, breeder_daily_entries');
    console.log('  Flocks : FL-001 → FL-006 with opening stock seeded');
    console.log('  Note   : closing_stock auto-calculated by PostgreSQL');
    console.log('  Note   : unit_id only on flocks table, not on entries');
    console.log('─────────────────────────────────────────────────────\n');

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
