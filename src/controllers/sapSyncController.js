/**
 * sapSyncController.js
 *
 * ONE API — marks record as SAP synced in DB
 * Future: will also push data to SAP endpoints
 *
 * POST /api/sap-sync           → mark record as synced
 * GET  /api/sap-sync/status    → check sync status
 * POST /api/sap-sync/pull      → pull data FROM SAP into DB
 */

const pool  = require('../config/db');
const { parseDailyFeedParentId } = require('../utils/dailyFeedParentId');
const axios = require('axios');
const {
  pushToSap,
  postSap,
  interpretSapResponse,
} = require('../services/sapOutboundPush');
const {
  assertSyncAllowedForUser,
  getBusinessDateColumn,
  getTodayYmdIST,
  normalizeYmd,
  canSyncAnyHistoricalDate,
} = require('../utils/sapSyncRules');

const SAP_BASE = process.env.SAP_BASE_URL || 'http://krishidevqas.krishinutrition.com:8001/sap/bc/breeder';
const SAP_AUTH = {
  username: process.env.SAP_USER     || 'vega',
  password: process.env.SAP_PASSWORD || 'Vegaintell@123',
};
const SAP_CLIENT = process.env.SAP_CLIENT || '500';

const MODULE_TABLE = {
  cull_sales:     'cull_sales_header',
  mortality:      'mortality_log',
  cull_kill:      'cull_kill_log',
  feeding:        'flock_feeding_log',
  egg_collection: 'egg_collection_header',
  bird_weighing:  'flock_bird_weight',
  bird_receipt:   'flock_bird_weight',
};

const SAP_ENDPOINT = {
  feeding:        'zfeed_med',
  egg_collection: 'zlaying_prelay',
  mortality:      'zmortality_ent',
  cull_kill:      'zculls_kill',
  cull_sales:     'zculls_sale',
  bird_receipt:   'zbird_receipt',
  bird_weighing:  'zbird_receipt',
};

/** One row per DB table (avoid duplicate keys for same flock_bird_weight) */
const SYNC_QUEUE_MODULES = ['feeding', 'egg_collection', 'mortality', 'cull_kill', 'cull_sales', 'bird_weighing'];

async function fetchUnsyncedRows(pool, module, plant_code, limit) {
  const table = MODULE_TABLE[module];
  const dateCol = getBusinessDateColumn(module);
  const params = [];
  let sql = `SELECT id, plant_code::text AS plant_code`;
  if (dateCol) sql += `, ${dateCol}::text AS business_date`;
  else sql += `, NULL::text AS business_date`;
  sql += ` FROM ${table} WHERE COALESCE(sap_synced,FALSE)=FALSE`;
  // zfeed_med currently supports feed/medicine payload shape only.
  if (module === 'feeding') {
    sql += ` AND feed_type IN ('feed','medicine')`;
  }
  if (plant_code) {
    params.push(plant_code);
    sql += ` AND plant_code=$${params.length}`;
  }
  sql += dateCol ? ` ORDER BY ${dateCol} ASC, id ASC` : ` ORDER BY id ASC`;
  params.push(limit);
  sql += ` LIMIT $${params.length}`;
  const r = await pool.query(sql, params);
  return r.rows;
}

async function getLatestUnsyncedTodayByUser(pool, module, userId) {
  const table = MODULE_TABLE[module];
  const dateCol = getBusinessDateColumn(module);
  if (!table || !dateCol || !userId) return null;
  const todayIst = getTodayYmdIST();
  let sql = `
    SELECT *
      FROM ${table}
     WHERE COALESCE(sap_synced,FALSE)=FALSE
       AND ${dateCol}::date = $1::date
       AND entered_by = $2
  `;
  // zfeed_med payload shape currently supports feed/medicine lines.
  if (module === 'feeding') {
    sql += ` AND feed_type IN ('feed','medicine')`;
  }
  sql += ` ORDER BY id DESC LIMIT 1`;
  const r = await pool.query(sql, [todayIst, userId]);
  return r.rows[0] || null;
}

async function pushAndMarkSynced(pool, module, recordId, userId) {
  const table = MODULE_TABLE[module];
  const pushResult = await pushToSap(pool, module, recordId);
  if (!pushResult.ok) {
    return { ok: false, pushResult };
  }
  const upd = await pool.query(
    `UPDATE ${table}
     SET sap_synced=TRUE, sap_synced_at=NOW(), sap_synced_by=$1, updated_at=NOW()
     WHERE id=$2 AND COALESCE(sap_synced,FALSE)=FALSE
     RETURNING id`,
    [userId, recordId]
  );
  if (upd.rowCount === 0) {
    return { ok: false, pushResult, message: 'Row was synced by another request' };
  }
  return { ok: true, pushResult };
}

/** parent_id from JSON body, urlencoded body, or query string (Postman Params tab). */
function readParentIdFromRequest(req) {
  const b = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const q = req.query && typeof req.query === 'object' ? req.query : {};
  const raw = b.parent_id ?? b.parentId ?? q.parent_id ?? q.parentId;
  if (raw === undefined || raw === null) return '';
  return String(raw).trim();
}

/**
 * Single-record SAP push + local sap_synced flag (same rules as POST /api/sap-sync).
 * @returns {Promise<{ outcome: string, record_id?: number, data?: any, pushResult?: any, message?: string, reason?: string, gate?: any }>}
 */
async function syncOneRecordMarkFlow(pool, module, record_id, userId, user) {
  const table = MODULE_TABLE[module];
  if (!table) {
    return { outcome: 'invalid_module', message: `Invalid module: "${module}"` };
  }

  const idNum = parseInt(record_id, 10);
  if (!module || record_id === undefined || record_id === null || Number.isNaN(idNum)) {
    return { outcome: 'bad_request', message: 'module and numeric record_id required' };
  }

  const check = await pool.query(
    `SELECT id, sap_synced, sap_synced_at FROM ${table} WHERE id=$1`,
    [idNum]
  );
  if (check.rowCount === 0) {
    return { outcome: 'not_found', record_id: idNum };
  }

  if (check.rows[0].sap_synced) {
    return { outcome: 'already_synced', record_id: idNum, data: check.rows[0] };
  }

  const rowRes = await pool.query(`SELECT * FROM ${table} WHERE id=$1`, [idNum]);
  const row = rowRes.rows[0];

  const gate = assertSyncAllowedForUser(module, row, user);
  if (!gate.allowed) {
    return {
      outcome: 'forbidden',
      record_id: idNum,
      message: gate.message,
      reason: gate.reason,
      gate,
    };
  }

  const sapEndpoint = SAP_ENDPOINT[module];
  if (!sapEndpoint) {
    return { outcome: 'no_endpoint', record_id: idNum, message: `No SAP endpoint for module: ${module}` };
  }

  const pushResult = await pushToSap(pool, module, idNum);
  if (!pushResult.ok) {
    return { outcome: 'sap_failed', record_id: idNum, pushResult };
  }

  const result = await pool.query(
    `UPDATE ${table}
     SET sap_synced=TRUE, sap_synced_at=NOW(), sap_synced_by=$1, updated_at=NOW()
     WHERE id=$2 AND COALESCE(sap_synced,FALSE)=FALSE
     RETURNING id, sap_synced, sap_synced_at, sap_synced_by`,
    [userId, idNum]
  );

  if (result.rowCount === 0) {
    return { outcome: 'race_after_push', record_id: idNum, pushResult };
  }

  return { outcome: 'ok', record_id: idNum, pushResult, data: result.rows[0] };
}

/** POST /api/sap-sync body: { parent_id } — sync all flock_feeding_log rows for that grid parent (JWT). */
async function syncFeedingByParentId(req, res) {
  const userId = req.user?.id ?? null;
  const parent_id = readParentIdFromRequest(req);
  if (!parent_id) {
    return res.status(422).json({ success: false, message: 'parent_id required' });
  }

  const parsed = parseDailyFeedParentId(parent_id);
  if (!parsed) {
    return res.status(422).json({
      success: false,
      message:
        'Invalid parent_id. Expected {plant_code}_{YYYY-MM-DD}_{flock_no} (same as GET /api/admin/grid/daily-feed parent_id).',
    });
  }

  try {
    const list = await pool.query(
      `SELECT id, feed_type, sap_synced
         FROM flock_feeding_log
        WHERE plant_code = $1 AND feed_date = $2::date AND flock_no = $3
        ORDER BY id ASC`,
      [parsed.plant_code, parsed.feed_date, parsed.flock_no]
    );

    if (list.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: 'No feeding rows for this parent_id',
        parent_id,
        parsed,
      });
    }

    const succeeded = [];
    const skipped = [];
    const failed = [];

    for (const row of list.rows) {
      if (row.sap_synced) {
        skipped.push({ record_id: row.id, feed_type: row.feed_type, reason: 'already_synced' });
        continue;
      }
      const r = await syncOneRecordMarkFlow(pool, 'feeding', row.id, userId, req.user);
      if (r.outcome === 'ok') {
        succeeded.push({
          record_id: row.id,
          feed_type: row.feed_type,
          sap_push_detail: r.pushResult,
          data: r.data,
        });
      } else if (r.outcome === 'already_synced') {
        skipped.push({ record_id: row.id, feed_type: row.feed_type, reason: 'already_synced' });
      } else if (r.outcome === 'not_found') {
        failed.push({ record_id: row.id, feed_type: row.feed_type, message: 'Record not found' });
      } else if (r.outcome === 'forbidden') {
        failed.push({
          record_id: row.id,
          feed_type: row.feed_type,
          message: r.message,
          reason: r.reason,
          business_date: r.gate?.business_date,
          today_ist: r.gate?.today_ist,
        });
      } else if (r.outcome === 'sap_failed') {
        const pr = r.pushResult || {};
        failed.push({
          record_id: row.id,
          feed_type: row.feed_type,
          message: pr.message || pr.error || 'SAP rejected the push',
          validation_failed: !!pr.validation_failed,
          sap_http_status: pr.status,
          sap_response: pr.sap_response,
          sap_payload_preview: pr.sap_payload_preview,
        });
      } else if (r.outcome === 'race_after_push') {
        skipped.push({
          record_id: row.id,
          feed_type: row.feed_type,
          reason: 'marked_synced_by_parallel_request',
        });
      } else if (r.outcome === 'no_endpoint') {
        failed.push({ record_id: row.id, feed_type: row.feed_type, message: r.message });
      } else {
        failed.push({
          record_id: row.id,
          feed_type: row.feed_type,
          message: r.message || r.outcome || 'Unknown error',
        });
      }
    }

    const okAll = failed.length === 0;
    return res.json({
      success: okAll,
      batch: true,
      module: 'feeding',
      parent_id,
      parsed,
      total_candidates: list.rows.length,
      succeeded_count: succeeded.length,
      skipped_count: skipped.length,
      failed_count: failed.length,
      succeeded,
      skipped,
      failed,
      synced_by_user_id: userId,
      message: okAll
        ? `Synced ${succeeded.length} record(s) to SAP (${skipped.length} skipped)`
        : `Synced ${succeeded.length}, failed ${failed.length}, skipped ${skipped.length}`,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/sap-sync
// Push to SAP, then mark sap_synced ONLY if SAP accepts (HTTP 2xx).
// Body: { module, record_id } — OR { parent_id } for all lines under daily-feed parent (feeding only).
// Mobile users: business date must be today (Asia/Kolkata). Admins: any date.
// ═══════════════════════════════════════════════════════════════════════════
exports.markSynced = async (req, res) => {
  const userId = req.user?.id ?? null;
  const parentStr = readParentIdFromRequest(req);
  if (parentStr) {
    return syncFeedingByParentId(req, res);
  }

  const { module, record_id } = req.body;

  if (!module || !record_id) {
    return res.status(422).json({
      success: false,
      message: 'module and record_id required (or send parent_id for feeding batch)',
      hint:
        'Feeding batch: JSON body {"parent_id":"1904_2026-05-08_LY000001"} or query ?parent_id=... (same format as GET /api/admin/grid/daily-feed). Single row: {"module":"feeding","record_id":169}. Use Content-Type: application/json. If you still see this without the word "parent_id" in the message, restart the API with the latest code.',
      valid_modules: Object.keys(MODULE_TABLE),
    });
  }

  const table = MODULE_TABLE[module];
  if (!table) {
    return res.status(400).json({
      success: false,
      message: `Invalid module: "${module}"`,
      valid_modules: Object.keys(MODULE_TABLE),
    });
  }

  try {
    const r = await syncOneRecordMarkFlow(pool, module, record_id, userId, req.user);

    if (r.outcome === 'not_found') {
      return res.status(404).json({ success: false, message: `Record ${record_id} not found in ${module}` });
    }

    if (r.outcome === 'already_synced') {
      return res.json({
        success: true,
        already_synced: true,
        message: `Record ${record_id} is already SAP synced`,
        data: {
          id: r.record_id,
          module,
          sap_synced: true,
          sap_synced_at: r.data.sap_synced_at,
        },
      });
    }

    if (r.outcome === 'forbidden') {
      return res.status(403).json({
        success: false,
        message: r.message,
        reason: r.reason,
        business_date: r.gate?.business_date,
        today_ist: r.gate?.today_ist,
      });
    }

    if (r.outcome === 'no_endpoint') {
      return res.status(400).json({ success: false, message: r.message });
    }

    if (r.outcome === 'bad_request' || r.outcome === 'invalid_module') {
      return res.status(422).json({ success: false, message: r.message });
    }

    if (r.outcome === 'sap_failed') {
      const pushResult = r.pushResult;
      const msg = pushResult.message || pushResult.error || 'SAP rejected the push';
      console.error(`[sapSync] SAP push failed for ${module} #${record_id}:`, msg);
      const httpStatus = pushResult.validation_failed ? 422 : 502;
      return res.status(httpStatus).json({
        success: false,
        sap_push_failed: !pushResult.validation_failed,
        validation_failed: !!pushResult.validation_failed,
        message: msg,
        sap_http_status: pushResult.status,
        sap_response: pushResult.sap_response,
        sap_payload_preview: pushResult.sap_payload_preview,
        sap_push_detail: pushResult,
      });
    }

    if (r.outcome === 'race_after_push') {
      return res.status(409).json({
        success: false,
        message: 'Record was marked synced by another request after SAP accepted; refresh and retry',
        sap_push_detail: r.pushResult,
      });
    }

    if (r.outcome === 'ok') {
      return res.json({
        success: true,
        message: `✅ ${module} record ${record_id} synced to SAP and marked locally`,
        sap_pushed: true,
        sap_push_detail: r.pushResult,
        synced_by_user_id: userId,
        data: {
          id: r.data.id,
          module,
          table,
          sap_synced: true,
          sap_synced_at: r.data.sap_synced_at,
          sap_synced_by: r.data.sap_synced_by,
        },
      });
    }

    return res.status(500).json({ success: false, message: r.message || 'Unexpected sync outcome' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/sap-sync/mobile-latest
// Mobile quick sync: no record_id needed.
// Syncs the latest unsynced row saved by this user for today (IST) in module.
// Body: { module?: "feeding" } default feeding
// ═══════════════════════════════════════════════════════════════════════════
exports.syncLatestMobile = async (req, res) => {
  const module = req.body?.module || 'feeding';
  const userId = req.user?.id ?? null;
  if (!MODULE_TABLE[module]) {
    return res.status(400).json({
      success: false,
      message: `Invalid module: "${module}"`,
      valid_modules: Object.keys(MODULE_TABLE),
    });
  }
  if (!userId) {
    return res.status(401).json({ success: false, message: 'Login required' });
  }

  try {
    const row = await getLatestUnsyncedTodayByUser(pool, module, userId);
    if (!row) {
      return res.status(422).json({
        success: false,
        message: 'No locally saved unsynced entry found for today. Save data first, then tap SAP Sync.',
        module,
        today_ist: getTodayYmdIST(),
      });
    }

    const gate = assertSyncAllowedForUser(module, row, req.user);
    if (!gate.allowed) {
      return res.status(403).json({
        success: false,
        message: gate.message,
        reason: gate.reason,
        business_date: gate.business_date,
        today_ist: gate.today_ist,
      });
    }

    const pushResult = await pushToSap(pool, module, row.id);
    if (!pushResult.ok) {
      const httpStatus = pushResult.validation_failed ? 422 : 502;
      return res.status(httpStatus).json({
        success: false,
        validation_failed: !!pushResult.validation_failed,
        message: pushResult.message || pushResult.error || 'SAP rejected the push',
        module,
        record_id: row.id,
        sap_http_status: pushResult.status,
        sap_response: pushResult.sap_response,
        sap_payload_preview: pushResult.sap_payload_preview,
      });
    }

    const upd = await pool.query(
      `UPDATE ${MODULE_TABLE[module]}
          SET sap_synced=TRUE, sap_synced_at=NOW(), sap_synced_by=$1, updated_at=NOW()
        WHERE id=$2 AND COALESCE(sap_synced,FALSE)=FALSE
      RETURNING id, sap_synced, sap_synced_at, sap_synced_by`,
      [userId, row.id]
    );
    if (upd.rowCount === 0) {
      return res.status(409).json({
        success: false,
        message: 'Latest row was already synced by another request',
        module,
        record_id: row.id,
      });
    }

    return res.json({
      success: true,
      message: `✅ Synced latest ${module} entry to SAP`,
      module,
      record_id: row.id,
      synced_by_user_id: userId,
      sap_push_detail: pushResult,
      data: upd.rows[0],
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/sap-sync/status?module=&record_id=
// Check sync status of a record
// ═══════════════════════════════════════════════════════════════════════════
exports.getSyncStatus = async (req, res) => {
  const { module, record_id } = req.query;

  if (!module || !record_id) {
    return res.status(422).json({ success: false, message: 'module and record_id required' });
  }

  const table = MODULE_TABLE[module];
  if (!table) {
    return res.status(400).json({ success: false, message: `Invalid module: "${module}"` });
  }

  const dateCol = getBusinessDateColumn(module);
  const dateExpr = dateCol ? `t.${dateCol}::text AS business_date` : 'NULL::text AS business_date';

  try {
    const r = await pool.query(
      `SELECT t.id, t.sap_synced, t.sap_synced_at, t.sap_synced_by,
              ${dateExpr},
              a.username AS sap_synced_by_username
       FROM ${table} t
       LEFT JOIN admin a ON a.id = t.sap_synced_by
       WHERE t.id=$1`,
      [record_id]
    );
    if (r.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Record not found' });
    }
    const row = r.rows[0];
    const synced = row.sap_synced || false;
    const businessYmd = normalizeYmd(row.business_date);
    const todayIst = getTodayYmdIST();
    const adminUser = canSyncAnyHistoricalDate(req.user);
    const can_sync_mobile =
      !synced && !!businessYmd && businessYmd === todayIst;
    const can_sync_admin = !synced && adminUser;

    return res.json({
      success: true,
      data: {
        id: parseInt(record_id, 10),
        module,
        sap_synced: synced,
        sap_synced_at: row.sap_synced_at || null,
        sap_synced_by: row.sap_synced_by || null,
        sap_synced_by_username: row.sap_synced_by_username || null,
        business_date: businessYmd,
        today_ist: todayIst,
        can_edit: !synced,
        can_delete: !synced,
        can_sync_to_sap_mobile: can_sync_mobile,
        can_sync_to_sap_admin: can_sync_admin,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/sap-sync/push
// Push one DB row to SAP only (no DB sap_synced flag). Body: { module, record_id }
// Modules: feeding, egg_collection, mortality, cull_kill, cull_sales, bird_receipt | bird_weighing
// ═══════════════════════════════════════════════════════════════════════════
exports.pushToSapOnly = async (req, res) => {
  const { module, record_id } = req.body;
  if (!module || !record_id) {
    return res.status(422).json({
      success: false,
      message: 'module and record_id required',
      valid_modules: Object.keys(SAP_ENDPOINT),
    });
  }
  if (!SAP_ENDPOINT[module]) {
    return res.status(400).json({
      success: false,
      message: `No SAP push mapping for module: "${module}"`,
      valid_modules: Object.keys(SAP_ENDPOINT),
    });
  }

  const table = MODULE_TABLE[module];
  if (!table) {
    return res.status(400).json({ success: false, message: `Invalid module: "${module}"` });
  }

  try {
    const rowRes = await pool.query(`SELECT * FROM ${table} WHERE id=$1`, [record_id]);
    if (rowRes.rowCount === 0) {
      return res.status(404).json({ success: false, module, record_id, message: 'Record not found' });
    }

    const gate = assertSyncAllowedForUser(module, rowRes.rows[0], req.user);
    if (!gate.allowed) {
      return res.status(403).json({
        success: false,
        message: gate.message,
        reason: gate.reason,
        business_date: gate.business_date,
        today_ist: gate.today_ist,
      });
    }

    const result = await pushToSap(pool, module, record_id);
    if (result.message === 'Record not found') {
      return res.status(404).json({ success: false, ...result });
    }
    if (!result.ok) {
      const httpStatus = result.validation_failed ? 422 : 502;
      return res.status(httpStatus).json({
        success: false,
        validation_failed: !!result.validation_failed,
        message: result.message || result.error || 'SAP rejected the push',
        sap_http_status: result.status,
        sap_response: result.sap_response,
        sap_payload_preview: result.sap_payload_preview,
        ...result,
      });
    }
    return res.json({
      success: true,
      triggered_by_user_id: req.user?.id ?? null,
      ...result,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/sap-sync/push-raw  (admin / Postman — exact SAP query params)
// Body: { endpoint: "zfeed_med", params: { dmfdet: '[...]' } }
// ═══════════════════════════════════════════════════════════════════════════
exports.pushRaw = async (req, res) => {
  const { endpoint, params } = req.body || {};
  if (!endpoint || typeof params !== 'object' || params === null) {
    return res.status(422).json({ success: false, message: 'endpoint (string) and params (object) required' });
  }
  try {
    const r = await postSap(endpoint, params);
    const ir = interpretSapResponse(r);
    if (!ir.ok) {
      return res.status(502).json({
        success: false,
        message: ir.message,
        sap_http_status: ir.status,
        sap_response: ir.sap_response,
      });
    }
    return res.json({
      success: true,
      sap_http_status: ir.status,
      sap_response: ir.sap_response,
    });
  } catch (err) {
    return res.status(502).json({
      success: false,
      message: err.message,
      status: err.response?.status,
      sap_response: err.response?.data,
    });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/sap-sync/unsynced?plant_code=&limit=&modules=feeding,egg_collection
// Admin — rows pending SAP push
// ═══════════════════════════════════════════════════════════════════════════
exports.listUnsynced = async (req, res) => {
  const plant_code = req.query.plant_code || null;
  const limit = Math.min(parseInt(req.query.limit || '30', 10) || 30, 200);
  let modules = SYNC_QUEUE_MODULES;
  if (req.query.modules) {
    modules = String(req.query.modules)
      .split(',')
      .map((s) => s.trim())
      .filter((m) => SYNC_QUEUE_MODULES.includes(m));
    if (modules.length === 0) modules = SYNC_QUEUE_MODULES;
  }

  try {
    const out = {};
    let total = 0;
    for (const mod of modules) {
      const rows = await fetchUnsyncedRows(pool, mod, plant_code, limit);
      out[mod] = rows;
      total += rows.length;
    }
    return res.json({
      success: true,
      plant_code,
      limit_per_module: limit,
      total_rows: total,
      data: out,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/sap-sync/push-unsynced
// Admin — push outstanding rows to SAP and mark synced (no mobile “today” restriction)
// Body: { plant_code?, limit_per_module?: 25, modules?: ["feeding", ...] }
// ═══════════════════════════════════════════════════════════════════════════
exports.pushUnsyncedBulk = async (req, res) => {
  const plant_code = req.body?.plant_code || null;
  const limitPerModule = Math.min(parseInt(req.body?.limit_per_module ?? '25', 10) || 25, 100);
  let modules = SYNC_QUEUE_MODULES;
  if (Array.isArray(req.body?.modules) && req.body.modules.length) {
    modules = req.body.modules.filter((m) => SYNC_QUEUE_MODULES.includes(m));
    if (modules.length === 0) modules = SYNC_QUEUE_MODULES;
  }

  const userId = req.user?.id ?? null;
  const succeeded = [];
  const failed = [];

  try {
    for (const mod of modules) {
      const rows = await fetchUnsyncedRows(pool, mod, plant_code, limitPerModule);
      for (const row of rows) {
        const r = await pushAndMarkSynced(pool, mod, row.id, userId);
        if (r.ok) {
          succeeded.push({ module: mod, record_id: row.id, plant_code: row.plant_code });
        } else {
          failed.push({
            module: mod,
            record_id: row.id,
            plant_code: row.plant_code,
            message: r.pushResult?.message || r.message,
            sap_http_status: r.pushResult?.status,
            sap_response: r.pushResult?.sap_response,
            sap_payload_preview: r.pushResult?.sap_payload_preview,
          });
        }
      }
    }

    return res.json({
      success: failed.length === 0,
      message:
        failed.length === 0
          ? `Synced ${succeeded.length} record(s) to SAP`
          : `Synced ${succeeded.length}, failed ${failed.length}`,
      succeeded_count: succeeded.length,
      failed_count: failed.length,
      succeeded,
      failed,
      synced_by_user_id: userId,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/sap-sync/pull
// Pull data FROM SAP into DB
// Body: { module, werks }
//
// Modules: feeding, egg_collection, mortality, cull_kill, cull_sales
// ═══════════════════════════════════════════════════════════════════════════
exports.pullFromSAP = async (req, res) => {
  const { module, werks } = req.body;

  if (!module || !werks) {
    return res.status(422).json({
      success: false,
      message: 'module and werks (plant_code) required',
      valid_modules: Object.keys(SAP_ENDPOINT)
    });
  }

  const endpoint = SAP_ENDPOINT[module];
  if (!endpoint) {
    return res.status(400).json({
      success: false,
      message: `No SAP endpoint for module: "${module}"`,
      valid_modules: Object.keys(SAP_ENDPOINT)
    });
  }

  try {
    // Fetch from SAP
    const sapUrl = `${SAP_BASE}/${endpoint}`;
    const response = await axios.get(sapUrl, {
      auth: { username: SAP_AUTH.username, password: SAP_AUTH.password },
      params: { 'sap-client': SAP_CLIENT, werks },
      timeout: 30000
    });

    const rawData = response.data;
    const records = Array.isArray(rawData) ? rawData : [rawData];

    // Filter out deleted records (loekz = "X")
    const active = records.filter(r => r.loekz !== 'X');
    if (!active.length) {
      return res.json({ success: true, message: 'No active records from SAP', saved: 0 });
    }

    let saved = 0;
    let skipped = 0;
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      if (module === 'mortality') {
        for (const r of active) {
          if (!r.matnr || !r.bldat) { skipped++; continue; }
          await client.query(`
            INSERT INTO mortality_log
              (flock_no, plant_code, order_no, entry_date, total_female, total_male, total_qty, sap_synced, sap_synced_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE,NOW())
            ON CONFLICT DO NOTHING
          `, [r.matnr, r.werks, r.aufnr || null, r.bldat, r.fkimgF||0, r.fkimgM||0, r.fkimg||0]);
          saved++;
        }
      }

      else if (module === 'cull_kill') {
        for (const r of active) {
          if (!r.matnr || !r.bldat) { skipped++; continue; }
          await client.query(`
            INSERT INTO cull_kill_log
              (flock_no, plant_code, order_no, entry_date, total_female, total_male, total_qty, sap_synced, sap_synced_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE,NOW())
            ON CONFLICT DO NOTHING
          `, [r.matnr, r.werks, r.aufnr || null, r.bldat, r.fkimgF||0, r.fkimgM||0, r.fkimg||0]);
          saved++;
        }
      }

      else if (module === 'cull_sales') {
        for (const r of active) {
          if (!r.plnbez || !r.bldat) { skipped++; continue; }
          await client.query(`
            INSERT INTO cull_sales_header
              (flock_no, plant_code, order_no, entry_date, bill_no, dc_no, customer, customer_type,
               sales_type, vehicle_no, order_by, dispatched_by, rate, bill_value, gross_value,
               net_weight_male, net_weight_female, sap_synced, sap_synced_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,TRUE,NOW())
            ON CONFLICT (flock_no, entry_date) DO UPDATE SET
              order_no=$3, bill_no=$5, customer=$7, rate=$13, bill_value=$14, sap_synced=TRUE, sap_synced_at=NOW()
          `, [
            r.plnbez, r.werks, r.aufnr || null, r.bldat,
            r.zzbDocno||null, r.bstnk||null, r.name1Gp||null,
            r.zzcusType||null, r.zzsalType||null, r.venum||null,
            r.zzorderByN||null, r.zzdispByN||null,
            r.netpr||0, r.netwr||0, r.netwr||0,
            r.fkimgF||0, r.fkimgM||0
          ]);
          saved++;
        }
      }

      else if (module === 'feeding') {
        for (const r of active) {
          const gi = r.generalInfo;
          if (!gi?.plnbez || !gi?.bldat) { skipped++; continue; }
          // Save feed items
          for (const f of (r.feedDet || [])) {
            if (f.loekz === 'X') continue;
            await client.query(`
              INSERT INTO flock_feeding_log
                (flock_no, plant_code, order_no, feed_date, feed_type, item_id, item_name, uom,
                 qty_issued_male, qty_issued_female, sap_synced, sap_synced_at)
              VALUES ($1,$2,$3,$4,'feed',$5,$6,$7,$8,$9,TRUE,NOW())
              ON CONFLICT DO NOTHING
            `, [gi.plnbez, gi.werks, gi.aufnr || null, gi.bldat, f.matnr, f.maktx, f.meins, f.erfmgM||0, f.erfmgF||0]);
            saved++;
          }
          // Save medicine items
          for (const m of (r.medDet || [])) {
            if (m.loekz === 'X') continue;
            await client.query(`
              INSERT INTO flock_feeding_log
                (flock_no, plant_code, order_no, feed_date, feed_type, item_id, item_name, uom,
                 qty_issued_male, qty_issued_female, sap_synced, sap_synced_at)
              VALUES ($1,$2,$3,$4,'medicine',$5,$6,$7,$8,$9,TRUE,NOW())
              ON CONFLICT DO NOTHING
            `, [gi.plnbez, gi.werks, gi.aufnr || null, gi.bldat, m.matnr, m.maktx, m.meins, m.erfmgM||0, m.erfmgF||0]);
            saved++;
          }
        }
      }

      else if (module === 'egg_collection') {
        // Group by mblnr (document) and bldat (date)
        const grouped = {};
        for (const r of active) {
          if (!r.matnr || !r.bldat) continue;
          const key = `${r.matnr}_${r.werks}_${r.bldat}`;
          if (!grouped[key]) {
            grouped[key] = { flock_no: r.matnr, plant_code: r.werks, order_no: r.aufnr || null, date: r.bldat, eggs: {} };
          }
          // Map matnrE to egg type
          const typeMap = {
            'EG000001': 'hatching_egg',
            'EG000002': 'table_egg',
            'EG000003': 'jumbo_egg',
            'EG000005': 'crack_egg',
            'EG000006': 'waste_reject_egg',
          };
          const col = typeMap[r.matnrE];
          if (col) grouped[key].eggs[col] = (grouped[key].eggs[col] || 0) + (parseFloat(r.grQty) || 0);
          if (r.zeggWt) grouped[key].eggs.egg_weight = r.zeggWt;
        }

        for (const g of Object.values(grouped)) {
          // Upsert header
          const hRes = await client.query(`
            INSERT INTO egg_collection_header (flock_no, plant_code, order_no, collection_date, sap_synced, sap_synced_at)
            VALUES ($1,$2,$3,$4,TRUE,NOW())
            ON CONFLICT (flock_no, plant_code, collection_date) DO UPDATE SET order_no=$3, sap_synced=TRUE, sap_synced_at=NOW()
            RETURNING id
          `, [g.flock_no, g.plant_code, g.order_no || null, g.date]);

          const headerId = hRes.rows[0].id;

          // Upsert slot (ALL = single slot for SAP data)
          await client.query(`
            INSERT INTO egg_collection_slots
              (header_id, schedule_time, table_egg, jumbo_egg, crack_egg, waste_reject_egg, hatching_egg, egg_weight)
            VALUES ($1,'ALL',$2,$3,$4,$5,$6,$7)
            ON CONFLICT (header_id, schedule_time)
            DO UPDATE SET
              table_egg=$2, jumbo_egg=$3, crack_egg=$4,
              waste_reject_egg=$5, hatching_egg=$6, egg_weight=$7, updated_at=NOW()
          `, [
            headerId,
            g.eggs.table_egg||0, g.eggs.jumbo_egg||0,
            g.eggs.crack_egg||0, g.eggs.waste_reject_egg||0,
            g.eggs.hatching_egg||0, g.eggs.egg_weight||null
          ]);
          saved++;
        }
      }

      await client.query('COMMIT');
    } catch (dbErr) {
      await client.query('ROLLBACK');
      throw dbErr;
    } finally {
      client.release();
    }

    return res.json({
      success: true,
      message: `✅ SAP pull complete for ${module} (werks: ${werks})`,
      total_from_sap: records.length,
      deleted_in_sap: records.length - active.length,
      saved,
      skipped
    });

  } catch (err) {
    if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' || err.response?.status === 401) {
      return res.status(503).json({
        success: false,
        message: 'SAP server not reachable. Check SAP_BASE_URL and credentials in .env',
        error: err.message
      });
    }
    return res.status(500).json({ success: false, message: err.message });
  }
};
