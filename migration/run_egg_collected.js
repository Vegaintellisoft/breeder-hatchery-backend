require('dotenv').config();
const pool = require('../src/config/db');

async function runMigration() {
  const client = await pool.connect();
  try {
    console.log('Adding eggs_collected to egg_collections...');
    await client.query(`
      ALTER TABLE egg_collections
      ADD COLUMN IF NOT EXISTS eggs_collected INT DEFAULT 0;
    `);
    console.log('✅ eggs_collected column added to egg_collections.');
    console.log('\nPass eggs_collected in POST /api/egg-collection/save');
    console.log('Example: { "eggs_collected": 121, ... }');
  } catch (err) {
    console.error('Migration error:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration();
