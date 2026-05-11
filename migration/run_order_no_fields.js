require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../src/config/db');

async function addColumnIfTableExists(client, table, ddl) {
  const exists = await client.query(
    `SELECT 1
     FROM information_schema.tables
     WHERE table_schema='public' AND table_name=$1`,
    [table]
  );
  if (exists.rowCount === 0) return false;
  await client.query(ddl);
  return true;
}

async function run() {
  const client = await pool.connect();
  try {
    console.log('\n🚀 Adding order_no columns to save tables...\n');
    await client.query('BEGIN');

    const targets = [
      ['flock_daily_activity', `ALTER TABLE flock_daily_activity ADD COLUMN IF NOT EXISTS order_no VARCHAR(30)`],
      ['flock_feeding_log', `ALTER TABLE flock_feeding_log ADD COLUMN IF NOT EXISTS order_no VARCHAR(30)`],
      ['flock_bird_weight', `ALTER TABLE flock_bird_weight ADD COLUMN IF NOT EXISTS order_no VARCHAR(30)`],
      ['mortality_log', `ALTER TABLE mortality_log ADD COLUMN IF NOT EXISTS order_no VARCHAR(30)`],
      ['cull_kill_log', `ALTER TABLE cull_kill_log ADD COLUMN IF NOT EXISTS order_no VARCHAR(30)`],
      ['cull_sales_header', `ALTER TABLE cull_sales_header ADD COLUMN IF NOT EXISTS order_no VARCHAR(30)`],
      ['egg_collection_header', `ALTER TABLE egg_collection_header ADD COLUMN IF NOT EXISTS order_no VARCHAR(30)`],
      ['bird_weighing', `ALTER TABLE bird_weighing ADD COLUMN IF NOT EXISTS order_no VARCHAR(30)`],
    ];

    for (const [table, ddl] of targets) {
      const done = await addColumnIfTableExists(client, table, ddl);
      if (done) console.log(`  ✔ ${table}.order_no`);
    }

    await client.query('COMMIT');
    console.log('\n✅ order_no migration completed.\n');
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
