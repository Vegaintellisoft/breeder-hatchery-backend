require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../src/config/db');

async function run() {
  const client = await pool.connect();
  try {
    const r = await client.query(
      `UPDATE flock_feeding_log
          SET sap_synced=TRUE,
              sap_synced_at=NOW(),
              updated_at=NOW()
        WHERE id=4
      RETURNING id, sap_synced, sap_synced_at`
    );
    console.log(r.rows[0] || null);
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

run();
