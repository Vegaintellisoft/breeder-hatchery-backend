/**
 * Outbound push to SAP Breeder ICF services.
 * Query string is built with qs.stringify (same approach as broiler-backend bill_of_supply / SAP POST).
 * POST with empty body; all parameters on the URL.
 */
const axios = require('axios');
const qs = require('qs');

const SAP_BASE = process.env.SAP_BASE_URL || 'http://krishidevqas.krishinutrition.com:8001/sap/bc/breeder';
const SAP_AUTH = {
  username: process.env.SAP_USER || 'vega',
  password: process.env.SAP_PASSWORD || 'Vega@1234',
};
const SAP_CLIENT = process.env.SAP_CLIENT || '500';
const SAP_MASTERS_URL = process.env.SAP_MASTERS_URL || String(SAP_BASE).replace(/\/breeder\/?$/i, '');

/** Calendar YYYY-MM-DD from DB value (avoids UTC off-by-one on JS Date). */
function parseYmdFromDb(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) {
    const y = value.getFullYear();
    const mo = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${mo}-${d}`;
  }
  const str = String(value).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(str);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** SAP examples use DD/MM/YYYY; empty dates cause ABAP substring dumps on QAS. */
function toDmyFromDbDate(value) {
  const ymd = parseYmdFromDb(value);
  if (!ymd) return '';
  const [y, mo, d] = ymd.split('-');
  return `${d}/${mo}/${y}`;
}

/** Drop keys whose string value is empty — reduces SAP parsing empty strings. */
function omitEmptyDeepStrings(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(omitEmptyDeepStrings);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === '') continue;
    if (v !== null && typeof v === 'object') out[k] = omitEmptyDeepStrings(v);
    else out[k] = v;
  }
  return out;
}

function numStr(v) {
  if (v === null || v === undefined || v === '') return '0';
  const n = Number(v);
  if (Number.isNaN(n)) return String(v);
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function numStrOrEmpty(v) {
  if (v === null || v === undefined || v === '') return '';
  const n = Number(v);
  if (Number.isNaN(n)) return String(v);
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function preferLocalWhenSapZero(sapValue, localValue) {
  const sapMissing = sapValue === null || sapValue === undefined || String(sapValue).trim() === '';
  if (sapMissing) return localValue;
  const sapNum = Number(sapValue);
  const localNum = Number(localValue);
  if (!Number.isNaN(sapNum) && sapNum === 0 && !Number.isNaN(localNum) && localNum > 0) {
    return localValue;
  }
  return sapValue;
}

function firstPresent(...vals) {
  for (const v of vals) {
    if (v !== null && v !== undefined && v !== '') return v;
  }
  return null;
}

/** SAP cull-sale field zzage must be numeric; screens often store "40 weeks", "wk 35", etc. */
function sapNumericAgeStr(age) {
  if (age === null || age === undefined || age === '') return '';
  const m = String(age).trim().match(/^(\d+)/);
  return m ? m[1] : '';
}

function summarizeSapBody(data, httpStatus) {
  if (data == null || data === '') return `SAP HTTP ${httpStatus}`;
  if (typeof data === 'string') {
    const t = data.trim();
    if (t.length > 2000) return `${t.slice(0, 2000)}…`;
    return t || `SAP HTTP ${httpStatus}`;
  }
  try {
    return JSON.stringify(data);
  } catch {
    return `SAP HTTP ${httpStatus}`;
  }
}

function buildSapPostUrl(endpoint, queryParams = {}) {
  const ep = String(endpoint || '').replace(/^\/+/, '');
  const flat = omitEmptyDeepStrings({ 'sap-client': SAP_CLIENT, ...queryParams });
  const qsString = qs.stringify(flat, { encode: true });
  const base = String(SAP_BASE || '').replace(/\/+$/, '');
  return `${base}/${ep}?${qsString}`;
}

/**
 * POST to SAP with all fields in the URL query (broiler-backend pattern).
 */
async function postSap(endpoint, queryParams) {
  const finalUrl = buildSapPostUrl(endpoint, queryParams);
  const res = await axios.request({
    method: 'post',
    maxBodyLength: Infinity,
    url: finalUrl,
    auth: SAP_AUTH,
    timeout: 90000,
    maxRedirects: 5,
    validateStatus: () => true,
  });
  return res;
}

// ── Feed & Med (flock_feeding_log row) ────────────────────────────────────
function buildDmfdetRow(rec) {
  const meinsRaw = String(rec.uom || '').trim();
  const meinsMap = { bags: 'BAG', lit: 'LTR', litre: 'LTR', liters: 'LTR', literss: 'LTR', kg: 'KG', nos: 'NOS' };
  const meins = meinsMap[meinsRaw.toLowerCase()] || meinsRaw;
  const bldat = toDmyFromDbDate(rec.feed_date);
  return {
    werks: String(rec.plant_code || '').trim(),
    aufnr: String(rec.order_no || '').trim(),
    plnbez: String(rec.flock_no || '').trim(),
    bldat,
    // Some SAP handlers parse posting date (budat) separately.
    budat: bldat,
    matnr: String(rec.item_id || '').trim(),
    maktx: String(rec.item_name || '').trim(),
    meins,
    erfmgM: numStr(rec.qty_issued_male),
    erfmgF: numStr(rec.qty_issued_female),
  };
}

function buildFeedMedGeneralRow(rec) {
  const bldat = toDmyFromDbDate(rec.feed_date);
  const hatchdtRaw = String(rec.hatchdt || rec.sap_hatchdt || '').trim();
  const hatchdt = toDmyFromDbDate(hatchdtRaw) || hatchdtRaw || bldat;
  const batch = String(rec.batch_no || rec.batch || rec.sap_batch || '').trim();
  const sapStock = rec.sap_stock ?? rec.stock_total ?? rec.zzstock ?? rec.stock_in_bags;
  let sapAge = rec.sap_age ?? rec.age_days ?? rec.zzage;
  const sapFbw = rec.sap_female_bird_weight ?? rec.zzfbwt;
  const sapMbw = rec.sap_male_bird_weight ?? rec.zzmbwt;
  const sapFstk = rec.sap_female_stock ?? rec.female_stock ?? rec.zzfstk;
  const sapMstk = rec.sap_male_stock ?? rec.male_stock ?? rec.zzmstk;
  // Compute age from hatch date when upstream source does not provide it.
  if ((sapAge === null || sapAge === undefined || sapAge === '') && hatchdtRaw && rec.feed_date) {
    const hatchYmd = parseYmdFromDb(hatchdtRaw);
    const feedYmd = parseYmdFromDb(rec.feed_date);
    if (hatchYmd && feedYmd) {
      const hd = new Date(`${hatchYmd}T00:00:00Z`);
      const fd = new Date(`${feedYmd}T00:00:00Z`);
      const days = Math.floor((fd - hd) / 86400000);
      if (!Number.isNaN(days) && days >= 0) sapAge = days;
    }
  }
  return {
    werks: String(rec.plant_code || '').trim(),
    aufnr: String(rec.order_no || '').trim(),
    plnbez: String(rec.flock_no || '').trim(),
    batch,
    // Keep non-empty date format for SAP substring parsers.
    hatchdt,
    bldat,
    // zfeed_med FM may parse posting date separately from document date.
    budat: bldat,
    stock: numStr(sapStock || 0),
    zzage: numStrOrEmpty(sapAge),
    zzfbwt: numStrOrEmpty(sapFbw),
    zzmbwt: numStrOrEmpty(sapMbw),
    zzfstk: numStrOrEmpty(sapFstk),
    zzmstk: numStrOrEmpty(sapMstk),
  };
}

function buildFeedOrMedLine(rec) {
  const meinsRaw = String(rec.uom || '').trim();
  const meinsMap = { bags: 'BAG', lit: 'LTR', litre: 'LTR', liters: 'LTR', literss: 'LTR', kg: 'KG', nos: 'NOS' };
  const meins = meinsMap[meinsRaw.toLowerCase()] || meinsRaw;
  const maleIssued = parseFloat(rec.qty_issued_male) || 0;
  const femaleIssued = parseFloat(rec.qty_issued_female) || 0;
  const total = maleIssued + femaleIssued;
  return {
    matnr: String(rec.item_id || '').trim(),
    maktx: String(rec.item_name || '').trim(),
    uom: meins,
    lgort: String(rec.storage_location || '').trim(),
    stock: numStr(rec.stock_in_bags || rec.sap_stock || 0),
    erfmgm: numStr(maleIssued),
    erfmgf: numStr(femaleIssued),
    erfmg: numStr(total),
  };
}

function validateFeedingForSap(rec) {
  const msgs = [];
  if (!String(rec.plant_code || '').trim()) msgs.push('plant_code missing');
  if (!String(rec.order_no || '').trim()) msgs.push('order_no (aufnr) missing');
  if (!String(rec.flock_no || '').trim()) msgs.push('flock_no (plnbez) missing');
  const matnr = String(rec.item_id || '').trim();
  if (!matnr) msgs.push('item_id (matnr) missing');
  // Prevent common ABAP substring dumps on short local codes (e.g., FD001 / WT001).
  if (matnr && matnr.length < 8) msgs.push(`material code too short for SAP (matnr="${matnr}"). Use SAP material id from master sync`);
  const bldat = toDmyFromDbDate(rec.feed_date);
  if (!bldat) msgs.push(`feed_date invalid or empty (got: ${JSON.stringify(rec.feed_date)}) — SAP needs DD/MM/YYYY`);
  return msgs.length ? msgs.join('; ') : null;
}

function feedMasterTableForType(feedType) {
  const t = String(feedType || '').toLowerCase().trim();
  if (t === 'feed') return 'feed_master';
  if (t === 'water') return 'water_master';
  if (t === 'medicine') return 'medicine_master';
  if (t === 'others') return 'others_master';
  return null;
}

async function resolveSapMaterialCode(pool, row) {
  const tbl = feedMasterTableForType(row.feed_type);
  if (!tbl) return '';
  // Older schemas use different code columns by table.
  const codeColByType = {
    feed: 'mat_id',
    water: 'water_id',
    medicine: 'medicine_id',
    others: 'others_id',
  };
  const wantedCol = codeColByType[String(row.feed_type || '').toLowerCase()] || 'mat_id';
  const hasCol = await pool.query(
    `SELECT 1
       FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1 AND column_name=$2`,
    [tbl, wantedCol]
  );
  if (hasCol.rowCount === 0) return '';

  const q = await pool.query(
    `SELECT ${wantedCol} AS sap_code FROM ${tbl} WHERE id=$1 LIMIT 1`,
    [row.item_id]
  );
  let code = String(q.rows[0]?.sap_code || '').trim();
  // If local code is clearly non-SAP format, try live SAP material lookup.
  if (!code || code.length < 8) {
    const fromSap = await lookupSapMaterialCodeByName(row.plant_code, row.item_name);
    if (fromSap) code = fromSap;
  }
  return code;
}

async function lookupSapMaterialCodeByName(plantCode, itemName) {
  const werks = String(plantCode || '').trim();
  const name = String(itemName || '').trim().toLowerCase();
  if (!werks || !name) return '';
  try {
    const res = await axios.get(`${SAP_MASTERS_URL}/masters/material`, {
      auth: SAP_AUTH,
      params: { 'sap-client': SAP_CLIENT, werks },
      timeout: 20000,
    });
    const rows = Array.isArray(res.data) ? res.data : (res.data?.results || []);
    if (!rows.length) return '';

    // Exact name match first, then contains fallback.
    const exact = rows.find((r) => String(r?.maktx || '').trim().toLowerCase() === name);
    const loose = rows.find((r) => String(r?.maktx || '').trim().toLowerCase().includes(name));
    const pick = exact || loose;
    const matnr = String(pick?.matnr || '').trim();
    return matnr;
  } catch {
    return '';
  }
}

async function lookupSapOrderNoByFlock(plantCode, flockNo) {
  const werks = String(plantCode || '').trim();
  const flock = String(flockNo || '').trim();
  if (!werks || !flock) return '';
  try {
    const res = await axios.get(`${SAP_BASE}/zfeed_med`, {
      auth: SAP_AUTH,
      params: { 'sap-client': SAP_CLIENT, werks },
      timeout: 20000,
    });
    const rows = Array.isArray(res.data) ? res.data : (res.data?.results || []);
    const row = rows.find((r) => String(r?.plnbez || r?.generalInfo?.plnbez || '').trim() === flock);
    const aufnr = String(row?.aufnr || row?.generalInfo?.aufnr || '').trim();
    return aufnr;
  } catch {
    return '';
  }
}

async function lookupSapFeedingContext(plantCode, flockNo, aufnr) {
  const werks = String(plantCode || '').trim();
  const flock = String(flockNo || '').trim();
  const order = String(aufnr || '').trim();
  if (!werks || !flock) return null;
  try {
    const res = await axios.get(`${SAP_BASE}/zfeed_med`, {
      auth: SAP_AUTH,
      params: { 'sap-client': SAP_CLIENT, werks },
      timeout: 20000,
    });
    const rows = Array.isArray(res.data) ? res.data : (res.data?.results || []);
    const row = rows.find((r) => {
      const rFlock = String(r?.plnbez || r?.generalInfo?.plnbez || '').trim();
      const rAufnr = String(r?.aufnr || r?.generalInfo?.aufnr || '').trim();
      if (!order) return rFlock === flock;
      return rFlock === flock && rAufnr === order;
    });
    // Some plants return flock context with a different/blank order in GET.
    // Fallback to flock-only match so age/stock fields are still available.
    const matched = row || rows.find((r) => String(r?.plnbez || r?.generalInfo?.plnbez || '').trim() === flock);
    if (!matched) return null;
    const pick = (...vals) => {
      for (const v of vals) {
        if (v !== undefined && v !== null && String(v).trim() !== '') return v;
      }
      return null;
    };
    const pickPreferNonZeroNumeric = (...vals) => {
      let fallback = null;
      for (const v of vals) {
        if (v === undefined || v === null || String(v).trim() === '') continue;
        if (fallback === null) fallback = v;
        const n = Number(v);
        if (!Number.isNaN(n) && n > 0) return v;
      }
      return fallback;
    };
    return {
      order_no: String(matched?.aufnr || matched?.generalInfo?.aufnr || '').trim() || order,
      sap_batch: String(matched?.batch || matched?.generalInfo?.batch || '').trim(),
      sap_hatchdt: String(matched?.hatchdt || matched?.generalInfo?.hatchdt || '').trim(),
      sap_stock: pick(matched?.zzstock, matched?.stock, matched?.stock_total, matched?.total_count, matched?.count, matched?.generalInfo?.zzstock, matched?.generalInfo?.stock),
      sap_age: pickPreferNonZeroNumeric(
        matched?.age_days,
        matched?.generalInfo?.age_days,
        matched?.zzAge,
        matched?.zzage,
        matched?.generalInfo?.zzAge,
        matched?.generalInfo?.zzage
      ),
      sap_female_stock: pickPreferNonZeroNumeric(
        matched?.female_stock,
        matched?.female_count,
        matched?.generalInfo?.female_stock,
        matched?.generalInfo?.female_count,
        matched?.zzFstk,
        matched?.zzfstk,
        matched?.generalInfo?.zzFstk,
        matched?.generalInfo?.zzfstk
      ),
      sap_male_stock: pickPreferNonZeroNumeric(
        matched?.male_stock,
        matched?.male_count,
        matched?.generalInfo?.male_stock,
        matched?.generalInfo?.male_count,
        matched?.zzMstk,
        matched?.zzmstk,
        matched?.generalInfo?.zzMstk,
        matched?.generalInfo?.zzmstk
      ),
      sap_female_bird_weight: pick(matched?.zzFbwt, matched?.zzfbwt, matched?.female_bird_weight, matched?.generalInfo?.zzFbwt, matched?.generalInfo?.zzfbwt),
      sap_male_bird_weight: pick(matched?.zzMbwt, matched?.zzmbwt, matched?.male_bird_weight, matched?.generalInfo?.zzMbwt, matched?.generalInfo?.zzmbwt),
    };
  } catch {
    return null;
  }
}

function deepContainsValue(obj, wanted) {
  const target = String(wanted || '').trim().toUpperCase();
  if (!target) return false;
  const stack = [obj];
  while (stack.length) {
    const cur = stack.pop();
    if (cur == null) continue;
    if (typeof cur === 'string' || typeof cur === 'number') {
      if (String(cur).trim().toUpperCase() === target) return true;
      continue;
    }
    if (Array.isArray(cur)) {
      for (const v of cur) stack.push(v);
      continue;
    }
    if (typeof cur === 'object') {
      for (const v of Object.values(cur)) stack.push(v);
    }
  }
  return false;
}

async function checkSapOrderMaterialContext(plantCode, flockNo, aufnr, matnr) {
  const werks = String(plantCode || '').trim();
  const flock = String(flockNo || '').trim();
  const order = String(aufnr || '').trim();
  const code = String(matnr || '').trim();
  if (!werks || !flock || !order || !code) return { ok: true };
  try {
    const res = await axios.get(`${SAP_BASE}/zfeed_med`, {
      auth: SAP_AUTH,
      params: { 'sap-client': SAP_CLIENT, werks },
      timeout: 20000,
    });
    const rows = Array.isArray(res.data) ? res.data : (res.data?.results || []);
    const row = rows.find((r) => {
      const rFlock = String(r?.plnbez || r?.generalInfo?.plnbez || '').trim();
      const rAufnr = String(r?.aufnr || r?.generalInfo?.aufnr || '').trim();
      return rFlock === flock && rAufnr === order;
    });
    if (!row) return { ok: true };
    if (deepContainsValue(row, code)) return { ok: true };
    return {
      ok: false,
      message: `SAP order exists but material is not mapped in SAP for this flock/order (aufnr=${order}, matnr=${code}).`,
    };
  } catch {
    return { ok: true };
  }
}

async function getMorKillReasonTotals(pool, reasonTable, fkColumn, recordId) {
  const q = await pool.query(
    `SELECT
       COALESCE(SUM(male_count), 0) AS male_count,
       COALESCE(SUM(female_count), 0) AS female_count,
       COALESCE(SUM(total_count), 0) AS total_count
     FROM ${reasonTable}
     WHERE ${fkColumn}=$1`,
    [recordId]
  );
  return q.rows[0] || { male_count: 0, female_count: 0, total_count: 0 };
}

function validateMorKillForSap(rec) {
  const msgs = [];
  if (!String(rec.plant_code || '').trim()) msgs.push('plant_code missing');
  if (!String(rec.order_no || '').trim()) msgs.push('order_no (aufnr) missing');
  if (!String(rec.flock_no || '').trim()) msgs.push('flock_no (matnr) missing');
  const bldat = toDmyFromDbDate(rec.entry_date);
  if (!bldat) msgs.push(`entry_date invalid or empty — SAP needs DD/MM/YYYY`);
  return msgs.length ? msgs.join('; ') : null;
}

function validateEggHeaderForSap(header, breegrnRows) {
  const msgs = [];
  if (!String(header.plant_code || '').trim()) msgs.push('plant_code missing');
  if (!String(header.flock_no || '').trim()) msgs.push('flock_no missing');
  const bldat = toDmyFromDbDate(header.collection_date);
  if (!bldat) msgs.push('collection_date invalid or empty');
  if (!breegrnRows.length) msgs.push('no egg lines to send');
  for (let i = 0; i < breegrnRows.length; i++) {
    const line = breegrnRows[i];
    if (!String(line.matnre || '').trim()) msgs.push(`egg line ${i + 1}: egg_type_id (matnre) missing — check egg_type_lookup`);
    if (!line.bldat) msgs.push(`egg line ${i + 1}: bldat empty`);
  }
  return msgs.length ? msgs.join('; ') : null;
}

function validateCullSaleForSap(rec) {
  const msgs = [];
  const bldat = toDmyFromDbDate(rec.entry_date);
  if (!bldat) msgs.push('entry_date invalid or empty');
  if (!String(rec.plant_code || '').trim()) msgs.push('plant_code missing');
  return msgs.length ? msgs.join('; ') : null;
}

function validateBirdWeightForSap(rec) {
  const msgs = [];
  if (!String(rec.plant_code || '').trim()) msgs.push('plant_code missing');
  if (!String(rec.flock_no || '').trim()) msgs.push('flock_no missing');
  const bldat = toDmyFromDbDate(rec.weight_date);
  if (!bldat) msgs.push('weight_date invalid or empty');
  return msgs.length ? msgs.join('; ') : null;
}

// ── Laying / egg collection header (+ aggregates) ────────────────────────
function buildBreegrnRows(header, flockRow, slotTotals, eggTypes) {
  const werks = String(header.plant_code || '').trim();
  const aufnr = String(header.order_no || '').trim();
  const matnr = String(header.flock_no || '').trim();
  const maktx = String(flockRow?.flock_name || '').trim();
  const batch = String(flockRow?.batch || '').trim();
  const hatchdt = toDmyFromDbDate(flockRow?.hatchery_date);
  const bldat = toDmyFromDbDate(header.collection_date);
  const zzflock = batch || '';
  let zzage = header.age_days != null ? numStr(header.age_days) : '';
  const zzstock = flockRow?.stock_total != null ? numStr(flockRow.stock_total) : '';
  const zzfstk = flockRow?.female_stock != null ? numStr(flockRow.female_stock) : '';
  const zzmstk = flockRow?.male_stock != null ? numStr(flockRow.male_stock) : '';
  const hatchYmd = parseYmdFromDb(flockRow?.hatchery_date);
  const bldatYmd = parseYmdFromDb(header.collection_date);
  if (hatchYmd && bldatYmd) {
    const hd = new Date(`${hatchYmd}T00:00:00Z`);
    const bd = new Date(`${bldatYmd}T00:00:00Z`);
    const ageDays = Math.floor((bd - hd) / 86400000);
    if (!Number.isNaN(ageDays) && ageDays >= 0) zzage = numStr(ageDays);
  }

  const fieldToEggType = new Map(
    (eggTypes || []).map((e) => [e.sap_field_key, e])
  );

  const rows = [];
  const keys = ['hatching_egg', 'table_egg', 'jumbo_egg', 'crack_egg', 'waste_reject_egg'];
  for (const key of keys) {
    const qty = parseFloat(slotTotals[key]) || 0;
    if (qty <= 0) continue;
    const et = fieldToEggType.get(key);
    const matnre = et?.egg_type_id || '';
    const maktxe = et?.egg_type_name || '';
    rows.push({
      werks,
      aufnr,
      matnr,
      maktx,
      batch,
      hatchdt,
      bldat,
      zzflock,
      zzage,
      zzstock,
      zzfstk,
      zzmstk,
      matnre,
      maktxe,
      meins: 'NOS',
      grqty: numStr(qty),
      estrate: numStr(qty),
    });
  }
  return rows;
}

// ── Mortality / Cull kill ─────────────────────────────────────────────────
function buildMorKillRow(rec) {
  // SAP mortality/cull-kill expects dispatched dead counts, not line capacity stock.
  // Prefer explicit *_count columns; otherwise derive from slot male/female entries.
  const maleDead = rec.total_male_count ?? (
    (parseFloat(rec.morning_male) || 0) +
    (parseFloat(rec.afternoon_male) || 0) +
    (parseFloat(rec.evening_male) || 0)
  );
  const femaleDead = rec.total_female_count ?? (
    (parseFloat(rec.morning_female) || 0) +
    (parseFloat(rec.afternoon_female) || 0) +
    (parseFloat(rec.evening_female) || 0)
  );
  const totalDead = rec.total_qty ?? (maleDead + femaleDead);
  return {
    werks: String(rec.plant_code || '').trim(),
    aufnr: String(rec.order_no || '').trim(),
    matnr: String(rec.flock_no || '').trim(),
    maktx: String(rec.flock_name || '').trim(),
    hatchdt: toDmyFromDbDate(rec.hatchery_date),
    bldat: toDmyFromDbDate(rec.entry_date),
    batch: String(rec.batch || '').trim(),
    zzage: rec.age_days != null ? numStr(rec.age_days) : '',
    zzstock: rec.stock_total != null ? numStr(rec.stock_total) : '',
    zzfstk: rec.female_stock != null ? numStr(rec.female_stock) : '',
    zzmstk: rec.male_stock != null ? numStr(rec.male_stock) : '',
    fkimgF: numStr(femaleDead),
    fkimgM: numStr(maleDead),
    fkimg: numStr(totalDead),
  };
}

// ── Cull sale — flat query params ─────────────────────────────────────────
function buildCullSaleFlat(rec) {
  return {
    bldat: toDmyFromDbDate(rec.entry_date) || '',
    budat: '',
    zzcustype: String(rec.customer_type || ''),
    kunnr: '',
    bstnk: String(rec.dc_no || ''),
    bstdk: '',
    zzsaltype: String(rec.sales_type || ''),
    zztransby: String(rec.transport_by || ''),
    venum: String(rec.vehicle_no || ''),
    zzorderby: String(rec.order_by || ''),
    zzdispby: String(rec.dispatched_by || ''),
    werks: String(rec.plant_code || ''),
    aufnr: String(rec.order_no || ''),
    hatchdt: '',
    plnbez: String(rec.flock_no || ''),
    plnbezn: '',
    uom: '',
    batch: String(rec.batch_no || ''),
    zzage: sapNumericAgeStr(rec.age),
    zzstock: String(rec.bird_stock || ''),
    zzfstk: String(rec.net_weight_female || ''),
    zzmstk: String(rec.net_weight_male || ''),
    matnr: String(rec.flock_no || ''),
    maktx: '',
    meins: '',
    fkimgf: String(rec.net_weight_female || ''),
    fkimgm: String(rec.net_weight_male || ''),
    fkimg: String((parseFloat(rec.net_weight_male) || 0) + (parseFloat(rec.net_weight_female) || 0)),
    zzempwght: '',
    zzloadwght: '',
    weight: '',
    zzangwt: '',
    netpr: String(rec.rate || ''),
    netwr: String(rec.bill_value || ''),
  };
}

// ── Bird receipt / flock_bird_weight row ─────────────────────────────────
function buildBreAfruRow(rec) {
  return {
    werks: String(rec.plant_code || '').trim(),
    aufnr: String(rec.order_no || '').trim(),
    matnr: String(rec.flock_no || '').trim(),
    bldat: toDmyFromDbDate(rec.weight_date),
    zzfbwt: numStr(rec.male_weight),
    zzmbwt: numStr(rec.female_weight),
    menge: numStr((parseFloat(rec.male_weight) || 0) + (parseFloat(rec.female_weight) || 0)),
  };
}

/**
 * Load DB row(s) and post to SAP.
 * @returns {Promise<{ ok:boolean, status?:number, module:string, record_id:number|string, sap_response?:any, message?:string, error?:string }>}
 */
function interpretSapResponse(res) {
  const status = res.status;
  const sap_response = res.data;
  if (status >= 200 && status < 300) {
    return { ok: true, status, sap_response, message: null };
  }
  return {
    ok: false,
    status,
    sap_response,
    message: summarizeSapBody(sap_response, status),
  };
}

async function pushToSap(pool, module, recordId) {
  const id = parseInt(recordId, 10);
  if (!module || !recordId || Number.isNaN(id)) {
    return { ok: false, module, record_id: recordId, message: 'module and numeric record_id required' };
  }

  try {
    if (module === 'feeding') {
      const r = await pool.query(`SELECT * FROM flock_feeding_log WHERE id=$1`, [id]);
      if (r.rowCount === 0) return { ok: false, module, record_id: id, message: 'Record not found' };
      const row = r.rows[0];
      const sapMatnr = await resolveSapMaterialCode(pool, row);
      const sapAufnr = await lookupSapOrderNoByFlock(row.plant_code, row.flock_no);
      const sapCtx = await lookupSapFeedingContext(row.plant_code, row.flock_no, sapAufnr || row.order_no);
      const rowForSap = {
        ...row,
        ...(sapCtx || {}),
        order_no: (sapCtx && sapCtx.order_no) || sapAufnr || row.order_no,
        // SAP expects material code, not local numeric PK.
        item_id: sapMatnr || row.item_id,
      };
      // If SAP context responds with zeroes, keep locally captured non-zero values from save payload.
      rowForSap.sap_age = preferLocalWhenSapZero(rowForSap.sap_age, row.sap_age);
      rowForSap.sap_female_stock = preferLocalWhenSapZero(rowForSap.sap_female_stock, row.sap_female_stock);
      rowForSap.sap_male_stock = preferLocalWhenSapZero(rowForSap.sap_male_stock, row.sap_male_stock);
      rowForSap.sap_female_bird_weight = preferLocalWhenSapZero(rowForSap.sap_female_bird_weight, row.sap_female_bird_weight);
      rowForSap.sap_male_bird_weight = preferLocalWhenSapZero(rowForSap.sap_male_bird_weight, row.sap_male_bird_weight);
      // Fallback: if bird weights are available locally, pass them into zzfbwt/zzmbwt.
      if (!rowForSap.sap_female_bird_weight || !rowForSap.sap_male_bird_weight) {
        const bw = await pool.query(
          `SELECT male_weight, female_weight
             FROM flock_bird_weight
            WHERE flock_no=$1 AND plant_code=$2 AND weight_date <= $3
            ORDER BY weight_date DESC
            LIMIT 1`,
          [rowForSap.flock_no, rowForSap.plant_code, rowForSap.feed_date]
        );
        const w = bw.rows[0] || {};
        rowForSap.sap_male_bird_weight = rowForSap.sap_male_bird_weight || w.male_weight || null;
        rowForSap.sap_female_bird_weight = rowForSap.sap_female_bird_weight || w.female_weight || null;
      }
      // Fallback: source live flock age/stock from local daily activity when SAP context is sparse.
      if (!rowForSap.sap_age || !rowForSap.sap_female_stock || !rowForSap.sap_male_stock) {
        const da = await pool.query(
          `SELECT age_days, female_count, male_count
             FROM flock_daily_activity
            WHERE flock_no=$1 AND plant_code=$2 AND activity_date <= $3
            ORDER BY activity_date DESC
            LIMIT 1`,
          [rowForSap.flock_no, rowForSap.plant_code, rowForSap.feed_date]
        );
        let d = da.rows[0] || null;
        if (!d) {
          const daAny = await pool.query(
            `SELECT age_days, female_count, male_count
               FROM flock_daily_activity
              WHERE flock_no=$1 AND plant_code=$2
              ORDER BY activity_date DESC
              LIMIT 1`,
            [rowForSap.flock_no, rowForSap.plant_code]
          );
          d = daAny.rows[0] || {};
        }
        rowForSap.sap_age = firstPresent(rowForSap.sap_age, d.age_days);
        rowForSap.sap_female_stock = firstPresent(rowForSap.sap_female_stock, d.female_count);
        rowForSap.sap_male_stock = firstPresent(rowForSap.sap_male_stock, d.male_count);
      }
      if (!rowForSap.sap_hatchdt) {
        const fm = await pool.query(`SELECT hatchery_date FROM flock_master WHERE flock_no=$1 LIMIT 1`, [rowForSap.flock_no]);
        rowForSap.sap_hatchdt = rowForSap.sap_hatchdt || fm.rows[0]?.hatchery_date || null;
      }
      const v = validateFeedingForSap(rowForSap);
      if (v) {
        return {
          ok: false,
          module,
          record_id: id,
          message: `Cannot send to SAP: ${v}`,
          validation_failed: true,
          sap_payload_preview: buildDmfdetRow(rowForSap),
        };
      }
      // NOTE:
      // SAP GET order context is not a reliable validator for all plants/orders/materials.
      // Do not hard-block here; allow SAP POST response to be the source of truth.
      // Keep the helper only for future diagnostics, not for validation gating.
      const dmfdet = [buildFeedMedGeneralRow(rowForSap)];
      const line = buildFeedOrMedLine(rowForSap);
      const empty = { matnr: '', maktx: '', uom: '', lgort: '', stock: '', erfmg: '' };
      const feeddet = String(rowForSap.feed_type || '').toLowerCase() === 'feed' ? [line] : [empty];
      const meddet = String(rowForSap.feed_type || '').toLowerCase() === 'medicine' ? [line] : [empty];

      const params = {
        dmfdet: JSON.stringify(dmfdet),
        feeddet: JSON.stringify(feeddet),
        meddet: JSON.stringify(meddet),
      };
      const res = await postSap('zfeed_med', params);
      return {
        module,
        record_id: id,
        sap_payload_preview: { dmfdet: dmfdet[0], feeddet: feeddet[0], meddet: meddet[0] },
        ...interpretSapResponse(res),
      };
    }

    if (module === 'egg_collection') {
      const h = await pool.query(`SELECT * FROM egg_collection_header WHERE id=$1`, [id]);
      if (h.rowCount === 0) return { ok: false, module, record_id: id, message: 'Record not found' };
      const header = h.rows[0];
      const fm = await pool.query(
        `SELECT flock_no, flock_name, batch, hatchery_date FROM flock_master WHERE flock_no=$1`,
        [header.flock_no]
      );
      const flockRow = fm.rows[0] || {};
      const da = await pool.query(
        `SELECT male_count, female_count, (COALESCE(male_count,0)+COALESCE(female_count,0)) AS stock_total
           FROM flock_daily_activity
          WHERE flock_no=$1 AND plant_code=$2 AND activity_date <= $3
          ORDER BY activity_date DESC
          LIMIT 1`,
        [header.flock_no, header.plant_code, header.collection_date]
      );
      const latestCounts = da.rows[0] || {};
      const flockSapCtx = {
        ...flockRow,
        stock_total: latestCounts.stock_total,
        female_stock: latestCounts.female_count,
        male_stock: latestCounts.male_count,
      };
      const slots = await pool.query(
        `SELECT table_egg, jumbo_egg, crack_egg, waste_reject_egg, hatching_egg
         FROM egg_collection_slots WHERE header_id=$1`,
        [id]
      );
      const totals = {
        table_egg: 0,
        jumbo_egg: 0,
        crack_egg: 0,
        waste_reject_egg: 0,
        hatching_egg: 0,
      };
      for (const s of slots.rows) {
        totals.table_egg += parseFloat(s.table_egg) || 0;
        totals.jumbo_egg += parseFloat(s.jumbo_egg) || 0;
        totals.crack_egg += parseFloat(s.crack_egg) || 0;
        totals.waste_reject_egg += parseFloat(s.waste_reject_egg) || 0;
        totals.hatching_egg += parseFloat(s.hatching_egg) || 0;
      }
      const eggTypes = (await pool.query(
        `SELECT egg_type_id, egg_type_name, sap_field_key FROM egg_type_lookup WHERE is_active=TRUE`
      )).rows;
      let breegrn = buildBreegrnRows(header, flockSapCtx, totals, eggTypes).map(omitEmptyDeepStrings);
      if (breegrn.length === 0) {
        return { ok: false, module, record_id: id, message: 'No egg quantities to send (all zero)' };
      }
      const vEgg = validateEggHeaderForSap(header, breegrn);
      if (vEgg) {
        return {
          ok: false,
          module,
          record_id: id,
          message: `Cannot send to SAP: ${vEgg}`,
          validation_failed: true,
          sap_payload_preview: breegrn,
        };
      }
      const res = await postSap('zlaying_prelay', { breegrn: JSON.stringify(breegrn) });
      return { module, record_id: id, sap_payload_preview: breegrn, ...interpretSapResponse(res) };
    }

    if (module === 'mortality') {
      const r = await pool.query(`SELECT * FROM mortality_log WHERE id=$1`, [id]);
      if (r.rowCount === 0) return { ok: false, module, record_id: id, message: 'Record not found' };
      const rec = { ...r.rows[0] };
      const fm = await pool.query(
        `SELECT flock_name, batch, hatchery_date
           FROM flock_master
          WHERE flock_no=$1
          LIMIT 1`,
        [rec.flock_no]
      );
      const da = await pool.query(
        `SELECT age_days, male_count, female_count, (COALESCE(male_count,0)+COALESCE(female_count,0)) AS stock_total
           FROM flock_daily_activity
          WHERE flock_no=$1 AND plant_code=$2 AND activity_date <= $3
          ORDER BY activity_date DESC
          LIMIT 1`,
        [rec.flock_no, rec.plant_code, rec.entry_date]
      );
      const f = fm.rows[0] || {};
      const d = da.rows[0] || {};
      rec.flock_name = f.flock_name || rec.flock_name;
      rec.batch = f.batch || rec.batch;
      rec.hatchery_date = f.hatchery_date || rec.hatchery_date;
      rec.age_days = d.age_days ?? rec.age_days;
      rec.male_stock = d.male_count ?? rec.male_stock;
      rec.female_stock = d.female_count ?? rec.female_stock;
      rec.stock_total = d.stock_total ?? rec.stock_total;
      const reasonTotals = await getMorKillReasonTotals(pool, 'mortality_reason_log', 'mortality_id', id);
      rec.total_male_count = Number(reasonTotals.male_count) || 0;
      rec.total_female_count = Number(reasonTotals.female_count) || 0;
      rec.total_qty = Number(reasonTotals.total_count) || (rec.total_male_count + rec.total_female_count);
      const vm = validateMorKillForSap(rec);
      if (vm) {
        return {
          ok: false,
          module,
          record_id: id,
          message: `Cannot send to SAP: ${vm}`,
          validation_failed: true,
          sap_payload_preview: buildMorKillRow(rec),
        };
      }
      const payload = [omitEmptyDeepStrings(buildMorKillRow(rec))];
      const res = await postSap('zmortality_ent', { bremor: JSON.stringify(payload) });
      return { module, record_id: id, sap_payload_preview: payload[0], ...interpretSapResponse(res) };
    }

    if (module === 'cull_kill') {
      const r = await pool.query(`SELECT * FROM cull_kill_log WHERE id=$1`, [id]);
      if (r.rowCount === 0) return { ok: false, module, record_id: id, message: 'Record not found' };
      const rec = { ...r.rows[0] };
      const fm = await pool.query(
        `SELECT flock_name, batch, hatchery_date
           FROM flock_master
          WHERE flock_no=$1
          LIMIT 1`,
        [rec.flock_no]
      );
      const da = await pool.query(
        `SELECT age_days, male_count, female_count, (COALESCE(male_count,0)+COALESCE(female_count,0)) AS stock_total
           FROM flock_daily_activity
          WHERE flock_no=$1 AND plant_code=$2 AND activity_date <= $3
          ORDER BY activity_date DESC
          LIMIT 1`,
        [rec.flock_no, rec.plant_code, rec.entry_date]
      );
      const f = fm.rows[0] || {};
      const d = da.rows[0] || {};
      rec.flock_name = f.flock_name || rec.flock_name;
      rec.batch = f.batch || rec.batch;
      rec.hatchery_date = f.hatchery_date || rec.hatchery_date;
      rec.age_days = d.age_days ?? rec.age_days;
      rec.male_stock = d.male_count ?? rec.male_stock;
      rec.female_stock = d.female_count ?? rec.female_stock;
      rec.stock_total = d.stock_total ?? rec.stock_total;
      const reasonTotals = await getMorKillReasonTotals(pool, 'cull_kill_reason_log', 'cull_kill_id', id);
      rec.total_male_count = Number(reasonTotals.male_count) || 0;
      rec.total_female_count = Number(reasonTotals.female_count) || 0;
      rec.total_qty = Number(reasonTotals.total_count) || (rec.total_male_count + rec.total_female_count);
      const vk = validateMorKillForSap(rec);
      if (vk) {
        return {
          ok: false,
          module,
          record_id: id,
          message: `Cannot send to SAP: ${vk}`,
          validation_failed: true,
          sap_payload_preview: buildMorKillRow(rec),
        };
      }
      const payload = [omitEmptyDeepStrings(buildMorKillRow(rec))];
      const res = await postSap('zculls_kill', { breckill: JSON.stringify(payload) });
      return { module, record_id: id, sap_payload_preview: payload[0], ...interpretSapResponse(res) };
    }

    if (module === 'cull_sales') {
      const r = await pool.query(`SELECT * FROM cull_sales_header WHERE id=$1`, [id]);
      if (r.rowCount === 0) return { ok: false, module, record_id: id, message: 'Record not found' };
      const vs = validateCullSaleForSap(r.rows[0]);
      if (vs) {
        return {
          ok: false,
          module,
          record_id: id,
          message: `Cannot send to SAP: ${vs}`,
          validation_failed: true,
          sap_payload_preview: buildCullSaleFlat(r.rows[0]),
        };
      }
      const flat = omitEmptyDeepStrings(buildCullSaleFlat(r.rows[0]));
      const res = await postSap('zculls_sale', flat);
      return { module, record_id: id, sap_payload_preview: flat, ...interpretSapResponse(res) };
    }

    if (module === 'bird_receipt' || module === 'bird_weighing') {
      const r = await pool.query(`SELECT * FROM flock_bird_weight WHERE id=$1`, [id]);
      if (r.rowCount === 0) return { ok: false, module, record_id: id, message: 'Record not found' };
      const vb = validateBirdWeightForSap(r.rows[0]);
      if (vb) {
        return {
          ok: false,
          module,
          record_id: id,
          message: `Cannot send to SAP: ${vb}`,
          validation_failed: true,
          sap_payload_preview: buildBreAfruRow(r.rows[0]),
        };
      }
      const payload = [omitEmptyDeepStrings(buildBreAfruRow(r.rows[0]))];
      const res = await postSap('zbird_receipt', { breafru: JSON.stringify(payload) });
      return { module, record_id: id, sap_payload_preview: payload[0], ...interpretSapResponse(res) };
    }

    return { ok: false, module, record_id: id, message: `Unsupported module for SAP push: ${module}` };
  } catch (err) {
    const status = err.response?.status;
    const sap_response = err.response?.data;
    return {
      ok: false,
      module,
      record_id: id,
      message:
        sap_response != null
          ? summarizeSapBody(sap_response, status || 'error')
          : err.message,
      error: err.message,
      status,
      sap_response,
    };
  }
}

module.exports = {
  pushToSap,
  postSap,
  buildSapPostUrl,
  buildDmfdetRow,
  buildBreegrnRows,
  toDmyFromDbDate,
  parseYmdFromDb,
  omitEmptyDeepStrings,
  summarizeSapBody,
  interpretSapResponse,
};
