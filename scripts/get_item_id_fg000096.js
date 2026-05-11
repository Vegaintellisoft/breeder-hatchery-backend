const pool = require('../src/config/db');

async function run() {
  const fm = await pool.query(
    `SELECT id, mat_id, item_name, uom
       FROM feed_master
      WHERE mat_id='FG000096' AND is_active=TRUE
      ORDER BY id DESC`
  );
  const ids = fm.rows.map((r) => r.id);
  let stockRows = [];
  if (ids.length) {
    const st = await pool.query(
      `SELECT item_id, stock_qty
         FROM stock_master
        WHERE plant_code='1904' AND item_type='feed' AND item_id = ANY($1::int[])
        ORDER BY item_id`,
      [ids]
    );
    stockRows = st.rows;
  }
  console.log(JSON.stringify({ feed_master: fm.rows, stock_1904: stockRows }, null, 2));
  await pool.end();
}

run().catch(async (e) => {
  console.error(e.message);
  await pool.end();
  process.exit(1);
});
