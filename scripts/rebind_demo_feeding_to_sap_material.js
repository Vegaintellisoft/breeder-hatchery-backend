require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const axios = require('axios');
const pool = require('../src/config/db');

const SAP_BASE = process.env.SAP_BASE_URL || 'http://krishidevqas.krishinutrition.com:8001/sap/bc/breeder';
const SAP_MASTERS_URL = process.env.SAP_MASTERS_URL || String(SAP_BASE).replace(/\/breeder\/?$/i, '');
const SAP_AUTH = { username: process.env.SAP_USER || 'vega', password: process.env.SAP_PASSWORD || 'Vegaintell@123' };
const SAP_CLIENT = process.env.SAP_CLIENT || '500';

async function run() {
  const client = await pool.connect();
  try {
    const plant = '1902';
    const sapRes = await axios.get(`${SAP_MASTERS_URL}/masters/material`, {
      auth: SAP_AUTH,
      params: { 'sap-client': SAP_CLIENT, werks: plant },
      timeout: 20000,
    });
    const rows = Array.isArray(sapRes.data) ? sapRes.data : (sapRes.data?.results || []);
    const feedMat = rows.find((r) => String(r?.mtart || '').trim() === 'ZROH');
    if (!feedMat?.matnr) {
      console.error('No ZROH feed material found from SAP for plant 1902');
      process.exitCode = 1;
      return;
    }

    const upsert = await client.query(
      `INSERT INTO feed_master (mat_id, item_name, uom, module, created_by)
       VALUES ($1,$2,$3,ARRAY['Breeder'],'sap_rebind')
       ON CONFLICT DO NOTHING`,
      [String(feedMat.matnr).trim(), String(feedMat.maktx || '').trim() || 'SAP Feed', String(feedMat.meins || 'KG').trim()]
    );
    void upsert;

    const feedItem = await client.query(
      `SELECT id, mat_id, item_name, uom
         FROM feed_master
        WHERE mat_id=$1
        ORDER BY id DESC
        LIMIT 1`,
      [String(feedMat.matnr).trim()]
    );
    const item = feedItem.rows[0];
    if (!item) throw new Error('Failed to resolve feed_master item for selected SAP material');

    const upd = await client.query(
      `UPDATE flock_feeding_log
          SET item_id=$1, item_name=$2, uom=$3, order_no=COALESCE(order_no,'190225000183'), updated_at=NOW()
        WHERE id=2
      RETURNING id, flock_no, plant_code, feed_type, item_id, item_name, uom, order_no`,
      [item.id, item.item_name, item.uom]
    );

    console.log('SAP material selected:', { matnr: feedMat.matnr, maktx: feedMat.maktx, meins: feedMat.meins });
    console.log('Updated feeding row #2:', upd.rows[0] || null);
  } catch (e) {
    console.error('rebind_demo_feeding_to_sap_material failed:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

run();
