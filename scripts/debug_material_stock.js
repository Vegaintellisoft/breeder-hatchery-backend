require('dotenv').config();
const pool = require('../src/config/db');

(async () => {
  try {
    const q1 = await pool.query("SELECT COUNT(*)::int AS c FROM medicine_master WHERE is_active=TRUE");
    const q2 = await pool.query("SELECT COUNT(*)::int AS c FROM stock_master WHERE plant_code='1901' AND item_type='medicine'");
    const q3 = await pool.query(`
      SELECT sm.id, sm.plant_code, sm.item_type, sm.item_id, sm.item_name, sm.stock_qty,
             mm.medicine_id, mm.item_name AS med_name
      FROM stock_master sm
      LEFT JOIN medicine_master mm
        ON sm.item_type='medicine' AND mm.id=sm.item_id
      WHERE sm.plant_code='1901' AND sm.item_type='medicine'
      ORDER BY sm.id DESC
      LIMIT 10
    `);
    console.log(JSON.stringify({
      medicine_master_count: q1.rows[0].c,
      stock_rows_1901_medicine: q2.rows[0].c,
      sample: q3.rows,
    }, null, 2));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  } finally {
    process.exit(0);
  }
})();
