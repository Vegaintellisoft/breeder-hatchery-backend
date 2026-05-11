/**
 * cullSalesMasterController.js
 *
 * Exact mirror of broiler's masterSync.js adapted for Breeder.
 *
 * SAP Tables used for Cull Sales dropdowns:
 *   broiler_stock_location  → Customer dropdown       (SAP: ZBRO_LOC)
 *   broiler_sales_rate      → Customer + Rate         (SAP: ZBRO_SAL_RATE)
 *   broiler_sales_emp_default → Order By / Disp By   (SAP: ZZBS_EMP_DET)
 *   vehicle_type_cost       → Transport By            (SAP: vehicle endpoint)
 *
 * Routes:
 *   POST GET /api/cull-sales/masters/sync/:name   → sync from SAP → save to DB
 *   GET      /api/cull-sales/masters/getAll/:name → get all records from DB
 *   GET      /api/cull-sales/dropdowns            → all dropdowns in one call
 */

const pool  = require('../config/db');
const axios = require('axios');

const SAP_BASE = process.env.SAP_BASE_URL || 'http://krishidevqas.krishinutrition.com:8001/sap/bc/breeder';
const SAP_AUTH = {
  username: process.env.SAP_USER     || 'vega',
  password: process.env.SAP_PASSWORD || 'Vega@1234'
};

// ── Valid master table names (same as broiler uniqueKeys) ─────────────────
const MASTER_CONFIG = {
  broiler_stock_location: {
    sapEndpoint: 'ZBRO_LOC',
    uniqueKeys:  ['mandt', 'werks', 'lifnr'],
    description: 'Customer list'
  },
  broiler_sales_rate: {
    sapEndpoint: 'ZBRO_SAL_RATE',
    uniqueKeys:  ['mandt', 'werks', 'allPer'],
    description: 'Customer rate'
  },
  broiler_sales_emp_default: {
    sapEndpoint: 'ZZBS_EMP_DET',
    uniqueKeys:  ['mandt', 'werks', 'zzdispBy', 'zzorderBy'],
    description: 'Order By / Dispatched By employees'
  },
  vehicle_type_cost: {
    sapEndpoint: 'VEH_TYPE',
    uniqueKeys:  ['mandt', 'zvehStyp'],
    description: 'Transport types'
  },
};

// ── Helper: normalize payload (same as broiler) ───────────────────────────
function normalizePayload(body) {
  if (!body) return [];
  if (Array.isArray(body)) {
    const merged = Object.assign({}, ...body.filter(Boolean));
    return Object.values(merged).filter(v => typeof v === 'object');
  }
  if (typeof body === 'object') {
    const rows = [];
    for (const k of Object.keys(body)) {
      if (/^\d+$/.test(k) && typeof body[k] === 'object') rows.push(body[k]);
    }
    if (rows.length) return rows;
    const vals = Object.values(body).filter(v => typeof v === 'object');
    if (vals.length > 0) return vals;
    return [body];
  }
  return [];
}

// ── Helper: build upsert query (same as broiler) ──────────────────────────
function buildUpsertQuery(table, rows, keyFields) {
  const colsSet = new Set();
  rows.forEach(r => Object.keys(r).forEach(c => colsSet.add(c)));
  const cols = [...colsSet];

  const values = [];
  const rowPlaceholders = rows.map(r => {
    const ph = cols.map(c => {
      values.push(r[c] === undefined ? null : r[c]);
      return `$${values.length}`;
    });
    return `(${ph.join(', ')})`;
  });

  const conflictCols  = keyFields.map(c => `"${c}"`).join(', ');
  const nonKeyCols    = cols.filter(c => !keyFields.includes(c));
  const updateClause  = nonKeyCols.length
    ? nonKeyCols.map(c => `"${c}" = EXCLUDED."${c}"`).join(', ') + ', updated_at = CURRENT_TIMESTAMP'
    : 'updated_at = CURRENT_TIMESTAMP';

  const columnList = cols.map(c => `"${c}"`).join(', ');
  const sql = `
    INSERT INTO "${table}" (${columnList})
    VALUES ${rowPlaceholders.join(', ')}
    ON CONFLICT (${conflictCols})
    DO UPDATE SET ${updateClause}
  `;
  return { sql, values };
}

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/cull-sales/masters/sync/:name
// Sync from SAP → save to local DB (same as broiler broilerMasterInsert)
// Can also be called directly with body data (no SAP call needed)
// Body: array of records or object with numeric keys
// ═══════════════════════════════════════════════════════════════════════════
exports.masterInsert = async (req, res) => {
  const { name } = req.params;
  if (!MASTER_CONFIG[name]) {
    return res.status(400).json({ success: false, error: `Unknown master: ${name}. Valid: ${Object.keys(MASTER_CONFIG).join(', ')}` });
  }

  const rows = normalizePayload(req.body);
  if (!rows.length) return res.status(400).json({ success: false, error: 'No valid records found in payload' });

  const keyFields = MASTER_CONFIG[name].uniqueKeys;

  for (const r of rows) {
    for (const k of keyFields) {
      if (!(k in r)) {
        return res.status(400).json({ success: false, error: `Missing key '${k}' in one or more rows for ${name}` });
      }
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const MAX_CHUNK = 1000;
    for (let i = 0; i < rows.length; i += MAX_CHUNK) {
      const chunk = rows.slice(i, i + MAX_CHUNK);
      const { sql, values } = buildUpsertQuery(name, chunk, keyFields);
      await client.query(sql, values);
    }
    await client.query('COMMIT');
    return res.json({ success: true, message: `${rows.length} records saved to ${name}` });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[masterInsert]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/cull-sales/masters/sync/:name?werks=1902
// Pull from SAP + save to DB (same as broiler sapSyncController)
// ═══════════════════════════════════════════════════════════════════════════
exports.syncFromSAP = async (req, res) => {
  const { name } = req.params;
  const { werks }  = req.query;

  if (!MASTER_CONFIG[name]) {
    return res.status(400).json({ success: false, error: `Unknown master: ${name}` });
  }

  const config = MASTER_CONFIG[name];

  try {
    // Fetch from SAP
    const url = `${SAP_BASE}/${config.sapEndpoint}`;
    const response = await axios.get(url, {
      auth: SAP_AUTH,
      params: { 'sap-client': process.env.SAP_CLIENT || '500', ...(werks ? { werks } : {}) },
      timeout: 30000
    });

    const rawData = response.data;
    const rows    = Array.isArray(rawData) ? rawData : Object.values(rawData).filter(v => typeof v === 'object');

    if (!rows.length) {
      return res.json({ success: true, message: 'No records from SAP', saved: 0 });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { sql, values } = buildUpsertQuery(name, rows, config.uniqueKeys);
      await client.query(sql, values);
      await client.query('COMMIT');
      return res.json({ success: true, message: `${rows.length} records synced from SAP to ${name}`, saved: rows.length });
    } catch (dbErr) {
      await client.query('ROLLBACK');
      return res.status(500).json({ success: false, error: dbErr.message });
    } finally {
      client.release();
    }
  } catch (sapErr) {
    // SAP not reachable — return DB data instead
    console.error('[syncFromSAP] SAP error:', sapErr.message, '— falling back to DB');
    try {
      const r = await pool.query(`SELECT * FROM "${name}" ORDER BY id ASC`);
      return res.json({
        success: true,
        message: `SAP unavailable — returning ${r.rowCount} records from DB`,
        sap_error: sapErr.message,
        data: r.rows
      });
    } catch (dbErr) {
      return res.status(500).json({ success: false, error: dbErr.message });
    }
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/cull-sales/masters/getAll/:name?werks=1902
// Get all records from local DB (same as broiler getAllBroilerMaster)
// ═══════════════════════════════════════════════════════════════════════════
exports.getAllMaster = async (req, res) => {
  const { name }  = req.params;
  const { werks } = req.query;

  if (!MASTER_CONFIG[name]) {
    return res.status(400).json({ success: false, error: `Unknown master: ${name}. Valid: ${Object.keys(MASTER_CONFIG).join(', ')}` });
  }

  try {
    let sql    = `SELECT * FROM "${name}"`;
    const vals = [];
    if (werks) { sql += ` WHERE werks = $1`; vals.push(werks); }
    sql += ` ORDER BY id ASC`;

    const result = await pool.query(sql, vals);
    return res.json({ success: true, total: result.rowCount, data: result.rows });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/cull-sales/dropdowns?plant_code=1902
// All 6 dropdowns in ONE call — same pattern as broiler supply screen
//
// Returns:
//   customer_types[]    → customer_type_master
//   customers[]         → broiler_stock_location (lifnr, wName1, lName1)
//   sales_types[]       → sales_type_master
//   transport_types[]   → vehicle_type_cost (zvehStyp, traCost)
//   order_by_list[]     → broiler_sales_emp_default (zzorderBy)
//   dispatched_by_list[]→ broiler_sales_emp_default (zzdispBy)
// ═══════════════════════════════════════════════════════════════════════════
exports.getAllDropdowns = async (req, res) => {
  const { plant_code } = req.query;
  const werks = plant_code || null;

  try {
    const [ctRes, custRes, stRes, ttRes, empRes] = await Promise.all([

      // Customer Types (static)
      pool.query(`SELECT id, type_name AS label FROM customer_type_master WHERE is_active=TRUE ORDER BY type_name`),

      // Customers from broiler_stock_location (SAP synced)
      pool.query(
        `SELECT id, lifnr AS customer_code, "wName1" AS customer_name, "lName1" AS address, werks AS plant_code
         FROM broiler_stock_location
         WHERE ($1::text IS NULL OR werks=$1)
         ORDER BY "wName1"`,
        [werks]
      ),

      // Sales Types (static)
      pool.query(`SELECT id, type_name AS label FROM sales_type_master WHERE is_active=TRUE ORDER BY type_name`),

      // Transport Types from vehicle_type_cost (SAP synced)
      pool.query(`SELECT id, "zvehStyp" AS label, "traCost" AS cost FROM vehicle_type_cost ORDER BY "zvehStyp"`),

      // Employees from broiler_sales_emp_default (SAP synced)
      pool.query(
        `SELECT id, "zzorderBy" AS order_by, "zzdispBy" AS dispatched_by, werks AS plant_code
         FROM broiler_sales_emp_default
         WHERE ($1::text IS NULL OR werks=$1)
         ORDER BY "zzdispBy"`,
        [werks]
      ),
    ]);

    // Build unique order_by and dispatched_by lists
    const orderBySet     = new Set();
    const dispatchedBySet = new Set();
    empRes.rows.forEach(e => {
      if (e.order_by)     orderBySet.add(e.order_by);
      if (e.dispatched_by) dispatchedBySet.add(e.dispatched_by);
    });

    return res.json({
      success: true,
      data: {
        customer_types:     ctRes.rows,
        customers:          custRes.rows.map(c => ({
          id:            c.id,
          customer_code: c.customer_code,
          label:         c.customer_name,
          address:       c.address,
          plant_code:    c.plant_code,
        })),
        sales_types:        stRes.rows,
        transport_types:    ttRes.rows,
        order_by_list:      [...orderBySet].map(v => ({ label: v })),
        dispatched_by_list: [...dispatchedBySet].map(v => ({ label: v })),
      }
    });
  } catch (err) {
    console.error('[getAllDropdowns]', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── Individual dropdown endpoints (for individual use if needed) ───────────

exports.getCustomerTypes = async (req, res) => {
  try {
    const r = await pool.query(`SELECT id, type_name AS label FROM customer_type_master WHERE is_active=TRUE ORDER BY type_name`);
    return res.json({ success: true, data: r.rows });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

exports.getCustomers = async (req, res) => {
  const { plant_code } = req.query;
  try {
    const r = await pool.query(
      `SELECT id, lifnr AS customer_code, "wName1" AS label, "lName1" AS address
       FROM broiler_stock_location
       WHERE ($1::text IS NULL OR werks=$1) ORDER BY "wName1"`,
      [plant_code || null]
    );
    return res.json({ success: true, data: r.rows });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

exports.getSalesTypes = async (req, res) => {
  try {
    const r = await pool.query(`SELECT id, type_name AS label FROM sales_type_master WHERE is_active=TRUE ORDER BY type_name`);
    return res.json({ success: true, data: r.rows });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

exports.getTransportTypes = async (req, res) => {
  try {
    const r = await pool.query(`SELECT id, "zvehStyp" AS label, "traCost" AS cost FROM vehicle_type_cost ORDER BY "zvehStyp"`);
    return res.json({ success: true, data: r.rows });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

exports.getOrderBy = async (req, res) => {
  const { plant_code } = req.query;
  try {
    const r = await pool.query(
      `SELECT DISTINCT "zzorderBy" AS label FROM broiler_sales_emp_default
       WHERE ($1::text IS NULL OR werks=$1) AND "zzorderBy" IS NOT NULL ORDER BY "zzorderBy"`,
      [plant_code || null]
    );
    return res.json({ success: true, data: r.rows });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

exports.getDispatchedBy = async (req, res) => {
  const { plant_code } = req.query;
  try {
    const r = await pool.query(
      `SELECT DISTINCT "zzdispBy" AS label FROM broiler_sales_emp_default
       WHERE ($1::text IS NULL OR werks=$1) AND "zzdispBy" IS NOT NULL ORDER BY "zzdispBy"`,
      [plant_code || null]
    );
    return res.json({ success: true, data: r.rows });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

// Admin add
exports.addCustomerType = async (req, res) => {
  const { type_name } = req.body;
  if (!type_name) return res.status(422).json({ success: false, message: 'type_name required' });
  try {
    const r = await pool.query(`INSERT INTO customer_type_master (type_name) VALUES ($1) RETURNING *`, [type_name]);
    return res.status(201).json({ success: true, data: r.rows[0] });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

exports.addSalesType = async (req, res) => {
  const { type_name } = req.body;
  if (!type_name) return res.status(422).json({ success: false, message: 'type_name required' });
  try {
    const r = await pool.query(`INSERT INTO sales_type_master (type_name) VALUES ($1) RETURNING *`, [type_name]);
    return res.status(201).json({ success: true, data: r.rows[0] });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};
