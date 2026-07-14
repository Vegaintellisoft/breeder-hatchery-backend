const axios = require('axios');
const pool = require('../config/db');

const SAP_BREEDER_BASE =
  process.env.SAP_BASE_URL || 'http://krishidevqas.krishinutrition.com:8001/sap/bc/breeder';
const SAP_MOBILE_BASE =
  process.env.SAP_MOBILE_BASE_URL || 'http://krishidevqas.krishinutrition.com:8001/sap/bc/mobile_app';
const SAP_AUTH = {
  username: process.env.SAP_USER || 'vega',
  password: process.env.SAP_PASSWORD || 'Vegaintell@123',
};
const SAP_CLIENT = process.env.SAP_CLIENT || '500';

const MODULE_ENDPOINTS = {
  feeding: 'zfeed_med',
  laying: 'zlaying_prelay',
  mortality: 'zmortality_ent',
  cull_kill: 'zculls_kill',
  cull_sale: 'zculls_sale',
  bird_receipt: 'zbird_receipt',
};

function normalizeModule(module) {
  if (!module) return null;
  const key = String(module).trim().toLowerCase();
  const aliases = {
    feed: 'feeding',
    feed_med: 'feeding',
    feeding: 'feeding',
    laying: 'laying',
    prelaying: 'laying',
    laying_prelay: 'laying',
    mortality: 'mortality',
    cull_kill: 'cull_kill',
    culls_kill: 'cull_kill',
    cull_sale: 'cull_sale',
    culls_sale: 'cull_sale',
    bird_receipt: 'bird_receipt',
    birdreceipt: 'bird_receipt',
  };
  return aliases[key] || null;
}

function getFlockFields(moduleKey) {
  if (moduleKey === 'feeding') {
    return { code: 'plnbez', name: 'plnbezN' };
  }
  if (moduleKey === 'cull_sale' || moduleKey === 'bird_receipt') {
    return { code: 'plnbez', name: 'plnbezN' };
  }
  return { code: 'matnr', name: 'maktx' };
}

function pick(...vals) {
  for (const v of vals) {
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

function extractPlantRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload?.d?.results)) return payload.d.results;
  return payload ? [payload] : [];
}

function mapPlantRow(row) {
  const plantCode = pick(
    row.Key, row.key, row.WERKS, row.Werks, row.werks, row.plant_code, row.PlantCode, row.value
  );
  const plantName = pick(
    row.Text, row.text, row.NAME1, row.Name_co, row.name1, row.plant_name, row.PlantName, row.label
  );
  return {
    plant_code: plantCode,
    plant_name: plantName,
    label: `${plantCode} - ${plantName}`,
  };
}

function isValidPlantCode(code) {
  return /^\d{4}$/.test(String(code || '').trim());
}

async function ensureSapPlantCacheTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sap_plant_cache (
      module VARCHAR(50) NOT NULL,
      plant_code VARCHAR(20) NOT NULL,
      plant_name VARCHAR(255),
      payload JSONB NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (module, plant_code)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_sap_plant_cache_module ON sap_plant_cache(module)`);
}

async function upsertPlantCache(module, plants) {
  if (!Array.isArray(plants) || plants.length === 0) return;
  await ensureSapPlantCacheTable();
  for (const p of plants) {
    if (!p.plant_code) continue;
    await pool.query(
      `INSERT INTO sap_plant_cache (module, plant_code, plant_name, payload, updated_at)
       VALUES ($1, $2, $3, $4::jsonb, NOW())
       ON CONFLICT (module, plant_code)
       DO UPDATE SET
         plant_name = EXCLUDED.plant_name,
         payload = EXCLUDED.payload,
         updated_at = NOW()`,
      [module, p.plant_code, p.plant_name || null, JSON.stringify(p)]
    );
  }
}

async function fetchPlantCache(module) {
  await ensureSapPlantCacheTable();
  const q = await pool.query(
    `SELECT payload
       FROM sap_plant_cache
      WHERE module = $1
      ORDER BY plant_code`,
    [module]
  );
  return q.rows.map((r) => r.payload).filter((p) => p && p.plant_code);
}

async function fetchFarmPlants() {
  try {
    const q = await pool.query(`SELECT plant_code, plant_name FROM farms ORDER BY plant_code`);
    return q.rows
      .map((r) => ({
        plant_code: pick(r.plant_code),
        plant_name: pick(r.plant_name),
        label: `${pick(r.plant_code)} - ${pick(r.plant_name)}`,
      }))
      .filter((p) => p.plant_code);
  } catch (_) {
    return [];
  }
}

async function fetchKnownLocalPlantCodes() {
  const out = new Map();
  try {
    const shiftQ = await pool.query(`
      SELECT DISTINCT plant_code
      FROM supervisor_plant_shifts
      WHERE plant_code IS NOT NULL AND TRIM(plant_code) <> ''
    `);
    for (const r of shiftQ.rows) {
      const code = pick(r.plant_code);
      if (code) out.set(code, { plant_code: code, plant_name: '', label: `${code} - ` });
    }
  } catch (_) {}

  try {
    const flockQ = await pool.query(`
      SELECT DISTINCT farm_code AS plant_code
      FROM flock_master
      WHERE farm_code IS NOT NULL AND TRIM(farm_code) <> ''
    `);
    for (const r of flockQ.rows) {
      const code = pick(r.plant_code);
      if (code && !out.has(code)) out.set(code, { plant_code: code, plant_name: '', label: `${code} - ` });
    }
  } catch (_) {}

  return Array.from(out.values());
}

async function fetchBreederData(moduleKey, werks, aufnr) {
  const endpoint = MODULE_ENDPOINTS[moduleKey];
  const params = { 'sap-client': SAP_CLIENT, werks };
  if (aufnr) params.aufnr = aufnr;

  const response = await axios.get(`${SAP_BREEDER_BASE}/${endpoint}`, {
    auth: SAP_AUTH,
    params,
    timeout: 30000,
  });

  const data = response.data;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.results)) return data.results;
  return data ? [data] : [];
}

function buildOrderList(rows) {
  const map = new Map();
  for (const row of rows) {
    const orderNo = String(row.aufnr || '').trim();
    if (!orderNo) continue;
    if (map.has(orderNo)) continue;

    map.set(orderNo, {
      order_no: orderNo,
      plant_code: row.werks || null,
      hatch_date: row.hatchdt || null,
      batch: row.batch || null,
      label: orderNo,
    });
  }
  return Array.from(map.values());
}

function buildFlockList(rows, moduleKey) {
  const fields = getFlockFields(moduleKey);
  const map = new Map();

  const deriveStage = (ageDays) => {
    const age = Number(ageDays);
    if (!Number.isFinite(age)) return null;
    if (age <= 42) return 'Brooming';
    if (age <= 126) return 'Grooming';
    return 'Laying';
  };

  const toNum = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  for (const row of rows) {
    const flockNo = String(row[fields.code] || '').trim();
    if (!flockNo) continue;

    const key = `${row.aufnr || ''}__${flockNo}`;
    const flockName = row[fields.name] ? String(row[fields.name]).replace(/\s+/g, ' ').trim() : flockNo;
    const ageDays = row.zzAge ?? null;
    const stockTotal = row.zzstock ?? row.stock ?? null;
    const femaleStock = row.zzFstk ?? null;
    const maleStock = row.zzMstk ?? null;

    if (!map.has(key)) {
      map.set(key, {
        order_no: row.aufnr || null,
        plant_code: row.werks || null,
        flock_no: flockNo,
        flock_name: flockName,
        hatch_date: row.hatchdt || null,
        age_days: ageDays,
        stage: deriveStage(ageDays),
        stock_total: stockTotal,
        total_count: stockTotal, // alias for UI
        female_stock: femaleStock,
        male_stock: maleStock,
        female_count: femaleStock, // alias for UI
        male_count: maleStock, // alias for UI
        count: stockTotal, // alias for UI
        mortality: 0,
        cull_kill: 0,
        cull_kill_count: 0,
        cull_sales: 0,
        bird_sales: 0,
        egg_collection: 0,
        batch: row.batch || null,
        label: `${flockNo} - ${flockName}`,
      });
    }

    const item = map.get(key);
    const qty = moduleKey === 'laying' ? toNum(row.grQty) : toNum(row.fkimg);
    if (moduleKey === 'mortality') item.mortality += qty;
    if (moduleKey === 'cull_kill') {
      item.cull_kill += qty;
      item.cull_kill_count += qty;
    }
    if (moduleKey === 'cull_sale') item.cull_sales += qty;
    if (moduleKey === 'bird_receipt') item.bird_sales += qty;
    if (moduleKey === 'laying') item.egg_collection += qty;
  }

  return Array.from(map.values());
}

exports.getPlants = async (req, res) => {
  const cacheModule = 'sap_live_plants';
  try {
    const response = await axios.get(`${SAP_MOBILE_BASE}/shed_ready/get_plant`, {
      auth: SAP_AUTH,
      params: { 'sap-client': SAP_CLIENT },
      timeout: 30000,
    });

    const rows = extractPlantRows(response.data);
    const mappedRaw = rows.map(mapPlantRow).filter((p) => isValidPlantCode(p.plant_code));

    const plantMap = new Map();
    for (const p of mappedRaw) {
      const prev = plantMap.get(p.plant_code);
      if (!prev || (!prev.plant_name && p.plant_name)) plantMap.set(p.plant_code, p);
    }
    const deduped = Array.from(plantMap.values());
    const farmPlants = await fetchFarmPlants();
    const knownLocal = await fetchKnownLocalPlantCodes();
    for (const p of [...knownLocal, ...farmPlants]) {
      if (!isValidPlantCode(p.plant_code)) continue;
      const prev = plantMap.get(p.plant_code);
      if (!prev || (!prev.plant_name && p.plant_name)) plantMap.set(p.plant_code, p);
    }
    const merged = Array.from(plantMap.values());

    await upsertPlantCache(cacheModule, merged);
    const localData = (await fetchPlantCache(cacheModule))
      .filter((p) => isValidPlantCode(p.plant_code))
      .map((p) => ({
        plant_code: String(p.plant_code || '').trim(),
        plant_name: String(p.plant_name || '').trim(),
        label: `${String(p.plant_code || '').trim()} - ${String(p.plant_name || '').trim()}`,
      }))
      .sort((a, b) => a.plant_code.localeCompare(b.plant_code));

    return res.json({
      success: true,
      source: 'local_cache_after_sap_sync',
      sap_total: rows.length,
      total: localData.length,
      data: localData
    });
  } catch (err) {
    const localData = (await fetchPlantCache(cacheModule))
      .filter((p) => isValidPlantCode(p.plant_code))
      .map((p) => ({
        plant_code: String(p.plant_code || '').trim(),
        plant_name: String(p.plant_name || '').trim(),
        label: `${String(p.plant_code || '').trim()} - ${String(p.plant_name || '').trim()}`,
      }))
      .sort((a, b) => a.plant_code.localeCompare(b.plant_code));

    return res.status(localData.length ? 200 : 503).json({
      success: localData.length > 0,
      message: localData.length ? 'SAP failed; serving local cache' : 'Failed to fetch plants from SAP',
      error: localData.length ? undefined : err.message,
      source: 'local_cache_fallback',
      total: localData.length,
      data: localData,
    });
  }
};

exports.getOrders = async (req, res) => {
  const moduleKey = normalizeModule(req.query.module);
  const { werks } = req.query;

  if (!moduleKey || !MODULE_ENDPOINTS[moduleKey]) {
    return res.status(422).json({
      success: false,
      message: 'module required',
      valid_modules: Object.keys(MODULE_ENDPOINTS),
    });
  }
  if (!werks) {
    return res.status(422).json({ success: false, message: 'werks required' });
  }

  try {
    const rows = await fetchBreederData(moduleKey, werks);
    const orders = buildOrderList(rows);
    return res.json({
      success: true,
      module: moduleKey,
      endpoint: MODULE_ENDPOINTS[moduleKey],
      werks,
      total: orders.length,
      data: orders,
    });
  } catch (err) {
    return res.status(503).json({
      success: false,
      message: 'Failed to fetch order numbers from SAP',
      error: err.message,
    });
  }
};

exports.getFlocks = async (req, res) => {
  const moduleKey = normalizeModule(req.query.module);
  const { werks, aufnr } = req.query;

  if (!moduleKey || !MODULE_ENDPOINTS[moduleKey]) {
    return res.status(422).json({
      success: false,
      message: 'module required',
      valid_modules: Object.keys(MODULE_ENDPOINTS),
    });
  }
  if (!werks || !aufnr) {
    return res.status(422).json({ success: false, message: 'werks and aufnr required' });
  }

  try {
    const rows = await fetchBreederData(moduleKey, werks, aufnr);
    const flocks = buildFlockList(rows, moduleKey);
    return res.json({
      success: true,
      module: moduleKey,
      endpoint: MODULE_ENDPOINTS[moduleKey],
      werks,
      aufnr,
      total: flocks.length,
      data: flocks,
    });
  } catch (err) {
    return res.status(503).json({
      success: false,
      message: 'Failed to fetch flocks from SAP',
      error: err.message,
    });
  }
};

exports.getChain = async (req, res) => {
  const moduleKey = normalizeModule(req.query.module);
  const { werks } = req.query;

  if (!moduleKey || !MODULE_ENDPOINTS[moduleKey]) {
    return res.status(422).json({
      success: false,
      message: 'module required',
      valid_modules: Object.keys(MODULE_ENDPOINTS),
    });
  }
  if (!werks) {
    return res.status(422).json({ success: false, message: 'werks required' });
  }

  try {
    const rows = await fetchBreederData(moduleKey, werks);
    const orders = buildOrderList(rows);
    const flocks = buildFlockList(rows, moduleKey);

    return res.json({
      success: true,
      module: moduleKey,
      endpoint: MODULE_ENDPOINTS[moduleKey],
      werks,
      orders_total: orders.length,
      flocks_total: flocks.length,
      orders,
      flocks,
    });
  } catch (err) {
    return res.status(503).json({
      success: false,
      message: 'Failed to fetch SAP dropdown chain',
      error: err.message,
    });
  }
};
