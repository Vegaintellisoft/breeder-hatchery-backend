require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../src/config/db');

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE medicine_master
          SET medicine_id=$1, item_name=$2, uom=$3, updated_at=NOW()
        WHERE id=$4`,
      ['MD000358', 'AMOXIZEN 40% (LAVIZEN)', 'KG', 1]
    );
    const r = await client.query(
      `UPDATE flock_feeding_log
          SET item_name=$1, uom=$2, updated_at=NOW()
        WHERE LOWER(feed_type)='medicine'
          AND item_id=1
          AND sap_synced=FALSE
      RETURNING id, feed_type, item_id, item_name, uom, order_no`,
      ['AMOXIZEN 40% (LAVIZEN)', 'KG']
    );
    await client.query('COMMIT');
    console.log(JSON.stringify({ updated_rows: r.rows.length, rows: r.rows }, null, 2));
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

run();
