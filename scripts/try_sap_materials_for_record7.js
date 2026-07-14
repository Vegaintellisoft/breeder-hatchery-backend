require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const axios = require('axios');
const pool = require('../src/config/db');
const { pushToSap } = require('../src/services/sapOutboundPush');

const CODES = [
  'MD000003',
  'MD000039',
  'MD000050',
  'MD000347',
  'MD000229',
  'MD000064',
  'MD000071',
  'MD000077',
  'MD000087',
];

const SAP_BASE = process.env.SAP_BASE_URL || 'http://krishidevqas.krishinutrition.com:8001/sap/bc/breeder';
const SAP_MASTERS_URL = process.env.SAP_MASTERS_URL || String(SAP_BASE).replace(/\/breeder\/?$/i, '');
const SAP_AUTH = { username: process.env.SAP_USER || 'vega', password: process.env.SAP_PASSWORD || 'Vegaintell@123' };
const SAP_CLIENT = process.env.SAP_CLIENT || '500';
const PLANT = '1902';

async function getCodeMap() {
  const res = await axios.get(`${SAP_MASTERS_URL}/masters/material`, {
    auth: SAP_AUTH,
    params: { 'sap-client': SAP_CLIENT, werks: PLANT },
    timeout: 30000,
  });
  const rows = Array.isArray(res.data) ? res.data : (res.data?.results || []);
  const map = new Map();
  for (const r of rows) {
    const code = String(r?.matnr || '').trim();
    if (!code) continue;
    map.set(code, {
      matnr: code,
      maktx: String(r?.maktx || '').trim(),
      meins: String(r?.meins || '').trim(),
      mtart: String(r?.mtart || '').trim(),
    });
  }
  return map;
}

async function run() {
  const client = await pool.connect();
  try {
    const originalMed = (await client.query(
      `SELECT id, medicine_id, item_name, uom FROM medicine_master WHERE id=1`
    )).rows[0];
    const originalRow = (await client.query(
      `SELECT id, item_name, uom FROM flock_feeding_log WHERE id=7`
    )).rows[0];

    const sapMap = await getCodeMap();
    const candidates = CODES.map((c) => sapMap.get(c)).filter(Boolean);
    if (!candidates.length) {
      throw new Error('None of the provided codes found in SAP material master for plant 1902');
    }

    console.log('Trying codes:', candidates.map((c) => `${c.matnr}:${c.maktx}`));

    let success = null;
    for (const c of candidates) {
      await client.query(
        `UPDATE medicine_master SET medicine_id=$1, item_name=$2, uom=$3, updated_at=NOW() WHERE id=1`,
        [c.matnr, c.maktx, c.meins || 'NOS']
      );
      await client.query(
        `UPDATE flock_feeding_log SET item_name=$1, uom=$2, updated_at=NOW() WHERE id=7`,
        [c.maktx, c.meins || 'NOS']
      );

      const res = await pushToSap(pool, 'feeding', 7);
      console.log(`code=${c.matnr} status=${res.status || 'NA'} ok=${res.ok} msg=${String(res.message || '').slice(0, 120)}`);
      if (res.ok) {
        success = { code: c, res };
        break;
      }
    }

    if (!success) {
      // restore original values if none worked
      await client.query(
        `UPDATE medicine_master SET medicine_id=$1, item_name=$2, uom=$3, updated_at=NOW() WHERE id=1`,
        [originalMed.medicine_id, originalMed.item_name, originalMed.uom]
      );
      await client.query(
        `UPDATE flock_feeding_log SET item_name=$1, uom=$2, updated_at=NOW() WHERE id=7`,
        [originalRow.item_name, originalRow.uom]
      );
      console.log('No candidate worked. Restored original DB values for medicine_master.id=1 and feeding.id=7');
      return;
    }

    console.log('SUCCESS with code:', success.code);
    console.log('SAP response summary:', {
      ok: success.res.ok,
      status: success.res.status,
      message: success.res.message,
      preview: success.res.sap_payload_preview,
    });
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((e) => {
  console.error('try_sap_materials_for_record7 failed:', e.message);
  process.exit(1);
});
