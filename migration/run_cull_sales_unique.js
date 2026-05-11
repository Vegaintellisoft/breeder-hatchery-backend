/**
 * Add UNIQUE constraint to cull_sales_header
 * so same flock+date can only have one record (upsert behaviour)
 * Run: npm run migrate:cull:unique
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../src/config/db');

async function run() {
  const client = await pool.connect();
  try {
    console.log('\n🚀 Adding UNIQUE constraint to cull_sales_header...\n');
    await client.query('BEGIN');

    // Check if table exists
    const exists = await client.query(`
      SELECT 1 FROM information_schema.tables
      WHERE table_schema='public' AND table_name='cull_sales_header'
    `);
    if (!exists.rowCount) {
      console.log('  ⚠️  cull_sales_header does not exist — run migrate:cull:sales first');
      process.exit(1);
    }

    // Add unique constraint — one record per flock+date
    await client.query(`
      ALTER TABLE cull_sales_header
        ADD CONSTRAINT uq_cull_sales_flock_date
        UNIQUE (flock_no, entry_date)
    `);
    console.log('  ✔ UNIQUE(flock_no, entry_date) added to cull_sales_header');

    await client.query('COMMIT');
    console.log('\n✅ Done!\n');
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.message.includes('already exists')) {
      console.log('  ✔ Constraint already exists — no change needed');
      process.exit(0);
    }
    console.error('Error:', err.message);
    process.exit(1);
  } finally {
    client.release();
    process.exit(0);
  }
}
run();
