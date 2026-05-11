require('dotenv').config();
const pool = require('../src/config/db');

async function runMigration() {
  const client = await pool.connect();
  try {
    console.log('Running flock_master migration...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS flock_master (
        id             SERIAL PRIMARY KEY,
        flock_no       VARCHAR(20) UNIQUE NOT NULL,
        flock_name     VARCHAR(100),
        farm_code      VARCHAR(20),
        farm_name      VARCHAR(150),
        batch          VARCHAR(50),
        document_date  DATE,
        hatchery_date  DATE,
        status         VARCHAR(5)  DEFAULT 'A',
        deletion_flag  VARCHAR(5)  DEFAULT '',
        sap_user       VARCHAR(30),
        sap_time       VARCHAR(20),
        source         VARCHAR(20) DEFAULT 'SAP',
        created_at     TIMESTAMP   DEFAULT NOW(),
        updated_at     TIMESTAMP   DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_flock_status   ON flock_master(status);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_flock_farm_code ON flock_master(farm_code);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_flock_batch     ON flock_master(batch);`);
    console.log('✅ flock_master table created successfully.');
  } catch (err) {
    console.error('Migration error:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration();
