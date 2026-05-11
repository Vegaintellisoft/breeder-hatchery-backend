/**
 * Add sap_synced flag to all transactional tables
 * Skips tables that don't exist yet (safe to run anytime)
 * Run: npm run migrate:sap:sync
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../src/config/db');

async function run() {
  const client = await pool.connect();
  try {
    console.log('\n🚀 Adding sap_synced flag to tables...\n');

    const tables = [
      'cull_sales_header',
      'mortality_log',
      'cull_kill_log',
      'flock_feeding_log',
      'egg_collection_header',
      'flock_bird_weight',
    ];

    for (const table of tables) {
      // Check if table exists first
      const exists = await client.query(`
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = $1
      `, [table]);

      if (exists.rowCount === 0) {
        console.log(`  ⚠️  SKIPPED: ${table} (table does not exist yet — run its migration first)`);
        continue;
      }

      await client.query(`
        ALTER TABLE ${table}
          ADD COLUMN IF NOT EXISTS sap_synced     BOOLEAN   DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS sap_synced_at  TIMESTAMP DEFAULT NULL,
          ADD COLUMN IF NOT EXISTS sap_synced_by  INT       DEFAULT NULL
      `);
      console.log(`  ✔ ${table}`);
    }

    console.log('\n✅ Done!\n');
    console.log('  For skipped tables: run their migration first, then re-run this.\n');
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  } finally {
    client.release();
    process.exit(0);
  }
}
run();
