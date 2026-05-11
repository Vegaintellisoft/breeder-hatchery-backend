const axios = require('axios');
const pool  = require('../config/db');

// ── SAP connection ────────────────────────────────────────────────────────
const SAP_BASE   = process.env.SAP_BASE_URL || 'http://krishidevqas.krishinutrition.com:8001/sap/bc/breeder';
const SAP_AUTH   = { username: process.env.SAP_USER || 'vega', password: process.env.SAP_PASSWORD || 'Vega@1234' };
const SAP_PARAMS = { 'sap-client': process.env.SAP_CLIENT || '500' };

// ── Helpers ───────────────────────────────────────────────────────────────
const safeDate = (val) => (val && String(val).trim() !== '' ? val : null);
const safeNum  = (val) => (val !== '' && val !== null && val !== undefined ? parseFloat(val) || 0 : 0);

async function fetchSAP(endpoint, params = {}) {
  const url = `${SAP_BASE}/${endpoint}`;
  const response = await axios.get(url, {
    auth: SAP_AUTH,
    params: { ...SAP_PARAMS, ...params },
    timeout: 30000
  });
  return response.data;
}

// ── Generic sync response builder ─────────────────────────────────────────
function syncResponse(res, { sapEndpoint, sapCount, saved, tableName, rows }) {
  res.json({
    success:      true,
    sap_endpoint: sapEndpoint,
    sap_table:    tableName,
    sap_records:  sapCount,
    saved_to_db:  saved,
    synced_at:    new Date().toISOString(),
    total:        rows.length,
    data:         rows
  });
}

// ── Save functions ────────────────────────────────────────────────────────
async function saveBirdReceiptToDB(records) {
  if (!records.length) return 0;
  const client = await pool.connect();
  try {
    let saved = 0;
    for (const r of records) {
      await client.query(`
        INSERT INTO sap_bird_receipt
          (lifnr,werks,ebeln,ebelp,mblnr,zeile,matnr,maktx,
           bldat,budat,menge,erfmg,uname,uzeit,hatchdt,erdat,loekz,synced_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW())
        ON CONFLICT (mblnr,zeile) DO UPDATE SET
          lifnr=$1,werks=$2,matnr=$7,maktx=$8,
          bldat=$9,budat=$10,menge=$11,erfmg=$12,
          uname=$13,uzeit=$14,hatchdt=$15,erdat=$16,loekz=$17,
          synced_at=NOW(),updated_at=NOW()
      `, [
        r.lifnr, r.werks, r.ebeln, r.ebelp, r.mblnr, r.zeile,
        r.matnr, r.maktx,
        safeDate(r.bldat), safeDate(r.budat),
        safeNum(r.menge),  safeNum(r.erfmg),
        r.uname, r.uzeit,
        safeDate(r.hatchdt), safeDate(r.erdat),
        r.loekz || ''
      ]);
      saved++;
    }
    return saved;
  } finally { client.release(); }
}

async function saveFeedMedicineToDB(records) {
  if (!records.length) return 0;
  const client = await pool.connect();
  try {
    let saved = 0;
    for (const r of records) {
      await client.query(`
        INSERT INTO sap_feed_medicine
          (lifnr,werks,ebeln,ebelp,mblnr,zeile,matnr,maktx,
           bldat,budat,menge,erfmg,uname,uzeit,loekz,synced_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW())
        ON CONFLICT (mblnr,zeile) DO UPDATE SET
          lifnr=$1,werks=$2,matnr=$7,maktx=$8,
          bldat=$9,budat=$10,menge=$11,erfmg=$12,
          uname=$13,uzeit=$14,loekz=$15,
          synced_at=NOW(),updated_at=NOW()
      `, [
        r.lifnr, r.werks, r.ebeln, r.ebelp, r.mblnr, r.zeile,
        r.matnr, r.maktx,
        safeDate(r.bldat), safeDate(r.budat),
        safeNum(r.menge),  safeNum(r.erfmg),
        r.uname, r.uzeit, r.loekz || ''
      ]);
      saved++;
    }
    return saved;
  } finally { client.release(); }
}

async function saveLayingToDB(records) {
  if (!records.length) return 0;
  const client = await pool.connect();
  try {
    let saved = 0;
    for (const r of records) {
      await client.query(`
        INSERT INTO sap_laying
          (zzflock,zzflockn,werks,lifnr,bldat,budat,
           zzfbirds,zzmbirds,zzeggs,zzdeadegg,zzfloor,
           uname,uzeit,loekz,synced_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())
        ON CONFLICT (zzflock,bldat,werks) DO UPDATE SET
          zzflockn=$2,lifnr=$4,budat=$6,
          zzfbirds=$7,zzmbirds=$8,zzeggs=$9,zzdeadegg=$10,zzfloor=$11,
          uname=$12,uzeit=$13,loekz=$14,
          synced_at=NOW(),updated_at=NOW()
      `, [
        r.zzflock, r.zzflockn, r.werks, r.lifnr,
        safeDate(r.bldat), safeDate(r.budat),
        safeNum(r.zzfbirds), safeNum(r.zzmbirds),
        safeNum(r.zzeggs),   safeNum(r.zzdeadegg), safeNum(r.zzfloor),
        r.uname, r.uzeit, r.loekz || ''
      ]);
      saved++;
    }
    return saved;
  } finally { client.release(); }
}

async function saveMortalityToDB(records) {
  if (!records.length) return 0;
  const client = await pool.connect();
  try {
    let saved = 0;
    for (const r of records) {
      await client.query(`
        INSERT INTO sap_mortality
          (zzflock,zzflockn,werks,lifnr,bldat,budat,
           zzmort,zzculls,uname,uzeit,loekz,synced_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
        ON CONFLICT (zzflock,bldat,werks) DO UPDATE SET
          zzflockn=$2,lifnr=$4,budat=$6,
          zzmort=$7,zzculls=$8,
          uname=$9,uzeit=$10,loekz=$11,
          synced_at=NOW(),updated_at=NOW()
      `, [
        r.zzflock, r.zzflockn, r.werks, r.lifnr,
        safeDate(r.bldat), safeDate(r.budat),
        safeNum(r.zzmort), safeNum(r.zzculls),
        r.uname, r.uzeit, r.loekz || ''
      ]);
      saved++;
    }
    return saved;
  } finally { client.release(); }
}

async function saveCullsKillToDB(records) {
  if (!records.length) return 0;
  const client = await pool.connect();
  try {
    let saved = 0;
    for (const r of records) {
      await client.query(`
        INSERT INTO sap_culls_kill
          (lifnr,werks,vbeln,posnr,matnr,maktx,
           bldat,budat,menge,erfmg,uname,uzeit,loekz,synced_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
        ON CONFLICT (vbeln,posnr) DO UPDATE SET
          lifnr=$1,werks=$2,matnr=$5,maktx=$6,
          bldat=$7,budat=$8,menge=$9,erfmg=$10,
          uname=$11,uzeit=$12,loekz=$13,
          synced_at=NOW(),updated_at=NOW()
      `, [
        r.lifnr, r.werks, r.vbeln, r.posnr,
        r.matnr, r.maktx,
        safeDate(r.bldat), safeDate(r.budat),
        safeNum(r.menge),  safeNum(r.erfmg),
        r.uname, r.uzeit, r.loekz || ''
      ]);
      saved++;
    }
    return saved;
  } finally { client.release(); }
}

async function saveSaleReceiptToDB(records) {
  if (!records.length) return 0;
  const client = await pool.connect();
  try {
    let saved = 0;
    for (const r of records) {
      await client.query(`
        INSERT INTO sap_sale_receipt
          (lifnr,werks,vbeln,posnr,matnr,maktx,
           bldat,budat,menge,erfmg,uname,uzeit,loekz,synced_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
        ON CONFLICT (vbeln,posnr) DO UPDATE SET
          lifnr=$1,werks=$2,matnr=$5,maktx=$6,
          bldat=$7,budat=$8,menge=$9,erfmg=$10,
          uname=$11,uzeit=$12,loekz=$13,
          synced_at=NOW(),updated_at=NOW()
      `, [
        r.lifnr, r.werks, r.vbeln, r.posnr,
        r.matnr, r.maktx,
        safeDate(r.bldat), safeDate(r.budat),
        safeNum(r.menge),  safeNum(r.erfmg),
        r.uname, r.uzeit, r.loekz || ''
      ]);
      saved++;
    }
    return saved;
  } finally { client.release(); }
}

async function saveEstimatedCostToDB(records) {
  if (!records.length) return 0;
  const client = await pool.connect();
  try {
    let saved = 0;
    for (const r of records) {
      await client.query(`
        INSERT INTO sap_estimated_cost
          (werks,lifnr,matnr,maktx,bldat,budat,
           menge,erfmg,uname,uzeit,loekz,synced_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
        ON CONFLICT (werks,matnr,bldat) DO UPDATE SET
          lifnr=$2,maktx=$4,budat=$6,
          menge=$7,erfmg=$8,
          uname=$9,uzeit=$10,loekz=$11,
          synced_at=NOW(),updated_at=NOW()
      `, [
        r.werks, r.lifnr, r.matnr, r.maktx,
        safeDate(r.bldat), safeDate(r.budat),
        safeNum(r.menge),  safeNum(r.erfmg),
        r.uname, r.uzeit, r.loekz || ''
      ]);
      saved++;
    }
    return saved;
  } finally { client.release(); }
}

// ── Dashboard ─────────────────────────────────────────────────────────────
exports.getSAPDashboard = async (req, res) => {
  try {
    const tables = [
      'sap_bird_receipt', 'sap_feed_medicine', 'sap_laying',
      'sap_mortality', 'sap_culls_kill', 'sap_sale_receipt', 'sap_estimated_cost'
    ];
    const results = await Promise.allSettled(
      tables.map(t => pool.query(`SELECT COUNT(*) as count, MAX(synced_at) as last_sync FROM ${t}`))
    );
    const summary = {};
    results.forEach((r, i) => {
      summary[tables[i]] = r.status === 'fulfilled'
        ? { count: parseInt(r.value.rows[0].count), last_sync: r.value.rows[0].last_sync }
        : { count: 'error', last_sync: null };
    });
    res.json({ success: true, data: summary });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Sync: Bird Receipt ────────────────────────────────────────────────────
exports.syncBirdReceipt = async (req, res) => {
  try {
    const data    = await fetchSAP('zbird_receipt', req.query);
    const records = Array.isArray(data?.ET_BIRD_RECEIPT) ? data.ET_BIRD_RECEIPT
                  : Array.isArray(data?.results)         ? data.results
                  : Array.isArray(data)                  ? data : [];
    const saved   = await saveBirdReceiptToDB(records);
    const rows    = (await pool.query('SELECT * FROM sap_bird_receipt ORDER BY bldat DESC, updated_at DESC LIMIT 1000')).rows;
    syncResponse(res, { sapEndpoint: 'zbird_receipt', sapCount: records.length, saved, tableName: 'sap_bird_receipt', rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Sync: Feed & Medicine ─────────────────────────────────────────────────
exports.syncFeedMedicine = async (req, res) => {
  try {
    const data    = await fetchSAP('zfeed_med', req.query);
    const records = Array.isArray(data?.ET_FEED_MED) ? data.ET_FEED_MED
                  : Array.isArray(data?.results)     ? data.results
                  : Array.isArray(data)              ? data : [];
    const saved   = await saveFeedMedicineToDB(records);
    const rows    = (await pool.query('SELECT * FROM sap_feed_medicine ORDER BY bldat DESC, updated_at DESC LIMIT 1000')).rows;
    syncResponse(res, { sapEndpoint: 'zfeed_med', sapCount: records.length, saved, tableName: 'sap_feed_medicine', rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Sync: Laying / Egg Collection ─────────────────────────────────────────
exports.syncLaying = async (req, res) => {
  try {
    const data    = await fetchSAP('zlaying_prelay', req.query);
    const records = Array.isArray(data?.ET_LAYING) ? data.ET_LAYING
                  : Array.isArray(data?.results)   ? data.results
                  : Array.isArray(data)             ? data : [];
    const saved   = await saveLayingToDB(records);
    const rows    = (await pool.query('SELECT * FROM sap_laying ORDER BY bldat DESC, updated_at DESC LIMIT 1000')).rows;
    syncResponse(res, { sapEndpoint: 'zlaying_prelay', sapCount: records.length, saved, tableName: 'sap_laying', rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Sync: Mortality ───────────────────────────────────────────────────────
exports.syncMortality = async (req, res) => {
  try {
    const data    = await fetchSAP('zmortality_ent', req.query);
    const records = Array.isArray(data?.ET_MORTALITY) ? data.ET_MORTALITY
                  : Array.isArray(data?.results)      ? data.results
                  : Array.isArray(data)               ? data : [];
    const saved   = await saveMortalityToDB(records);
    const rows    = (await pool.query('SELECT * FROM sap_mortality ORDER BY bldat DESC, updated_at DESC LIMIT 1000')).rows;
    syncResponse(res, { sapEndpoint: 'zmortality_ent', sapCount: records.length, saved, tableName: 'sap_mortality', rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Sync: Culls Kill ──────────────────────────────────────────────────────
exports.syncCullsKill = async (req, res) => {
  try {
    const data    = await fetchSAP('zculls_kill', req.query);
    const records = Array.isArray(data?.ET_CULLS_KILL) ? data.ET_CULLS_KILL
                  : Array.isArray(data?.results)       ? data.results
                  : Array.isArray(data)                ? data : [];
    const saved   = await saveCullsKillToDB(records);
    const rows    = (await pool.query('SELECT * FROM sap_culls_kill ORDER BY bldat DESC, updated_at DESC LIMIT 1000')).rows;
    syncResponse(res, { sapEndpoint: 'zculls_kill', sapCount: records.length, saved, tableName: 'sap_culls_kill', rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Sync: Culls Sale ──────────────────────────────────────────────────────
exports.syncCullsSale = async (req, res) => {
  try {
    const data    = await fetchSAP('zculls_sale', req.query);
    const records = Array.isArray(data?.ET_CULLS_SALE) ? data.ET_CULLS_SALE
                  : Array.isArray(data?.results)       ? data.results
                  : Array.isArray(data)                ? data : [];
    const saved   = await saveSaleReceiptToDB(records);
    const rows    = (await pool.query('SELECT * FROM sap_sale_receipt ORDER BY bldat DESC, updated_at DESC LIMIT 1000')).rows;
    syncResponse(res, { sapEndpoint: 'zculls_sale', sapCount: records.length, saved, tableName: 'sap_sale_receipt', rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Sync: Estimated Cost ──────────────────────────────────────────────────
exports.syncEstimatedCost = async (req, res) => {
  try {
    const data    = await fetchSAP('zestimated_cost', req.query);
    const records = Array.isArray(data?.ET_EST_COST) ? data.ET_EST_COST
                  : Array.isArray(data?.results)     ? data.results
                  : Array.isArray(data)              ? data : [];
    const saved   = await saveEstimatedCostToDB(records);
    const rows    = (await pool.query('SELECT * FROM sap_estimated_cost ORDER BY bldat DESC, updated_at DESC LIMIT 1000')).rows;
    syncResponse(res, { sapEndpoint: 'zestimated_cost', sapCount: records.length, saved, tableName: 'sap_estimated_cost', rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET from DB only (no SAP call) ────────────────────────────────────────
exports.getBirdReceipt    = async (req, res) => getFromDB(res, 'sap_bird_receipt',   'bldat DESC');
exports.getFeedMedicine   = async (req, res) => getFromDB(res, 'sap_feed_medicine',  'bldat DESC');
exports.getLaying         = async (req, res) => getFromDB(res, 'sap_laying',         'bldat DESC');
exports.getMortality      = async (req, res) => getFromDB(res, 'sap_mortality',      'bldat DESC');
exports.getCullsKill      = async (req, res) => getFromDB(res, 'sap_culls_kill',     'bldat DESC');
exports.getCullsSale      = async (req, res) => getFromDB(res, 'sap_sale_receipt',   'bldat DESC');
exports.getEstimatedCost  = async (req, res) => getFromDB(res, 'sap_estimated_cost', 'bldat DESC');

async function getFromDB(res, table, order) {
  try {
    const { werks, lifnr, from_date, to_date, limit = 500 } = res.req.query;
    let where = []; let params = []; let idx = 1;
    if (werks)     { where.push(`werks = $${idx++}`);          params.push(werks); }
    if (lifnr)     { where.push(`lifnr = $${idx++}`);          params.push(lifnr); }
    if (from_date) { where.push(`bldat >= $${idx++}`);         params.push(from_date); }
    if (to_date)   { where.push(`bldat <= $${idx++}`);         params.push(to_date); }
    const sql = `SELECT * FROM ${table} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                 ORDER BY ${order} LIMIT $${idx}`;
    params.push(parseInt(limit));
    const result = await pool.query(sql, params);
    res.json({ success: true, sap_table: table, total: result.rows.length, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}
