require('dotenv').config();
const pool = require('../src/config/db');

async function runMigration() {
  const client = await pool.connect();
  try {
    console.log('\n🚀 Running Egg Collection Sheds & Lines Migration...\n');
    await client.query('BEGIN');

    // ── 1. SHEDS ──────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS sheds (
        id          SERIAL PRIMARY KEY,
        shed_number INT         NOT NULL UNIQUE,
        shed_name   VARCHAR(50) NOT NULL,
        is_active   BOOLEAN     DEFAULT TRUE,
        created_at  TIMESTAMP   DEFAULT NOW(),
        updated_at  TIMESTAMP   DEFAULT NOW()
      );
    `);
    console.log('  ✔ Table: sheds');

    // ── 2. SHED LINES ─────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS shed_lines (
        id          SERIAL PRIMARY KEY,
        shed_id     INT         NOT NULL REFERENCES sheds(id) ON DELETE CASCADE,
        line_number INT         NOT NULL,
        line_name   VARCHAR(50) NOT NULL,
        is_active   BOOLEAN     DEFAULT TRUE,
        created_at  TIMESTAMP   DEFAULT NOW(),
        updated_at  TIMESTAMP   DEFAULT NOW(),
        UNIQUE (shed_id, line_number)
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_shed_lines_shed_id ON shed_lines(shed_id);`);
    console.log('  ✔ Table: shed_lines');

    // ── 3. EGG TYPE MASTER (global - same for all lines) ────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS egg_type_master (
        id          SERIAL PRIMARY KEY,
        egg_type    VARCHAR(50) NOT NULL UNIQUE,
        sort_order  INT         NOT NULL DEFAULT 0,
        is_active   BOOLEAN     DEFAULT TRUE,
        created_at  TIMESTAMP   DEFAULT NOW(),
        updated_at  TIMESTAMP   DEFAULT NOW()
      );
    `);
    console.log('  ✔ Table: egg_type_master (global)');

    // ── 4. ADD line_id TO egg_collection_lines ────────────────────────────
    await client.query(`
      ALTER TABLE egg_collection_lines
      ADD COLUMN IF NOT EXISTS line_id INT REFERENCES shed_lines(id) ON DELETE SET NULL;
    `);
    await client.query(`
      ALTER TABLE egg_collection_lines
      ADD COLUMN IF NOT EXISTS shed_id INT REFERENCES sheds(id) ON DELETE SET NULL;
    `);
    console.log('  ✔ Added shed_id, line_id to egg_collection_lines');

    // ── 5. SEED SHEDS (1 to 6) ───────────────────────────────────────────
    const sheds = [
      [1, 'Shed 1'], [2, 'Shed 2'], [3, 'Shed 3'],
      [4, 'Shed 4'], [5, 'Shed 5'], [6, 'Shed 6'],
    ];
    for (const [num, name] of sheds) {
      await client.query(`
        INSERT INTO sheds (shed_number, shed_name)
        VALUES ($1, $2)
        ON CONFLICT (shed_number) DO UPDATE SET shed_name = EXCLUDED.shed_name
      `, [num, name]);
    }
    console.log('  ✔ Seeded: 6 sheds');

    // ── 6. SEED LINES PER SHED (3 lines each) ────────────────────────────
    const shedRows = await client.query(`SELECT id, shed_number FROM sheds ORDER BY shed_number`);
    const lineNames = ['Line 1', 'Line 2', 'Line 3'];

    for (const shed of shedRows.rows) {
      for (let i = 0; i < lineNames.length; i++) {
        await client.query(`
          INSERT INTO shed_lines (shed_id, line_number, line_name)
          VALUES ($1, $2, $3)
          ON CONFLICT (shed_id, line_number) DO UPDATE SET line_name = EXCLUDED.line_name
        `, [shed.id, i + 1, lineNames[i]]);
      }
    }
    console.log('  ✔ Seeded: 3 lines per shed (18 total)');

    // ── 7. SEED EGG TYPES (global - 5 fixed types) ──────────────────────
    const eggTypes = [
      ['Broiler Egg',      1],
      ['Crack Egg',        2],
      ['Jumbo Egg',        3],
      ['Table Egg',        4],
      ['Waste/Reject Egg', 5],
    ];
    for (const [eggType, sortOrder] of eggTypes) {
      await client.query(`
        INSERT INTO egg_type_master (egg_type, sort_order)
        VALUES ($1, $2)
        ON CONFLICT (egg_type) DO NOTHING
      `, [eggType, sortOrder]);
    }
    console.log('  ✔ Seeded: 5 global egg types');

    // ── 8. ADD eggs_collected TO egg_collections ─────────────────────────
    await client.query(`
      ALTER TABLE egg_collections
      ADD COLUMN IF NOT EXISTS eggs_collected INT DEFAULT 0;
    `);
    console.log('  ✔ Added eggs_collected to egg_collections');

    await client.query('COMMIT');
    console.log(`
✅ Egg Collection Sheds & Lines Migration complete!
──────────────────────────────────────────────────────
  Tables  : sheds, shed_lines, egg_type_master
  Updated : egg_collection_lines (added shed_id, line_id)
  Seeded  : 6 sheds × 3 lines + 5 global egg types
──────────────────────────────────────────────────────
  APIs:
    GET /api/egg-collection/sheds
    GET /api/egg-collection/sheds/:shed_id/lines
    GET /api/egg-collection/egg-types
    POST /api/egg-collection/save  (updated)
    GET  /api/egg-collection/summary?shed_id=&date=
──────────────────────────────────────────────────────
  Note: When SAP API is ready, update shed_lines &
        egg_type_master via SAP sync endpoint.
──────────────────────────────────────────────────────`);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration error:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration();
