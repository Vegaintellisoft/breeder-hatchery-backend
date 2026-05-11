require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../src/config/db');

async function run() {
  const client = await pool.connect();
  try {
    const orderNo = process.env.SAP_DEMO_ORDER_NO || '190225000183';
    const r = await client.query(
      `UPDATE flock_feeding_log
          SET order_no = $1,
              updated_at = NOW()
        WHERE id IN (1,2)
      RETURNING id, flock_no, plant_code, order_no`
      , [orderNo]
    );
    console.log(JSON.stringify(r.rows, null, 2));
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

run();
