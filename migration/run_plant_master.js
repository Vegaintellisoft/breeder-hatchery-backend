const pool = require('../src/config/db');

async function migrate() {
  console.log('🔄 Creating plant_master table …');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS plant_master (
      id            SERIAL PRIMARY KEY,
      plant_id      VARCHAR(20)  NOT NULL UNIQUE,
      plant_name    VARCHAR(255) NOT NULL,
      status        BOOLEAN      DEFAULT TRUE,
      address       TEXT,
      gst           VARCHAR(50),
      module        VARCHAR(50)  DEFAULT 'Breeder',
      created_by    VARCHAR(100),
      created_at    TIMESTAMP    DEFAULT NOW(),
      updated_at    TIMESTAMP    DEFAULT NOW()
    )
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_plant_master_plant_id ON plant_master(plant_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_plant_master_module   ON plant_master(module)`);

  console.log('✅ plant_master table ready');
}

migrate()
  .then(() => { console.log('Done'); process.exit(0); })
  .catch((err) => { console.error('❌ Migration failed:', err.message); process.exit(1); });
