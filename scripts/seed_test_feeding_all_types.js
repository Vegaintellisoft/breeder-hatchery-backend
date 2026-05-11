require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../src/config/db');

async function ensureStock(client, { plantCode, itemType, itemId, itemName, uom, stockQty, cumQty }) {
  const upd = await client.query(
    `UPDATE stock_master
        SET item_name=$4, uom=$5, stock_qty=$6, cum_qty=$7, source='MANUAL', stock_date=CURRENT_DATE, updated_at=NOW()
      WHERE plant_code=$1 AND item_type=$2 AND item_id=$3`,
    [plantCode, itemType, itemId, itemName, uom, stockQty, cumQty]
  );
  if (upd.rowCount === 0) {
    await client.query(
      `INSERT INTO stock_master
        (plant_code, item_type, item_id, item_name, uom, stock_qty, cum_qty, source, stock_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'MANUAL',CURRENT_DATE)`,
      [plantCode, itemType, itemId, itemName, uom, stockQty, cumQty]
    );
  }
}

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const plantCode = '1902';
    const flockNo = 'LY000001';
    const orderNo = '000010007311';
    const enteredBy = 1;

    const { rows: drows } = await client.query(
      `SELECT ((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date) AS d`
    );
    const feedDate = drows[0].d;

    const feedItem = (await client.query(
      `SELECT id, item_name, uom FROM feed_master
       WHERE COALESCE(mat_id,'') ~ '^[A-Za-z0-9]{8,}$'
       ORDER BY id DESC LIMIT 1`
    )).rows[0];
    const waterItem = (await client.query(
      `SELECT id, item_name, uom FROM water_master ORDER BY id ASC LIMIT 1`
    )).rows[0];
    const medItem = (await client.query(
      `SELECT id, item_name, uom FROM medicine_master ORDER BY id ASC LIMIT 1`
    )).rows[0];
    const othersItem = (await client.query(
      `SELECT id, item_name, uom FROM others_master ORDER BY id ASC LIMIT 1`
    )).rows[0];

    if (!feedItem || !waterItem || !medItem || !othersItem) {
      throw new Error('Missing one or more master items (feed/water/medicine/others)');
    }

    await ensureStock(client, {
      plantCode, itemType: 'feed', itemId: feedItem.id, itemName: feedItem.item_name, uom: feedItem.uom || 'KG',
      stockQty: 500, cumQty: 1200,
    });
    await ensureStock(client, {
      plantCode, itemType: 'water', itemId: waterItem.id, itemName: waterItem.item_name, uom: waterItem.uom || 'LTR',
      stockQty: 10000, cumQty: 25000,
    });
    await ensureStock(client, {
      plantCode, itemType: 'medicine', itemId: medItem.id, itemName: medItem.item_name, uom: medItem.uom || 'NOS',
      stockQty: 300, cumQty: 800,
    });
    await ensureStock(client, {
      plantCode, itemType: 'others', itemId: othersItem.id, itemName: othersItem.item_name, uom: othersItem.uom || 'KG',
      stockQty: 200, cumQty: 600,
    });

    const rows = [
      { feed_type: 'feed', item: feedItem, male: 12.5, female: 18, stock_in_bags: 500, cum_feed: 1200 },
      { feed_type: 'water', item: waterItem, male: 500, female: 800, stock_in_bags: 10000, cum_feed: 25000 },
      { feed_type: 'medicine', item: medItem, male: 2, female: 3, stock_in_bags: 300, cum_feed: 800 },
      { feed_type: 'others', item: othersItem, male: 5, female: 7, stock_in_bags: 200, cum_feed: 600 },
    ];

    for (const r of rows) {
      await client.query(
        `INSERT INTO flock_feeding_log
          (flock_no, plant_code, order_no, feed_date, feed_type, item_id, item_name, uom,
           qty_issued_male, qty_issued_female, stock_in_bags, cum_feed, entered_by,
           sap_synced, sap_synced_at, sap_synced_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,FALSE,NULL,NULL)
         ON CONFLICT (flock_no, feed_date, feed_type, item_id)
         DO UPDATE SET
           order_no=EXCLUDED.order_no,
           item_name=EXCLUDED.item_name,
           uom=EXCLUDED.uom,
           qty_issued_male=EXCLUDED.qty_issued_male,
           qty_issued_female=EXCLUDED.qty_issued_female,
           stock_in_bags=EXCLUDED.stock_in_bags,
           cum_feed=EXCLUDED.cum_feed,
           entered_by=EXCLUDED.entered_by,
           sap_synced=FALSE,
           sap_synced_at=NULL,
           sap_synced_by=NULL,
           updated_at=NOW()`,
        [
          flockNo, plantCode, orderNo, feedDate, r.feed_type, r.item.id, r.item.item_name, r.item.uom,
          r.male, r.female, r.stock_in_bags, r.cum_feed, enteredBy,
        ]
      );
    }

    await client.query('COMMIT');

    console.log('✅ Seeded stock + feeding save rows for all types');
    console.log(`   plant=${plantCode}, flock=${flockNo}, date=${feedDate}`);
    console.log(`   feed item id=${feedItem.id}, water id=${waterItem.id}, medicine id=${medItem.id}, others id=${othersItem.id}`);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('❌ seed_test_feeding_all_types failed:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

run();
