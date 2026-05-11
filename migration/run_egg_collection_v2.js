require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../src/config/db');

async function run() {
  const client = await pool.connect();
  try {
    console.log('\n🚀 Running Egg Collection v2 Migration...\n');
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS egg_collection_header (
        id              SERIAL PRIMARY KEY,
        flock_no        VARCHAR(20) NOT NULL,
        plant_code      VARCHAR(20) NOT NULL,
        collection_date DATE        NOT NULL,
        age_days        INT,
        season          VARCHAR(50),
        entered_by      INT REFERENCES admin(id),
        created_at      TIMESTAMP DEFAULT NOW(),
        updated_at      TIMESTAMP DEFAULT NOW(),
        UNIQUE (flock_no, collection_date)
      )
    `);
    console.log('  ✔ egg_collection_header  (one per flock per date)');

    await client.query(`
      CREATE TABLE IF NOT EXISTS egg_collection_slots (
        id              SERIAL PRIMARY KEY,
        header_id       INT NOT NULL REFERENCES egg_collection_header(id) ON DELETE CASCADE,
        schedule_time   VARCHAR(20) NOT NULL,
        egg_weight_time VARCHAR(20),
        egg_weight      NUMERIC(6,2),
        created_at      TIMESTAMP DEFAULT NOW(),
        updated_at      TIMESTAMP DEFAULT NOW(),
        UNIQUE (header_id, schedule_time)
      )
    `);
    console.log('  ✔ egg_collection_slots   (one per schedule time: 7-8, 9-10...)');

    await client.query(`
      CREATE TABLE IF NOT EXISTS egg_collection_rows (
        id               SERIAL PRIMARY KEY,
        slot_id          INT NOT NULL REFERENCES egg_collection_slots(id) ON DELETE CASCADE,
        header_id        INT NOT NULL REFERENCES egg_collection_header(id) ON DELETE CASCADE,
        sno              INT NOT NULL,
        shed_id          INT REFERENCES shed_master(id),
        shed_no          VARCHAR(50),
        part_id          INT REFERENCES shed_part_master(id),
        part_row_no      VARCHAR(50),
        line_id          INT REFERENCES shed_line_master(id),
        line_no          VARCHAR(50),
        table_egg        INT NOT NULL DEFAULT 0,
        jumbo_egg        INT NOT NULL DEFAULT 0,
        crack_egg        INT NOT NULL DEFAULT 0,
        waste_reject_egg INT NOT NULL DEFAULT 0,
        hatching_egg     INT NOT NULL DEFAULT 0,
        total_eggs       INT GENERATED ALWAYS AS (
                           table_egg + jumbo_egg + crack_egg + waste_reject_egg + hatching_egg
                         ) STORED,
        created_at       TIMESTAMP DEFAULT NOW(),
        updated_at       TIMESTAMP DEFAULT NOW(),
        UNIQUE (slot_id, shed_id, part_id, line_id)
      )
    `);
    console.log('  ✔ egg_collection_rows    (S.No | Shed | Part | Line | T | J | C | W | HE)');

    await client.query(`
      CREATE TABLE IF NOT EXISTS egg_collection_summary_v2 (
        id               SERIAL PRIMARY KEY,
        header_id        INT NOT NULL REFERENCES egg_collection_header(id) ON DELETE CASCADE,
        slot_id          INT REFERENCES egg_collection_slots(id) ON DELETE SET NULL,
        summary_type     VARCHAR(10) NOT NULL DEFAULT 'slot',
        schedule_time    VARCHAR(20),
        table_egg        INT NOT NULL DEFAULT 0,
        jumbo_egg        INT NOT NULL DEFAULT 0,
        crack_egg        INT NOT NULL DEFAULT 0,
        waste_reject_egg INT NOT NULL DEFAULT 0,
        hatching_egg     INT NOT NULL DEFAULT 0,
        total_eggs       INT NOT NULL DEFAULT 0,
        created_at       TIMESTAMP DEFAULT NOW(),
        updated_at       TIMESTAMP DEFAULT NOW(),
        UNIQUE (header_id, slot_id)
      )
    `);
    console.log('  ✔ egg_collection_summary_v2 (summary per slot + grand total)');

    await client.query(`CREATE INDEX IF NOT EXISTS idx_ech_flock_date ON egg_collection_header(flock_no, collection_date)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ecs_header     ON egg_collection_slots(header_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ecr_slot       ON egg_collection_rows(slot_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ecr_header     ON egg_collection_rows(header_id)`);
    console.log('  ✔ Indexes');

    await client.query('COMMIT');
    console.log('\n✅ Migration done!');
    console.log('  npm run migrate:egg:v2\n');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n❌ Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    process.exit(0);
  }
}
run();
