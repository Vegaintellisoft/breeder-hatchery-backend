require('dotenv').config();
const pool = require('../src/config/db');

async function run() {
  const client = await pool.connect();
  try {
    console.log('\n🚀 Running Vaccination Schedule Migration...\n');
    await client.query('BEGIN');

    // ── 1. FLOCK VACCINATION SCHEDULE ─────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS flock_vaccination_schedule (
        id              SERIAL PRIMARY KEY,
        flock_no        VARCHAR(20) NOT NULL,
        plant_code      VARCHAR(20) NOT NULL,
        header_id       INT NOT NULL REFERENCES vaccination_program_header(id),
        detail_id       INT NOT NULL REFERENCES vaccination_program_detail(id),
        chick_start_date DATE NOT NULL,
        due_date        DATE NOT NULL,
        day_number      INT NOT NULL,
        status          VARCHAR(20) DEFAULT 'pending'
                        CHECK (status IN ('pending','vaccinated','skipped','no_vaccination','missed')),
        completed_at    TIMESTAMP,
        created_at      TIMESTAMP DEFAULT NOW(),
        updated_at      TIMESTAMP DEFAULT NOW(),
        UNIQUE (flock_no, detail_id, due_date)
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_fvs_flock_no   ON flock_vaccination_schedule(flock_no);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_fvs_due_date   ON flock_vaccination_schedule(due_date);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_fvs_plant_code ON flock_vaccination_schedule(plant_code);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_fvs_status     ON flock_vaccination_schedule(status);`);
    console.log('  ✔ Table: flock_vaccination_schedule');

    // ── 2. FLOCK VACCINATION LOG ───────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS flock_vaccination_log (
        id              SERIAL PRIMARY KEY,
        schedule_id     INT NOT NULL REFERENCES flock_vaccination_schedule(id),
        flock_no        VARCHAR(20) NOT NULL,
        plant_code      VARCHAR(20) NOT NULL,
        detail_id       INT NOT NULL REFERENCES vaccination_program_detail(id),
        due_date        DATE NOT NULL,
        day_number      INT NOT NULL,
        status          VARCHAR(20) NOT NULL
                        CHECK (status IN ('vaccinated','skipped','no_vaccination')),
        remarks         TEXT,
        done_date       DATE,
        supervisor_id   INT REFERENCES admin(id),
        created_at      TIMESTAMP DEFAULT NOW(),
        updated_at      TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_fvl_flock_no   ON flock_vaccination_log(flock_no);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_fvl_schedule_id ON flock_vaccination_log(schedule_id);`);
    console.log('  ✔ Table: flock_vaccination_log');

    await client.query('COMMIT');
    console.log(`
✅ Vaccination Schedule Migration Complete!
──────────────────────────────────────────────────────────
  Tables:
    flock_vaccination_schedule  — auto-generated per flock
    flock_vaccination_log       — actual vaccinated/not_vaccinated log
──────────────────────────────────────────────────────────
  Run next:
    npm run migrate:vaccination:schedule:generate
──────────────────────────────────────────────────────────`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration error:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
