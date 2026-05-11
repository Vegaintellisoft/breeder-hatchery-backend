require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../src/config/db');

async function run() {
  const client = await pool.connect();
  try {
    const pick = await client.query(
      `SELECT id, mat_id, item_name, uom
         FROM feed_master
        WHERE COALESCE(mat_id,'') ~ '^[A-Za-z0-9]{8,}$'
        ORDER BY id DESC
        LIMIT 1`
    );
    if (!pick.rowCount) throw new Error('No SAP-length material code found in feed_master');
    const f = pick.rows[0];

    const upd = await client.query(
      `UPDATE flock_feeding_log
          SET item_id=$1,
              item_name=$2,
              uom=$3,
              order_no=COALESCE(order_no,'000010007311'),
              updated_at=NOW()
        WHERE id=4
      RETURNING id, flock_no, plant_code, feed_type, item_id, item_name, uom, order_no`,
      [f.id, f.item_name, f.uom]
    );

    console.log('feed_master_used:', f);
    console.log('row_4_after:', upd.rows[0] || null);
  } catch (e) {
    console.error('fix_feeding_row4_to_sap_code failed:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

run();
