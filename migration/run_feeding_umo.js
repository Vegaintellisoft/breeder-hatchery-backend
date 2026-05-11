require('dotenv').config();
const pool = require('../src/config/db');

async function runMigration() {
  const client = await pool.connect();
  try {
    console.log('Adding umo column to feeding_consumption...');

    // Add column only if it doesn't exist
    await client.query(`
      ALTER TABLE feeding_consumption
      ADD COLUMN IF NOT EXISTS umo VARCHAR(10) DEFAULT NULL;
    `);

    console.log('✅ umo column added to feeding_consumption.');
    console.log('\nUMO options for Feed tab: MT | Kg | Lit');
    console.log('Pass umo in POST /api/feeding/consume items array.');
    console.log('Example: { "item_id": 1, "consumed_qty": 5, "umo": "Kg" }');
  } catch (err) {
    console.error('Migration error:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration();
