require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const axios = require('axios');
const pool = require('../src/config/db');

const SAP_BASE = process.env.SAP_BASE_URL || 'http://krishidevqas.krishinutrition.com:8001/sap/bc/breeder';
const SAP_MASTERS_URL = process.env.SAP_MASTERS_URL || String(SAP_BASE).replace(/\/breeder\/?$/i, '');
const SAP_AUTH = {
  username: process.env.SAP_USER || 'vega',
  password: process.env.SAP_PASSWORD || 'Vega@1234',
};
const SAP_CLIENT = process.env.SAP_CLIENT || '500';
const PLANT_CODE = process.env.SAP_PLANT_CODE || '1902';

function norm(s) {
  return String(s || '').trim().toLowerCase();
}

function isSapLike(code) {
  return String(code || '').trim().length >= 8;
}

async function fetchSapMaterials() {
  const res = await axios.get(`${SAP_MASTERS_URL}/masters/material`, {
    auth: SAP_AUTH,
    params: { 'sap-client': SAP_CLIENT, werks: PLANT_CODE },
    timeout: 30000,
  });
  const rows = Array.isArray(res.data) ? res.data : (res.data?.results || []);
  return rows.map((r) => ({
    matnr: String(r?.matnr || '').trim(),
    maktx: String(r?.maktx || '').trim(),
    meins: String(r?.meins || '').trim(),
  })).filter((r) => r.matnr && r.maktx && isSapLike(r.matnr));
}

async function upsertMasterCodes(client, tableName, codeCol, listByName, fallbackMaterial) {
  const rows = await client.query(`SELECT id, item_name, uom, ${codeCol} AS code FROM ${tableName}`);
  let updated = 0;
  let fallbackUsed = 0;
  let skipped = 0;
  for (const row of rows.rows) {
    if (isSapLike(row.code)) {
      skipped += 1;
      continue;
    }
    const m = listByName.get(norm(row.item_name)) || fallbackMaterial || null;
    if (!m) {
      skipped += 1;
      continue;
    }
    if (!listByName.get(norm(row.item_name))) fallbackUsed += 1;
    await client.query(
      `UPDATE ${tableName}
          SET ${codeCol}=$1,
              uom=COALESCE(NULLIF($2,''), uom),
              updated_at=NOW()
        WHERE id=$3`,
      [m.matnr, m.meins || row.uom || '', row.id]
    );
    updated += 1;
  }
  return { updated, fallbackUsed, skipped, total: rows.rowCount };
}

async function updateFeedingRowsByMaster(client, tableName, codeCol, feedType) {
  // Bring old records to a consistent state by refreshing name/uom from master rows.
  const res = await client.query(
    `UPDATE flock_feeding_log f
        SET item_name = m.item_name,
            uom = COALESCE(NULLIF(m.uom,''), f.uom),
            updated_at = NOW()
       FROM ${tableName} m
      WHERE LOWER(COALESCE(f.feed_type,'')) = LOWER($1)
        AND CAST(f.item_id AS TEXT) = CAST(m.id AS TEXT)
        AND COALESCE(LENGTH(TRIM(m.${codeCol})),0) >= 8`,
    [feedType]
  );
  return res.rowCount || 0;
}

async function run() {
  const client = await pool.connect();
  try {
    console.log('Loading SAP materials for plant:', PLANT_CODE);
    const sapMaterials = await fetchSapMaterials();
    if (!sapMaterials.length) {
      throw new Error('No SAP materials received from /masters/material');
    }
    const byName = new Map();
    for (const m of sapMaterials) {
      const k = norm(m.maktx);
      if (!byName.has(k)) byName.set(k, m);
    }

    await client.query('BEGIN');

    const fallbackMaterial = sapMaterials[0] || null;
    const feed = await upsertMasterCodes(client, 'feed_master', 'mat_id', byName, fallbackMaterial);
    const water = await upsertMasterCodes(client, 'water_master', 'water_id', byName, fallbackMaterial);
    const medicine = await upsertMasterCodes(client, 'medicine_master', 'medicine_id', byName, fallbackMaterial);
    const others = await upsertMasterCodes(client, 'others_master', 'others_id', byName, fallbackMaterial);

    const feedingFeedRows = await updateFeedingRowsByMaster(client, 'feed_master', 'mat_id', 'feed');
    const feedingWaterRows = await updateFeedingRowsByMaster(client, 'water_master', 'water_id', 'water');
    const feedingMedicineRows = await updateFeedingRowsByMaster(client, 'medicine_master', 'medicine_id', 'medicine');
    const feedingOthersRows = await updateFeedingRowsByMaster(client, 'others_master', 'others_id', 'others');

    await client.query('COMMIT');

    console.log('Done.');
    console.log('Master updates:', {
      feed,
      water,
      medicine,
      others,
    });
    console.log('Feeding rows refreshed:', {
      feed: feedingFeedRows,
      water: feedingWaterRows,
      medicine: feedingMedicineRows,
      others: feedingOthersRows,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('fix_all_old_feeding_material_codes failed:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

run();
