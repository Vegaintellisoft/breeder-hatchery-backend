require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../src/config/db');

async function run() {
  const client = await pool.connect();
  try {
    console.log('\n🚀 Running Egg Type Master migration...\n');
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS egg_type_lookup (
        id             SERIAL PRIMARY KEY,
        egg_type_id    VARCHAR(20),
        egg_type_name  VARCHAR(200),
        sap_field_key  VARCHAR(50)
                      CHECK (sap_field_key IN ('hatching_egg', 'table_egg', 'jumbo_egg', 'crack_egg', 'waste_reject_egg')),
        sort_order     INT NOT NULL DEFAULT 0,
        is_active      BOOLEAN NOT NULL DEFAULT TRUE,
        created_by     VARCHAR(100),
        created_at     TIMESTAMP DEFAULT NOW(),
        updated_at     TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('  ✔ egg_type_lookup');

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_egg_type_lookup_egg_type_id
      ON egg_type_lookup(egg_type_id)
      WHERE egg_type_id IS NOT NULL
    `);

    const seeds = [
      ['EG000001', 'BROILER EGG', 'hatching_egg', 1],
      ['EG000002', 'TABLE EGG', 'table_egg', 2],
      ['EG000003', 'JUMBO EGG', 'jumbo_egg', 3],
      ['EG000005', 'CRACK EGG', 'crack_egg', 4],
      ['EG000004', 'WASTE / REJECT EGG', 'waste_reject_egg', 5],
    ];

    for (const [eggTypeId, eggTypeName, sapFieldKey, sortOrder] of seeds) {
      const upd = await client.query(
        `UPDATE egg_type_lookup
         SET egg_type_name = $2,
             sap_field_key = $3,
             sort_order = $4,
             is_active = COALESCE(is_active, TRUE),
             updated_at = NOW()
         WHERE egg_type_id = $1`,
        [eggTypeId, eggTypeName, sapFieldKey, sortOrder]
      );
      if (upd.rowCount === 0) {
        await client.query(
          `INSERT INTO egg_type_lookup (egg_type_id, egg_type_name, sap_field_key, sort_order, created_by)
           VALUES ($1,$2,$3,$4,'system')`,
          [eggTypeId, eggTypeName, sapFieldKey, sortOrder]
        );
      }
    }
    console.log('  ✔ Seeded default egg types (EG000001..EG000005)');

    await client.query('COMMIT');
    console.log('\n✅ Egg Type Master migration completed.\n');
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
