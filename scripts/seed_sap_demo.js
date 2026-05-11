/**
 * Inserts one unsynced flock_feeding_log row for today's date (Asia/Kolkata)
 * so you can exercise POST /api/sap-sync (feeding module) without manual SQL.
 *
 * Run: npm run seed:sap-demo
 *
 * Requires: existing flock_no + plant_code (from seed:mortality or any transactional row),
 *           feed_master row (creates a demo feed row if table is empty).
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../src/config/db');

async function pickFlockPlant(client) {
  const tryQueries = [
    `SELECT flock_no, plant_code FROM flock_feeding_log WHERE flock_no IS NOT NULL AND plant_code IS NOT NULL ORDER BY id DESC LIMIT 1`,
    `SELECT flock_no, plant_code FROM mortality_log WHERE flock_no IS NOT NULL AND plant_code IS NOT NULL ORDER BY id DESC LIMIT 1`,
    `SELECT flock_no, plant_code FROM flock_daily_activity WHERE flock_no IS NOT NULL AND plant_code IS NOT NULL ORDER BY id DESC LIMIT 1`,
    `SELECT flock_no, plant_code FROM flock_bird_weight WHERE flock_no IS NOT NULL AND plant_code IS NOT NULL ORDER BY id DESC LIMIT 1`,
  ];
  for (const sql of tryQueries) {
    try {
      const r = await client.query(sql);
      if (r.rowCount) return r.rows[0];
    } catch {
      /* table may not exist */
    }
  }
  const fm = await client.query(
    `SELECT flock_no FROM flock_master WHERE COALESCE(TRIM(status),'') IN ('A','') ORDER BY id LIMIT 1`
  );
  if (!fm.rowCount) return null;
  const sm = await client.query(`SELECT plant_code FROM shed_master WHERE plant_code IS NOT NULL ORDER BY id LIMIT 1`);
  if (!sm.rowCount) return null;
  return { flock_no: fm.rows[0].flock_no, plant_code: sm.rows[0].plant_code };
}

async function ensureFeedItem(client) {
  let r = await client.query(
    `SELECT id, item_name, uom FROM feed_master ORDER BY id LIMIT 1`
  );
  if (r.rowCount) return r.rows[0];

  await client.query(
    `INSERT INTO feed_master (mat_id, item_name, uom, module, created_by)
     VALUES ('FD-DEMO-001', 'Demo Feed (SAP seed)', 'Kg', ARRAY['Breeder'], 'seed_sap_demo')`
  );
  r = await client.query(`SELECT id, item_name, uom FROM feed_master ORDER BY id DESC LIMIT 1`);
  return r.rows[0];
}

async function columnExists(client, table, col) {
  const q = await client.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
    [table, col]
  );
  return q.rowCount > 0;
}

async function main() {
  const client = await pool.connect();
  try {
    const { rows: drows } = await client.query(
      `SELECT ((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date) AS d`
    );
    const feedDate = drows[0].d;

    const fp = await pickFlockPlant(client);
    if (!fp) {
      console.error(
        'seed_sap_demo: no flock_no/plant_code context found. Run `npm run seed:mortality` or add flock + shed data first.'
      );
      process.exitCode = 1;
      return;
    }

    const item = await ensureFeedItem(client);

    const hasOrderNo = await columnExists(client, 'flock_feeding_log', 'order_no');
    const demoOrderNo = String(process.env.SAP_DEMO_ORDER_NO || '190225000183').trim();

    const baseCols =
      `flock_no, plant_code, feed_date, feed_type, item_id, item_name, uom,
       qty_issued_male, qty_issued_female, stock_in_bags, cum_feed,
       sap_synced, sap_synced_at, sap_synced_by`;
    const baseNums = 14;
    const placeholders = Array.from({ length: baseNums }, (_, i) => `$${i + 1}`).join(', ');
    const orderFrag = hasOrderNo ? ', order_no' : '';
    const orderVal = hasOrderNo ? `, $${baseNums + 1}` : '';

    const vals = [
      fp.flock_no,
      fp.plant_code,
      feedDate,
      'feed',
      item.id,
      item.item_name,
      item.uom || 'Kg',
      12.5,
      18,
      100,
      250,
      false,
      null,
      null,
    ];
    if (hasOrderNo) vals.push(demoOrderNo);

    const upd = `
      qty_issued_male = EXCLUDED.qty_issued_male,
      qty_issued_female = EXCLUDED.qty_issued_female,
      stock_in_bags = EXCLUDED.stock_in_bags,
      cum_feed = EXCLUDED.cum_feed,
      sap_synced = FALSE,
      sap_synced_at = NULL,
      sap_synced_by = NULL,
      updated_at = NOW()`;

    const sql = `
      INSERT INTO flock_feeding_log (${baseCols}${orderFrag})
      VALUES (${placeholders}${orderVal})
      ON CONFLICT (flock_no, feed_date, feed_type, item_id)
      DO UPDATE SET ${upd}
      RETURNING id`;

    const ins = await client.query(sql, vals);

    console.log('seed_sap_demo: OK');
    console.log(`  flock_feeding_log.id = ${ins.rows[0].id}`);
    console.log(`  flock_no=${fp.flock_no} plant_code=${fp.plant_code} feed_date=${feedDate} item_id=${item.id}`);
    if (hasOrderNo) console.log(`  order_no=${demoOrderNo}`);
    console.log('  sap_synced=false — call POST /api/sap-sync with module feeding and this record id.');
  } catch (e) {
    console.error('seed_sap_demo failed:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
