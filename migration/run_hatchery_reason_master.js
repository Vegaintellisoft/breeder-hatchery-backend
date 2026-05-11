/**
 * Hatchery reason master for Grading / Setting / Pullout dropdowns.
 * Run: npm run migrate:hatchery:reasons
 */
require('dotenv').config();
const pool = require('../src/config/db');

async function run() {
  const client = await pool.connect();
  try {
    console.log('\n🚀 hatchery_reason_master...\n');
    await client.query('BEGIN');
    await client.query(`
      CREATE TABLE IF NOT EXISTS hatchery_reason_master (
        id SERIAL PRIMARY KEY,
        reason_id VARCHAR(40) NOT NULL,
        reason_name VARCHAR(200) NOT NULL,
        module VARCHAR(40) NOT NULL,
        is_active BOOLEAN DEFAULT TRUE,
        sort_order INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE (reason_id, module)
      )
    `);
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_hatchery_reason_mod ON hatchery_reason_master(module)`
    );

    const seeds = [
      ['R-GR-01', 'Undersize', 'grading', 10],
      ['R-GR-02', 'Shell stain', 'grading', 20],
      ['R-SG-01', 'Cracked shell', 'setting', 10],
      ['R-SG-02', 'Blood spot', 'setting', 20],
      ['R-SG-03', 'Mis-grade', 'setting', 30],
      ['R-PL-01', 'Quality hold', 'pullout', 10],
      ['R-PL-02', 'Schedule change', 'pullout', 20],
      ['R-PL-03', 'Equipment issue', 'pullout', 30],
    ];
    for (const [reason_id, reason_name, mod, sort_order] of seeds) {
      await client.query(
        `
        INSERT INTO hatchery_reason_master (reason_id, reason_name, module, sort_order)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (reason_id, module) DO NOTHING
      `,
        [reason_id, reason_name, mod, sort_order]
      );
    }

    await client.query('COMMIT');
    console.log('Done. GET /api/hatchery-live/reasons?module=setting (or grading, pullout, all)\n');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

run();
