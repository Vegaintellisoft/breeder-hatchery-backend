const axios = require('axios');
const crypto = require('crypto');
const pool = require('../config/db');

const SAP_HATCHERY_BASE =
  process.env.SAP_HATCHERY_BASE_URL || 'http://krishidevqas.krishinutrition.com:8001/sap/bc/hatchery';
const SAP_MOBILE_BASE =
  process.env.SAP_MOBILE_BASE_URL || 'http://krishidevqas.krishinutrition.com:8001/sap/bc/mobile_app';
const SAP_AUTH = {
  username: process.env.SAP_USER || 'vega',
  password: process.env.SAP_PASSWORD || 'Vega@1234',
};
const SAP_CLIENT = process.env.SAP_CLIENT || '500';

function toRows(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.results)) return data.results;
  return data ? [data] : [];
}

async function ensureHatcheryCacheTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hatchery_sap_cache (
      id BIGSERIAL PRIMARY KEY,
      module VARCHAR(40) NOT NULL,
      cache_key VARCHAR(64) NOT NULL,
      werks VARCHAR(20),
      lifnr VARCHAR(30),
      sap_date VARCHAR(20),
      matnr VARCHAR(40),
      payload JSONB NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE (module, cache_key)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_hatchery_cache_module ON hatchery_sap_cache(module)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_hatchery_cache_werks ON hatchery_sap_cache(werks)`);
}

function pick(...vals) {
  for (const v of vals) {
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

/** SAP often sends DD.MM.YYYY; API query uses YYYY-MM-DD — normalize for cache column + filters */
function normalizeCacheDate(input) {
  const raw = String(input == null ? '' : input).trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const m = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) {
    const dd = m[1].padStart(2, '0');
    const mm = m[2].padStart(2, '0');
    return `${m[3]}-${mm}-${dd}`;
  }
  const m2 = raw.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (m2) {
    const mm = m2[2].padStart(2, '0');
    const dd = m2[3].padStart(2, '0');
    return `${m2[1]}-${mm}-${dd}`;
  }
  return null;
}

function germanDotsFromYmd(ymd) {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const [y, mo, d] = ymd.split('-');
  return `${parseInt(d, 10)}.${parseInt(mo, 10)}.${y}`;
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
  return { plant_code: plantCode, plant_name: plantName };
}

function isValidPlantCode(code) {
  return /^\d{4}$/.test(String(code || '').trim());
}

async function fetchFarmPlants() {
  try {
    const q = await pool.query(`SELECT plant_code, plant_name FROM farms ORDER BY plant_code`);
    return q.rows.map((r) => ({
      plant_code: pick(r.plant_code),
      plant_name: pick(r.plant_name),
    })).filter((p) => p.plant_code);
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
      if (code) out.set(code, { plant_code: code, plant_name: '' });
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
      if (code && !out.has(code)) out.set(code, { plant_code: code, plant_name: '' });
    }
  } catch (_) {}

  return Array.from(out.values());
}

function rowMeta(row) {
  const werks = pick(row.werks, row.WERKS, row.plant_code);
  const lifRaw = pick(row.lifnr, row.LIFNR, row.vendor_code, row.vendor);
  const lifnr = lifRaw ? String(lifRaw).trim().toUpperCase() : '';
  const rawDate = pick(row.bldat, row.BLDAT, row.budat, row.BUDAT, row.date, row.DATE, row.doc_date);
  const rawTrim = rawDate ? String(rawDate).trim() : '';
  const sapDate = normalizeCacheDate(rawTrim) || (rawTrim || null);
  const matRaw = pick(row.matnr, row.MATNR, row.matnre, row.MATNRE, row.material_code, row.Matnr);
  const matnr = matRaw ? String(matRaw).trim().toUpperCase() : '';
  return { werks, lifnr: lifnr || null, sapDate, matnr: matnr || null };
}

function makeCacheKey(module, row) {
  const { werks, lifnr, sapDate, matnr } = rowMeta(row);
  const identity = JSON.stringify({ module, werks, lifnr, sapDate, matnr, row });
  return crypto.createHash('md5').update(identity).digest('hex');
}

function pickSupplierName(r) {
  return pick(
    r.lName1, r.LName1, r['lName1'], r.NAME1, r.name1,
    r.vendor_name, r.VENDOR_NAME, r.VendorName, r.supplier_name, r.SUPPLIER_NAME,
    r.lifnr_txt, r.LifnrName
  );
}

function numFromRow(row, ...keys) {
  const r = row && typeof row === 'object' ? row : {};
  for (const k of keys) {
    if (!(k in r) || r[k] === undefined || r[k] === null) continue;
    const s = String(r[k]).trim().replace(/,/g, '');
    if (s === '') continue;
    const n = Number(s);
    if (!Number.isNaN(n)) return n;
  }
  return null;
}

/** Figma "Add Grading & Setting" — stable keys; SAP field names vary by service version */
function mapGradeSettingScreen(row) {
  const r = row && typeof row === 'object' ? row : {};
  const rej =
    (Array.isArray(r.setting_rejection_reasons) && r.setting_rejection_reasons) ||
    (Array.isArray(r.rejection_reasons) && r.rejection_reasons) ||
    (Array.isArray(r.setting_reasons) && r.setting_reasons) ||
    (Array.isArray(r.reasons) && r.reasons) ||
    [];
  return {
    run_date_from:
      pick(r.run_date_from, r.date_from, r.von_dat, r.VON_DAT, r.from_date, r.FROM_DATE) || null,
    run_date_to: pick(r.run_date_to, r.date_to, r.bis_dat, r.BIS_DAT, r.to_date, r.TO_DATE) || null,
    flock_no: pick(r.flock_no, r.plnbez, r.PLNBEZ, r.FLOCK, r.flock) || null,
    machine_code: pick(r.machine_code, r.machine, r.MACHINE, r.mach_code, r.MACH_CODE, r.equnr, r.EQUNR) || null,
    received_egg_qty: numFromRow(r, 'received_egg_qty', 'recv_qty', 'egg_recv', 'MENGE1', 'menge1', 'MENGE', 'menge', 'egg_qty', 'EGG_QTY'),
    grading_egg_qty: numFromRow(r, 'grading_egg_qty', 'grade_qty', 'grad_qty', 'MENGE2', 'menge2'),
    egg_weight_gm: numFromRow(r, 'egg_weight_gm', 'egg_weight', 'gewicht', 'GEWICHT', 'weight_gm', 'NTGEW', 'ntgew'),
    setting_temp: numFromRow(r, 'setting_temp', 'setting_temp_c', 'set_temp', 'temp', 'TEMP', 'TEMPER'),
    setter_details: pick(r.setter_details, r.setter, r.SETTER, r.setter_id, r.setter_no, r.SETTER_NO) || null,
    batch_no: pick(r.batch_no, r.charg, r.CHARG, r.batch, r.BATCH, r.lot, r.aufnr, r.AUFNR) || null,
    setting_egg_qty: numFromRow(r, 'setting_egg_qty', 'set_qty', 'MENGE3', 'menge3'),
    setting_rejection_qty: numFromRow(
      r,
      'setting_rejection_qty',
      'rej_qty',
      'reject_qty',
      'rejection_qty',
      'MENGE4',
      'menge4'
    ),
    chick_code: pick(r.chick_code, r.matnr, r.MATNR, r.matnre, r.MATNRE, r.material_code) || null,
    setting_rejection_reasons: rej,
  };
}

/** Transfer / pullout screen — same pattern */
function mapTransferPulloutScreen(row) {
  const r = row && typeof row === 'object' ? row : {};
  const reasons =
    (Array.isArray(r.pullout_reasons) && r.pullout_reasons) ||
    (Array.isArray(r.reasons) && r.reasons) ||
    [];
  return {
    run_date_from: pick(r.run_date_from, r.date_from, r.von_dat, r.VON_DAT) || null,
    run_date_to: pick(r.run_date_to, r.date_to, r.bis_dat, r.BIS_DAT) || null,
    flock_no: pick(r.flock_no, r.plnbez, r.PLNBEZ) || null,
    machine_code: pick(r.machine_code, r.equnr, r.EQUNR, r.mach_code, r.MACH_CODE) || null,
    batch_no: pick(r.batch_no, r.charg, r.CHARG, r.aufnr, r.AUFNR) || null,
    pullout_qty: numFromRow(r, 'pullout_qty', 'qty', 'MENGE', 'menge', 'pull_qty'),
    chick_code: pick(r.chick_code, r.matnr, r.MATNR) || null,
    pullout_reasons: reasons,
  };
}

function normalizeRows(rows) {
  return (rows || []).map((r) => {
    const werks = pick(r.werks, r.WERKS, r.plant_code);
    const lifnr = pick(r.lifnr, r.LIFNR, r.vendor_code, r.vendor);
    const poNo = pick(r.ebeln, r.EBELN, r.po_no, r.ponum, r.poNumber, r.aufnr, r.AUFNR);
    const flockNo = pick(r.plnbez, r.PLNBEZ, r.flock_no, r.matnr, r.MATNR);
    const flockName = pick(r.plnbezn, r.PLNBEZN, r.flock_name, r.maktx, r.MAKTX);
    const matnr = pick(r.matnr, r.MATNR, r.matnre, r.MATNRE, r.material_code);
    const sapDate = pick(r.bldat, r.BLDAT, r.date, r.DATE, r.doc_date);
    const supplierName = pickSupplierName(r);
    return {
      ...r,
      __werks: werks,
      __lifnr: lifnr,
      __po_no: poNo,
      __flock_no: flockNo,
      __flock_name: flockName,
      __matnr: matnr,
      __date: sapDate,
      __supplier_name: supplierName,
    };
  });
}

async function upsertRowsToLocal(module, rows) {
  if (!rows.length) return 0;
  await ensureHatcheryCacheTable();
  let saved = 0;
  for (const row of rows) {
    const { werks, lifnr, sapDate, matnr } = rowMeta(row);
    const cacheKey = makeCacheKey(module, row);
    await pool.query(
      `INSERT INTO hatchery_sap_cache (module, cache_key, werks, lifnr, sap_date, matnr, payload, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,NOW())
       ON CONFLICT (module, cache_key)
       DO UPDATE SET
         werks=EXCLUDED.werks,
         lifnr=EXCLUDED.lifnr,
         sap_date=EXCLUDED.sap_date,
         matnr=EXCLUDED.matnr,
         payload=EXCLUDED.payload,
         updated_at=NOW()`,
      [module, cacheKey, werks || null, lifnr || null, sapDate || null, matnr || null, JSON.stringify(row)]
    );
    saved++;
  }
  return saved;
}

async function fetchLocalRows(module, filters = {}) {
  await ensureHatcheryCacheTable();
  const conds = ['module=$1'];
  const vals = [module];
  if (filters.werks) {
    vals.push(filters.werks);
    conds.push(`werks=$${vals.length}`);
  }
  if (filters.lifnr) {
    vals.push(String(filters.lifnr).trim().toUpperCase());
    conds.push(`UPPER(TRIM(COALESCE(lifnr,''))) = $${vals.length}`);
  }
  if (filters.date) {
    const trimmed = String(filters.date || '').trim();
    const iso = normalizeCacheDate(trimmed) || (/^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null);
    const de = germanDotsFromYmd(iso);
    if (iso && de) {
      const i0 = vals.length + 1;
      vals.push(iso);
      const i1 = vals.length + 1;
      vals.push(de);
      conds.push(`(sap_date = $${i0} OR sap_date = $${i1})`);
    } else if (iso) {
      vals.push(iso);
      conds.push(`sap_date = $${vals.length}`);
    } else if (trimmed) {
      vals.push(trimmed);
      conds.push(`sap_date = $${vals.length}`);
    }
  }
  if (filters.matnr) {
    const m = String(filters.matnr).trim().toUpperCase();
    vals.push(m);
    conds.push(`UPPER(TRIM(COALESCE(matnr,''))) = $${vals.length}`);
  }
  const q = await pool.query(
    `SELECT payload
       FROM hatchery_sap_cache
      WHERE ${conds.join(' AND ')}
      ORDER BY updated_at DESC`,
    vals
  );
  return q.rows.map((r) => r.payload);
}

async function fetchHatchery(endpoint, params = {}) {
  const cleanParams = {};
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null) continue;
    const s = String(v).trim();
    if (!s) continue;
    cleanParams[k] = s;
  }
  try {
    const response = await axios.get(`${SAP_HATCHERY_BASE}/${endpoint}`, {
      auth: SAP_AUTH,
      params: { 'sap-client': SAP_CLIENT, ...cleanParams },
      timeout: 30000,
    });
    return toRows(response.data);
  } catch (err) {
    const status = err.response?.status;
    const body = String(err.response?.data || '').toLowerCase();
    // SAP hatchery endpoints return 400 "No record Found" for empty result.
    if (status === 400 && body.includes('no record')) return [];
    throw err;
  }
}

exports.getPlants = async (req, res) => {
  const moduleKey = 'plants';
  try {
    const response = await axios.get(`${SAP_MOBILE_BASE}/shed_ready/get_plant`, {
      auth: SAP_AUTH,
      params: { 'sap-client': SAP_CLIENT },
      timeout: 30000,
    });

    const rows = extractPlantRows(response.data);
    const mappedRaw = rows
      .map(mapPlantRow)
      .filter((p) => isValidPlantCode(p.plant_code));

    // Keep one row per plant_code and prefer row with non-empty name.
    const plantMap = new Map();
    for (const p of mappedRaw) {
      const prev = plantMap.get(p.plant_code);
      if (!prev || (!prev.plant_name && p.plant_name)) plantMap.set(p.plant_code, p);
    }
    const deduped = Array.from(plantMap.values());

    const farmPlants = await fetchFarmPlants();
    const knownLocal = await fetchKnownLocalPlantCodes();
    const mergedMap = new Map();
    for (const p of [...knownLocal, ...farmPlants, ...deduped]) {
      if (!isValidPlantCode(p.plant_code)) continue;
      const prev = mergedMap.get(p.plant_code);
      if (!prev || (!prev.plant_name && p.plant_name)) mergedMap.set(p.plant_code, p);
    }
    const merged = Array.from(mergedMap.values());

    const hatcheryOnly = merged.filter((p) => /hatcher(y|ies)/i.test(p.plant_name));
    const toCache = (hatcheryOnly.length > 0 ? hatcheryOnly : merged)
      .map((p) => ({ ...p, label: `${p.plant_code} - ${p.plant_name}` }));

    await upsertRowsToLocal(moduleKey, toCache);
    const localData = (await fetchLocalRows(moduleKey))
      .filter((p) => p && isValidPlantCode(p.plant_code))
      .map((p) => ({
        plant_code: String(p.plant_code).trim(),
        plant_name: String(p.plant_name || '').trim(),
        label: `${String(p.plant_code || '').trim()} - ${String(p.plant_name || '').trim()}`,
      }))
      .sort((a, b) => a.plant_code.localeCompare(b.plant_code));

    return res.json({
      success: true,
      module: 'hatchery',
      source: 'local_cache_after_sap_sync',
      sap_total: rows.length,
      total: localData.length,
      data: localData
    });
  } catch (err) {
    const localData = (await fetchLocalRows(moduleKey))
      .filter((p) => p && isValidPlantCode(p.plant_code))
      .map((p) => ({
        plant_code: String(p.plant_code).trim(),
        plant_name: String(p.plant_name || '').trim(),
        label: `${String(p.plant_code || '').trim()} - ${String(p.plant_name || '').trim()}`,
      }))
      .sort((a, b) => a.plant_code.localeCompare(b.plant_code));

    return res.status(localData.length ? 200 : 503).json({
      success: localData.length > 0,
      module: 'hatchery',
      message: localData.length
        ? 'SAP failed; serving plant list from local cache'
        : 'Failed to fetch hatchery plant list from SAP',
      error: localData.length ? undefined : err.message,
      source: 'local_cache_fallback',
      total: localData.length,
      data: localData,
    });
  }
};

exports.getEggReceipt = async (req, res) => {
  const { werks = '', lifnr = '' } = req.query;
  try {
    const rows = await fetchHatchery('egg_receipt', { werks, lifnr });
    const saved = await upsertRowsToLocal('egg_receipt', rows);
    const localData = await fetchLocalRows('egg_receipt', { werks, lifnr });
    return res.json({
      success: true,
      module: 'hatchery',
      endpoint: 'egg_receipt',
      filters: { werks, lifnr },
      source: 'local_cache_after_sap_sync',
      sap_total: rows.length,
      saved_to_local: saved,
      total: localData.length,
      data: localData,
    });
  } catch (err) {
    const localData = await fetchLocalRows('egg_receipt', { werks, lifnr });
    return res.status(503).json({
      success: false,
      message: 'Failed to fetch hatchery egg receipt from SAP; serving local cache',
      error: err.message,
      source: 'local_cache_fallback',
      total: localData.length,
      data: localData,
    });
  }
};

// Chain step 1 (after plant): suppliers for that plant — pick one or type lifnr manually
// GET /api/hatchery-live/suppliers?werks=1803
exports.getSuppliersByPlant = async (req, res) => {
  const werks = String(req.query.werks || '').trim();
  if (!werks) {
    return res.status(422).json({ success: false, message: 'werks (plant) required' });
  }
  try {
    let rows = [];
    try {
      rows = await fetchHatchery('egg_receipt', { werks });
      if (rows.length) await upsertRowsToLocal('egg_receipt', rows);
    } catch (_) {
      rows = [];
    }

    if (!rows.length) {
      await ensureHatcheryCacheTable();
      const cq = await pool.query(
        `SELECT DISTINCT ON (lifnr) lifnr, payload
           FROM hatchery_sap_cache
          WHERE module = 'egg_receipt'
            AND werks = $1
            AND lifnr IS NOT NULL
            AND TRIM(lifnr) <> ''
          ORDER BY lifnr, updated_at DESC`,
        [werks]
      );
      rows = cq.rows.map((row) => {
        const p = row.payload || {};
        return typeof p === 'object' ? { ...p, lifnr: row.lifnr || p.lifnr } : { lifnr: row.lifnr };
      });
    }

    const normalized = normalizeRows(rows).filter((r) => {
      if (!r.__lifnr) return false;
      if (r.__werks && r.__werks !== werks) return false;
      return true;
    });

    const map = new Map();
    for (const r of normalized) {
      const code = r.__lifnr;
      const name = pick(r.__supplier_name, pickSupplierName(r));
      const prev = map.get(code);
      if (!prev) {
        map.set(code, { lifnr: code, supplier_name: name, label: name ? `${code} - ${name}` : code });
      } else if (!prev.supplier_name && name) {
        map.set(code, { lifnr: code, supplier_name: name, label: name ? `${code} - ${name}` : code });
      }
    }

    const data = Array.from(map.values()).sort((a, b) => a.lifnr.localeCompare(b.lifnr));
    return res.json({
      success: true,
      module: 'hatchery',
      step: 'suppliers',
      werks,
      source: rows.length ? 'sap_or_cache_refresh' : 'local_cache',
      total: data.length,
      data,
      hint: 'User may also enter lifnr manually if not listed; then call /po-list with werks + lifnr.',
    });
  } catch (err) {
    return res.status(503).json({
      success: false,
      message: 'Failed to resolve suppliers for plant',
      error: err.message,
    });
  }
};

// Chain step 2: plant + supplier (lifnr) -> list PO numbers
exports.getPoList = async (req, res) => {
  const { werks = '', lifnr = '' } = req.query;
  if (!String(werks || '').trim() || !String(lifnr || '').trim()) {
    return res.status(422).json({ success: false, message: 'werks (plant) and lifnr (supplier) required' });
  }
  try {
    const rows = await fetchHatchery('egg_receipt', { werks, lifnr });
    const normalized = normalizeRows(rows);
    const poMap = new Map();
    for (const r of normalized) {
      if (!r.__po_no) continue;
      const key = r.__po_no;
      if (!poMap.has(key)) {
        poMap.set(key, {
          po_no: r.__po_no,
          plant_code: r.__werks || String(werks).trim(),
          lifnr: r.__lifnr || '',
          label: r.__po_no,
        });
      }
    }
    return res.json({
      success: true,
      module: 'hatchery',
      endpoint: 'egg_receipt',
      step: 'po_list',
      werks,
      lifnr,
      total: poMap.size,
      data: Array.from(poMap.values()),
    });
  } catch (err) {
    return res.status(503).json({ success: false, message: 'Failed to fetch PO list from SAP hatchery egg_receipt', error: err.message });
  }
};

// Chain step 3: PO selected -> list flocks for that PO
exports.getFlockListByPo = async (req, res) => {
  const { werks = '', lifnr = '', po_no = '' } = req.query;
  const plant = String(werks || '').trim();
  const vendor = String(lifnr || '').trim();
  const po = String(po_no || '').trim();
  if (!plant || !vendor || !po) {
    return res.status(422).json({ success: false, message: 'werks, lifnr and po_no required' });
  }
  try {
    const rows = await fetchHatchery('egg_receipt', { werks: plant, lifnr: vendor });
    const normalized = normalizeRows(rows).filter((r) => r.__po_no === po && (!vendor || r.__lifnr === vendor));
    const flockMap = new Map();
    for (const r of normalized) {
      if (!r.__flock_no) continue;
      const key = r.__flock_no;
      if (!flockMap.has(key)) {
        flockMap.set(key, {
          flock_no: r.__flock_no,
          flock_name: r.__flock_name || '',
          po_no: po,
          plant_code: plant,
          lifnr: r.__lifnr || vendor,
          matnr: r.__matnr || '',
          date: r.__date || '',
          label: r.__flock_name ? `${r.__flock_no} - ${r.__flock_name}` : r.__flock_no,
        });
      }
    }
    return res.json({
      success: true,
      module: 'hatchery',
      endpoint: 'egg_receipt',
      step: 'flock_list',
      werks: plant,
      lifnr: vendor,
      po_no: po,
      total: flockMap.size,
      data: Array.from(flockMap.values()),
    });
  } catch (err) {
    return res.status(503).json({ success: false, message: 'Failed to fetch flock list by PO from SAP hatchery egg_receipt', error: err.message });
  }
};

// Chain step 4: selected flock -> full rows for Create Egg Receipt prefill
exports.getDetailsByFlock = async (req, res) => {
  const { werks = '', lifnr = '', po_no = '', flock_no = '' } = req.query;
  const plant = String(werks || '').trim();
  const vendor = String(lifnr || '').trim();
  const po = String(po_no || '').trim();
  const flock = String(flock_no || '').trim();
  if (!plant || !vendor || !po || !flock) {
    return res.status(422).json({ success: false, message: 'werks, lifnr, po_no, flock_no required' });
  }
  try {
    const rows = await fetchHatchery('egg_receipt', { werks: plant, lifnr: vendor });
    const normalized = normalizeRows(rows).filter((r) => r.__po_no === po && r.__flock_no === flock && (!vendor || r.__lifnr === vendor));
    return res.json({
      success: true,
      module: 'hatchery',
      endpoint: 'egg_receipt',
      step: 'flock_details',
      werks: plant,
      lifnr: vendor,
      po_no: po,
      flock_no: flock,
      total: normalized.length,
      data: normalized.map(({ __werks, __lifnr, __po_no, __flock_no, __flock_name, __matnr, __date, ...rest }) => rest),
    });
  } catch (err) {
    return res.status(503).json({ success: false, message: 'Failed to fetch flock details from SAP hatchery egg_receipt', error: err.message });
  }
};

exports.getGradeSetting = async (req, res) => {
  const { werks = '', lifnr = '', date = '', matnr = '' } = req.query;
  try {
    const rows = await fetchHatchery('grade_setting', { werks, lifnr, date, matnr });
    const saved = await upsertRowsToLocal('grade_setting', rows);
    const localData = await fetchLocalRows('grade_setting', { werks, lifnr, date, matnr });
    const payloads = localData.length ? localData : rows;
    const data = payloads.map((p) => ({ ...p, screen: mapGradeSettingScreen(p) }));
    return res.json({
      success: true,
      module: 'hatchery',
      endpoint: 'grade_setting',
      filters: { werks, lifnr, date, matnr },
      source: 'local_cache_after_sap_sync',
      sap_total: rows.length,
      saved_to_local: saved,
      cache_rows_matched: localData.length,
      total: data.length,
      data,
      hint:
        'Bind the form to `data[n].screen` (Figma fields). Raw SAP keys remain on the same object. If total was 0 before, run latest API and retry after cache stores ISO sap_date; or widen werks/lifnr/date/matnr.',
    });
  } catch (err) {
    const localData = await fetchLocalRows('grade_setting', { werks, lifnr, date, matnr });
    const data = localData.map((p) => ({ ...p, screen: mapGradeSettingScreen(p) }));
    return res.status(503).json({
      success: false,
      message: 'Failed to fetch hatchery grading to setting from SAP; serving local cache',
      error: err.message,
      source: 'local_cache_fallback',
      cache_rows_matched: localData.length,
      total: data.length,
      data,
    });
  }
};

exports.getTransferPullout = async (req, res) => {
  const { werks = '', lifnr = '', date = '', matnr = '' } = req.query;
  try {
    const rows = await fetchHatchery('trans_pullout', { werks, lifnr, date, matnr });
    const saved = await upsertRowsToLocal('trans_pullout', rows);
    const localData = await fetchLocalRows('trans_pullout', { werks, lifnr, date, matnr });
    const payloads = localData.length ? localData : rows;
    const data = payloads.map((p) => ({ ...p, screen: mapTransferPulloutScreen(p) }));
    return res.json({
      success: true,
      module: 'hatchery',
      endpoint: 'trans_pullout',
      filters: { werks, lifnr, date, matnr },
      source: 'local_cache_after_sap_sync',
      sap_total: rows.length,
      saved_to_local: saved,
      cache_rows_matched: localData.length,
      total: data.length,
      data,
      hint: 'Bind pullout UI to `data[n].screen`. Reason dropdowns: GET /api/hatchery-live/reasons?module=pullout',
    });
  } catch (err) {
    const localData = await fetchLocalRows('trans_pullout', { werks, lifnr, date, matnr });
    const data = localData.map((p) => ({ ...p, screen: mapTransferPulloutScreen(p) }));
    return res.status(503).json({
      success: false,
      message: 'Failed to fetch hatchery transfer to pullout from SAP; serving local cache',
      error: err.message,
      source: 'local_cache_fallback',
      cache_rows_matched: localData.length,
      total: data.length,
      data,
    });
  }
};

exports.getMedicineIssue = async (req, res) => {
  const { werks = '' } = req.query;
  try {
    const rows = await fetchHatchery('medicine_issue', { werks });
    const saved = await upsertRowsToLocal('medicine_issue', rows);
    const localData = await fetchLocalRows('medicine_issue', { werks });
    return res.json({
      success: true,
      module: 'hatchery',
      endpoint: 'medicine_issue',
      filters: { werks },
      source: 'local_cache_after_sap_sync',
      sap_total: rows.length,
      saved_to_local: saved,
      total: localData.length,
      data: localData,
    });
  } catch (err) {
    const localData = await fetchLocalRows('medicine_issue', { werks });
    return res.status(503).json({
      success: false,
      message: 'Failed to fetch hatchery medicine issue from SAP; serving local cache',
      error: err.message,
      source: 'local_cache_fallback',
      total: localData.length,
      data: localData,
    });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// Hatchery mobile/admin — save user-entered screen data to local DB only
// (Figma fields go inside `form` JSON; extend without schema migrations.)
// ═══════════════════════════════════════════════════════════════════════════

const LOCAL_SCREEN_PARAM = {
  'egg-receipt': 'egg_receipt',
  'grade-setting': 'grade_setting',
  'transfer-pullout': 'trans_pullout',
  'medicine-issue': 'medicine_issue',
};

async function ensureHatcheryLocalEntryTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hatchery_local_entry (
      id BIGSERIAL PRIMARY KEY,
      screen VARCHAR(40) NOT NULL,
      werks VARCHAR(20),
      lifnr VARCHAR(30),
      po_no VARCHAR(40),
      flock_no VARCHAR(40),
      matnr VARCHAR(40),
      entry_date DATE,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      entered_by INT REFERENCES admin(id),
      sap_synced BOOLEAN DEFAULT FALSE,
      sap_synced_at TIMESTAMP,
      sap_synced_by INT REFERENCES admin(id),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_hle_screen_werks ON hatchery_local_entry(screen, werks)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_hle_screen_date ON hatchery_local_entry(screen, entry_date)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_hle_entered ON hatchery_local_entry(entered_by)`);
}

function resolveLocalScreen(param) {
  const key = String(param || '').trim().toLowerCase();
  return LOCAL_SCREEN_PARAM[key] || null;
}

function buildFormPayload(body) {
  if (!body || typeof body !== 'object') return {};
  const meta = new Set([
    'id', 'werks', 'plant_code', 'lifnr', 'po_no', 'ebeln', 'flock_no', 'plnbez',
    'matnr', 'entry_date', 'date', 'bldat', 'form', 'payload',
  ]);
  if (body.form != null && typeof body.form === 'object' && !Array.isArray(body.form)) {
    return { ...body.form };
  }
  if (body.payload != null && typeof body.payload === 'object' && !Array.isArray(body.payload)) {
    return { ...body.payload };
  }
  const out = {};
  for (const [k, v] of Object.entries(body)) {
    if (!meta.has(k)) out[k] = v;
  }
  return out;
}

// POST /api/hatchery-live/local/:screen/save
// Body: { werks, lifnr?, po_no?, flock_no?, matnr?, entry_date?, id?, form?: { ... } }
exports.saveHatcheryLocal = async (req, res) => {
  const screen = resolveLocalScreen(req.params.screen);
  if (!screen) {
    return res.status(422).json({
      success: false,
      message: 'invalid screen path',
      valid_screens: Object.keys(LOCAL_SCREEN_PARAM),
    });
  }
  try {
    await ensureHatcheryLocalEntryTable();
    const body = req.body || {};
    const idRaw = body.id;
    const id = idRaw !== undefined && idRaw !== null && String(idRaw).trim() !== ''
      ? parseInt(String(idRaw), 10)
      : null;

    const werks = pick(body.werks, body.plant_code, body.WERKS);
    const lifnr = pick(body.lifnr, body.LIFNR);
    const po_no = pick(body.po_no, body.ebeln, body.EBELN);
    const flock_no = pick(body.flock_no, body.plnbez, body.PLNBEZ);
    const matnr = pick(body.matnr, body.MATNR);
    let entry_date = pick(body.entry_date, body.date, body.bldat, body.BLDAT);
    if (entry_date && entry_date.includes('T')) entry_date = entry_date.split('T')[0];

    if (!werks) {
      return res.status(422).json({ success: false, message: 'werks (plant) required' });
    }

    const payload = buildFormPayload(body);
    const entered_by = req.user?.id ?? null;

    if (id !== null && Number.isFinite(id)) {
      const check = await pool.query(
        `SELECT id FROM hatchery_local_entry WHERE id = $1 AND screen = $2`,
        [id, screen]
      );
      if (check.rowCount === 0) {
        return res.status(404).json({ success: false, message: 'Record not found' });
      }
      const r = await pool.query(
        `UPDATE hatchery_local_entry SET
           werks = $1,
           lifnr = $2,
           po_no = $3,
           flock_no = $4,
           matnr = $5,
           entry_date = NULLIF($6::text, '')::date,
           payload = $7::jsonb,
           entered_by = COALESCE($8, entered_by),
           updated_at = NOW()
         WHERE id = $9 AND screen = $10
         RETURNING id, screen, werks, lifnr, po_no, flock_no, matnr, entry_date, payload, entered_by,
                   sap_synced, sap_synced_at, sap_synced_by, created_at, updated_at`,
        [
          werks || null,
          lifnr || null,
          po_no || null,
          flock_no || null,
          matnr || null,
          entry_date || null,
          JSON.stringify(payload),
          entered_by,
          id,
          screen,
        ]
      );
      return res.json({ success: true, message: 'Updated', source: 'local_db', data: r.rows[0] });
    }

    const r = await pool.query(
      `INSERT INTO hatchery_local_entry
        (screen, werks, lifnr, po_no, flock_no, matnr, entry_date, payload, entered_by)
       VALUES ($1,$2,$3,$4,$5,$6,NULLIF($7::text, '')::date,$8::jsonb,$9)
       RETURNING id, screen, werks, lifnr, po_no, flock_no, matnr, entry_date, payload, entered_by,
                 sap_synced, created_at, updated_at`,
      [screen, werks || null, lifnr || null, po_no || null, flock_no || null, matnr || null, entry_date || null, JSON.stringify(payload), entered_by]
    );
    return res.status(201).json({ success: true, message: 'Saved', source: 'local_db', data: r.rows[0] });
  } catch (err) {
    console.error('[saveHatcheryLocal]', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/hatchery-live/local/:screen?id=&werks=&lifnr=&po_no=&flock_no=&from_date=&to_date=&limit=
exports.listHatcheryLocal = async (req, res) => {
  const screen = resolveLocalScreen(req.params.screen);
  if (!screen) {
    return res.status(422).json({
      success: false,
      message: 'invalid screen path',
      valid_screens: Object.keys(LOCAL_SCREEN_PARAM),
    });
  }
  try {
    await ensureHatcheryLocalEntryTable();
    const {
      werks,
      lifnr,
      po_no,
      flock_no,
      from_date,
      to_date,
      limit = '200',
    } = req.query;

    const lim = Math.min(Math.max(parseInt(String(limit), 10) || 200, 1), 500);
    const conds = ['screen = $1'];
    const vals = [screen];
    let idx = 2;

    if (werks) {
      conds.push(`werks = $${idx++}`);
      vals.push(String(werks).trim());
    }
    if (lifnr) {
      conds.push(`lifnr = $${idx++}`);
      vals.push(String(lifnr).trim());
    }
    if (po_no) {
      conds.push(`po_no = $${idx++}`);
      vals.push(String(po_no).trim());
    }
    if (flock_no) {
      conds.push(`flock_no = $${idx++}`);
      vals.push(String(flock_no).trim());
    }
    if (from_date) {
      conds.push(`entry_date >= $${idx++}::date`);
      vals.push(String(from_date).trim());
    }
    if (to_date) {
      conds.push(`entry_date <= $${idx++}::date`);
      vals.push(String(to_date).trim());
    }

    const limPh = vals.length + 1;
    vals.push(lim);
    const q = await pool.query(
      `SELECT id, screen, werks, lifnr, po_no, flock_no, matnr, entry_date, payload, entered_by,
              sap_synced, sap_synced_at, created_at, updated_at
         FROM hatchery_local_entry
        WHERE ${conds.join(' AND ')}
        ORDER BY updated_at DESC, id DESC
        LIMIT $${limPh}`,
      vals
    );
    return res.json({
      success: true,
      module: 'hatchery',
      screen,
      source: 'local_db',
      total: q.rowCount,
      data: q.rows,
    });
  } catch (err) {
    console.error('[listHatcheryLocal]', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/hatchery-live/local/:screen/:id
exports.getHatcheryLocalById = async (req, res) => {
  const screen = resolveLocalScreen(req.params.screen);
  if (!screen) {
    return res.status(422).json({
      success: false,
      message: 'invalid screen path',
      valid_screens: Object.keys(LOCAL_SCREEN_PARAM),
    });
  }
  const id = parseInt(String(req.params.id || ''), 10);
  if (!Number.isFinite(id)) {
    return res.status(422).json({ success: false, message: 'valid id required' });
  }
  try {
    await ensureHatcheryLocalEntryTable();
    const q = await pool.query(
      `SELECT id, screen, werks, lifnr, po_no, flock_no, matnr, entry_date, payload, entered_by,
              sap_synced, sap_synced_at, sap_synced_by, created_at, updated_at
         FROM hatchery_local_entry
        WHERE id = $1 AND screen = $2`,
      [id, screen]
    );
    if (q.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Not found' });
    }
    return res.json({ success: true, module: 'hatchery', screen, source: 'local_db', data: q.rows[0] });
  } catch (err) {
    console.error('[getHatcheryLocalById]', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// Hatchery reason master — dropdowns for Grading / Setting / Pullout screens
// GET /api/hatchery-live/reasons?module=setting|grading|pullout|all
// ═══════════════════════════════════════════════════════════════════════════

async function ensureHatcheryReasonTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hatchery_reason_master (
      id SERIAL PRIMARY KEY,
      reason_id VARCHAR(40) NOT NULL,
      reason_name VARCHAR(200) NOT NULL,
      module VARCHAR(40) NOT NULL,
      is_active BOOLEAN DEFAULT TRUE,
      sort_order INT DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE (reason_id, module)
    )
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_hatchery_reason_mod ON hatchery_reason_master(module)`
  );
}

/** Resolve ?module=… for hatchery reasons. Uses last non-empty value (Postman often sends duplicate/empty keys). */
function readReasonModuleFilter(query) {
  const vals = [];
  if (!query || typeof query !== 'object') return '';
  for (const [key, val] of Object.entries(query)) {
    if (String(key).toLowerCase() !== 'module') continue;
    if (Array.isArray(val)) {
      for (const x of val) vals.push(x);
    } else {
      vals.push(val);
    }
  }
  for (let i = vals.length - 1; i >= 0; i--) {
    const s = String(vals[i] == null ? '' : vals[i]).trim().toLowerCase();
    if (s) return s;
  }
  return '';
}

exports.getHatcheryReasons = async (req, res) => {
  const raw = readReasonModuleFilter(req.query);
  const module = raw === '' || raw === 'all' ? 'all' : raw;
  try {
    await ensureHatcheryReasonTable();
    let q;
    if (module === 'all') {
      q = await pool.query(`
        SELECT id, reason_id, reason_name, module, sort_order
          FROM hatchery_reason_master
         WHERE is_active = TRUE
         ORDER BY module, sort_order, reason_id
      `);
    } else {
      q = await pool.query(
        `
        SELECT id, reason_id, reason_name, module, sort_order
          FROM hatchery_reason_master
         WHERE is_active = TRUE AND LOWER(TRIM(module)) = $1
         ORDER BY sort_order, reason_id
      `,
        [module]
      );
    }
    return res.json({
      success: true,
      module: 'hatchery',
      endpoint: 'reasons',
      filter: module,
      total: q.rows.length,
      data: q.rows,
      hint:
        'Use module=grading | setting | pullout for one list, or module=all. New reasons: POST /api/hatchery-live/reasons (JWT). Saved rows appear on this GET.',
    });
  } catch (err) {
    console.error('[getHatcheryReasons]', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

const REASON_MODULE_WHITELIST = new Set(['grading', 'setting', 'pullout']);

// POST /api/hatchery-live/reasons — JWT; body: { reason_id, reason_name, module, sort_order? }
// Upserts on (reason_id, module); GET reasons will return the same row when module matches.
exports.postHatcheryReason = async (req, res) => {
  const body = req.body || {};
  const reason_id = String(body.reason_id || '').trim();
  const reason_name = String(body.reason_name || '').trim();
  const mod = String(body.module || '').trim().toLowerCase();
  if (!reason_id || !reason_name || !mod) {
    return res.status(422).json({
      success: false,
      message: 'reason_id, reason_name, and module are required',
    });
  }
  if (!REASON_MODULE_WHITELIST.has(mod)) {
    return res.status(422).json({
      success: false,
      message: 'module must be one of: grading, setting, pullout',
      allowed: Array.from(REASON_MODULE_WHITELIST),
    });
  }
  const sortRaw = body.sort_order;
  const sort_order =
    sortRaw !== undefined && sortRaw !== null && String(sortRaw).trim() !== ''
      ? parseInt(String(sortRaw), 10)
      : 0;
  const sort = Number.isFinite(sort_order) ? sort_order : 0;
  try {
    await ensureHatcheryReasonTable();
    const q = await pool.query(
      `
      INSERT INTO hatchery_reason_master (reason_id, reason_name, module, sort_order, is_active, updated_at)
      VALUES ($1, $2, $3, $4, TRUE, NOW())
      ON CONFLICT (reason_id, module)
      DO UPDATE SET
        reason_name = EXCLUDED.reason_name,
        sort_order = EXCLUDED.sort_order,
        is_active = TRUE,
        updated_at = NOW()
      RETURNING id, reason_id, reason_name, module, sort_order
    `,
      [reason_id, reason_name, mod, sort]
    );
    return res.status(201).json({
      success: true,
      module: 'hatchery',
      endpoint: 'reasons',
      data: q.rows[0],
      note: `Row is returned by GET /api/hatchery-live/reasons?module=${mod} (and module=all).`,
    });
  } catch (err) {
    console.error('[postHatcheryReason]', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};
