const pool = require('../src/config/db');

async function migrate() {
  console.log('🔄 Updating breeder_controller_config — renaming feeding → feed, adding water …');

  // Rename feeding_part → feed_part, feeding_line → feed_line
  await pool.query(`
    ALTER TABLE breeder_controller_config
      RENAME COLUMN feeding_part TO feed_part
  `).catch(() => console.log('  ℹ feed_part column already exists or renamed'));

  await pool.query(`
    ALTER TABLE breeder_controller_config
      RENAME COLUMN feeding_line TO feed_line
  `).catch(() => console.log('  ℹ feed_line column already exists or renamed'));

  // Add water columns
  await pool.query(`
    ALTER TABLE breeder_controller_config
      ADD COLUMN IF NOT EXISTS water_part BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS water_line BOOLEAN DEFAULT FALSE
  `);

  console.log('✅ breeder_controller_config updated — feed, water, medicine, others, mortality, cull_kill, egg_collection');
}

migrate()
  .then(() => { console.log('Done'); process.exit(0); })
  .catch((err) => { console.error('❌ Migration failed:', err.message); process.exit(1); });
