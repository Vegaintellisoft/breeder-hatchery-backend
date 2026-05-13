const { parseDate, todayDate, formatRow } = require('../utils/dateUtils');
// ══════════════════════════════════════════════════════════════════════════
// adminGridController.js
// Admin panel — list/view/delete for Daily Feed, Mortality, Cull Kill
//
// Real tables used:
//   flock_feeding_log  — feed_date, feed_type, flock_no, plant_code, item_id, item_name, qty_issued_male/female, stock_in_bags, cum_feed
//   mortality_log      — entry_date, flock_no, plant_code, shed_id, part_id, line_id, morning/afternoon/evening columns, reason_log (child)
//   cull_kill_log      — same columns as mortality_log, reason_log in cull_kill_reason_log
//   farms              — plant_code, plant_name
//   flock_master       — flock_no, flock_name
//   shed_master        — id, shed_no, shed_name
//   shed_part_master   — id, part_row_no
//   shed_line_master   — id, line_no
// ══════════════════════════════════════════════════════════════════════════
const pool = require('../config/db');
const { buildDailyFeedParentId } = require('../utils/dailyFeedParentId');

// ────────────────────────────────────────────────────────────────────────
// 1. DAILY FEED GRID — ALL TYPES IN ONE GRID
//    GET /api/admin/grid/daily-feed
//    Columns: S.No | Date | Plant Name | Flock | Type | Feed | Water | Medicine | Others | Actions
//
//    Each row = one flock + one date (+ plant)
//    parent_id = "{plant_code}_{entry_date}_{flock_no}" — same on parent row and every child line
//    SAP: each line id is still flock_feeding_log.id (record_id); parent sap_fully_synced = all lines synced
//    Shows summary counts for all 4 types side by side
//    Filter by feed_type to narrow to one type, or leave blank for all
//
//    Query params: search, from_date, to_date, plant_code, flock_no,
//                  feed_type (optional filter: feed|water|medicine|others)
//    (No limit/offset — returns all matching date+flock groups.)
// ────────────────────────────────────────────────────────────────────────
exports.getDailyFeedGrid = async (req, res) => {
  try {
    const {
      search, from_date, to_date, plant_code, flock_no,
      feed_type,           // optional — if blank, show ALL types
    } = req.query;

    const conds = [];
    const vals  = [];
    let   idx   = 1;

    if (feed_type) {
      conds.push(`ffl.feed_type = $${idx}`);
      vals.push(feed_type); idx++;
    }
    if (search) {
      conds.push(`(ffl.flock_no ILIKE $${idx} OR COALESCE(f.plant_name, ffl.plant_code) ILIKE $${idx} OR ffl.item_name ILIKE $${idx})`);
      vals.push(`%${search}%`); idx++;
    }
    if (from_date) { conds.push(`ffl.feed_date >= $${idx}`); vals.push(from_date); idx++; }
    if (to_date)   { conds.push(`ffl.feed_date <= $${idx}`); vals.push(to_date);   idx++; }
    if (plant_code){ conds.push(`ffl.plant_code = $${idx}`); vals.push(plant_code); idx++; }
    if (flock_no)  { conds.push(`ffl.flock_no = $${idx}`);   vals.push(flock_no);  idx++; }

    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';

    // ── COUNT distinct (date + flock) groups — use filterVals only (no limit/offset) ──
    const countRes = await pool.query(
      `SELECT COUNT(*) FROM (
         SELECT TO_CHAR(ffl.feed_date,'YYYY-MM-DD') AS feed_date, ffl.flock_no
         FROM flock_feeding_log ffl
         LEFT JOIN farms f ON f.plant_code = ffl.plant_code
         ${where}
         GROUP BY TO_CHAR(ffl.feed_date,'YYYY-MM-DD'), ffl.flock_no
       ) sub`,
      vals   // only filter params — no limit/offset
    );
    const total = parseInt(countRes.rows[0].count);

    // We fetch all items for every (date, flock) group matching filters (no pagination).

    // Step 1: all distinct group keys
    const groupRes = await pool.query(
      `SELECT TO_CHAR(ffl.feed_date,'YYYY-MM-DD') AS feed_date, ffl.flock_no
       FROM flock_feeding_log ffl
       LEFT JOIN farms f ON f.plant_code = ffl.plant_code
       ${where}
       GROUP BY TO_CHAR(ffl.feed_date,'YYYY-MM-DD'), ffl.flock_no
       ORDER BY TO_CHAR(ffl.feed_date,'YYYY-MM-DD') DESC, ffl.flock_no`,
      vals
    );

    if (!groupRes.rows.length) {
      return res.json({ success: true, total, data: [] });
    }

    // Step 2: fetch all item rows for those groups
    const pairs = groupRes.rows;
    // Build IN clause: (feed_date, flock_no) IN (($1,$2),($3,$4)...)
    const pairParams = [];
    const pairPlaceholders = pairs.map((p, i) => {
      pairParams.push(p.feed_date, p.flock_no);
      return `($${pairParams.length - 1}::text, $${pairParams.length})`;
    });

    const result = await pool.query(
      `SELECT
          ffl.id,
          TO_CHAR(ffl.feed_date,'YYYY-MM-DD') AS entry_date,
          ffl.plant_code,
          COALESCE(f.plant_name, ffl.plant_code)  AS plant_name,
          ffl.flock_no,
          COALESCE(fm.flock_name, ffl.flock_no)   AS flock_name,
          ffl.feed_type,
          ffl.item_id,
          ffl.item_name,
          ffl.uom,
          COALESCE(ffl.qty_issued_male, 0)                                         AS qty_issued_male,
          COALESCE(ffl.qty_issued_female, 0)                                       AS qty_issued_female,
          COALESCE(ffl.qty_issued_male,0) + COALESCE(ffl.qty_issued_female,0)      AS total_qty,
          ffl.stock_in_bags,
          ffl.cum_feed,
          ffl.created_at,
          ffl.updated_at,
          COALESCE(ffl.sap_synced, FALSE) AS sap_synced,
          ffl.sap_synced_at
       FROM flock_feeding_log ffl
       LEFT JOIN farms        f  ON f.plant_code = ffl.plant_code
       LEFT JOIN flock_master fm ON fm.flock_no  = ffl.flock_no
       WHERE (TO_CHAR(ffl.feed_date,'YYYY-MM-DD'), ffl.flock_no) IN (${pairPlaceholders.join(',')})
       ORDER BY TO_CHAR(ffl.feed_date,'YYYY-MM-DD') DESC, ffl.flock_no, ffl.feed_type, ffl.id`,
      pairParams
    );

    // ── Group by (date + flock) → one grid row with 4 type buckets ──────
    const rowMap = new Map();
    result.rows.forEach(row => {
      const key = `${row.entry_date}_${row.flock_no}`;
      if (!rowMap.has(key)) {
        const parent_id = buildDailyFeedParentId(row.plant_code, row.entry_date, row.flock_no);
        rowMap.set(key, {
          parent_id,
          entry_date:     row.entry_date,
          plant_code:     row.plant_code,
          plant_name:     row.plant_name,
          flock_no:       row.flock_no,
          flock_name:     row.flock_name,
          created_at:     row.created_at,
          updated_at:     row.updated_at,
          feed_count:     0,
          water_count:    0,
          medicine_count: 0,
          others_count:   0,
          feed:           [],
          water:          [],
          medicine:       [],
          others:         [],
        });
      }
      const grp  = rowMap.get(key);
      const item = {
        id:                row.id,
        parent_id:        grp.parent_id,
        feed_type:         row.feed_type,
        item_id:           row.item_id,
        item_name:         row.item_name,
        uom:               row.uom,
        qty_issued_male:   row.qty_issued_male,
        qty_issued_female: row.qty_issued_female,
        total_qty:         row.total_qty,
        stock_in_bags:     row.stock_in_bags,
        cum_feed:          row.cum_feed,
        sap_synced:        row.sap_synced,
        sap_synced_at:     row.sap_synced_at,
      };
      const type = row.feed_type;
      if (grp[type] !== undefined) {
        grp[type].push(item);
        grp[`${type}_count`]++;
      }
    });

    // sno + parent_id + SAP rollups (SAP POST /api/sap-sync still uses each child `id` as record_id)
    const data = Array.from(rowMap.values()).map((row, i) => {
      let sap_line_synced = 0;
      let sap_line_pending = 0;
      const child_line_ids = [];
      for (const b of ['feed', 'water', 'medicine', 'others']) {
        for (const it of row[b] || []) {
          child_line_ids.push(it.id);
          if (it.sap_synced) sap_line_synced += 1;
          else sap_line_pending += 1;
        }
      }
      child_line_ids.sort((a, b) => a - b);
      const totalLines = sap_line_synced + sap_line_pending;
      let sap_sync_status = 'none';
      if (totalLines > 0) {
        if (sap_line_pending === 0) sap_sync_status = 'synced';
        else if (sap_line_synced === 0) sap_sync_status = 'pending';
        else sap_sync_status = 'partial';
      }
      const sap_fully_synced = totalLines > 0 && sap_line_pending === 0;
      return {
        sno: i + 1,
        parent_id: row.parent_id,
        child_line_ids,
        sap_line_synced_count: sap_line_synced,
        sap_line_pending_count: sap_line_pending,
        sap_sync_status,
        sap_fully_synced,
        ...row,
      };
    });

    return res.json({ success: true, total, data });
  } catch (err) {
    console.error('[getDailyFeedGrid]', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ────────────────────────────────────────────────────────────────────────
// 2. DAILY FEED DETAIL  GET /api/admin/grid/daily-feed/detail
//    ?flock_no=LY000001&date=2026-04-10&feed_type=feed
//    Used by view (eye) icon — returns all items for that flock+date+type
// ────────────────────────────────────────────────────────────────────────
exports.getDailyFeedDetail = async (req, res) => {
  try {
    const { flock_no, date, feed_type = 'feed' } = req.query;
    if (!flock_no || !date)
      return res.status(400).json({ success: false, message: 'flock_no and date are required' });

    const result = await pool.query(
      `SELECT
          ffl.*,
          COALESCE(f.plant_name, ffl.plant_code)  AS plant_name,
          COALESCE(fm.flock_name, ffl.flock_no)   AS flock_name
       FROM flock_feeding_log ffl
       LEFT JOIN farms        f  ON f.plant_code  = ffl.plant_code
       LEFT JOIN flock_master fm ON fm.flock_no   = ffl.flock_no
       WHERE ffl.flock_no = $1 AND ffl.feed_date = $2 AND ffl.feed_type = $3
       ORDER BY ffl.id`,
      [flock_no, date, feed_type]
    );

    let bird_weight = null;
    if (feed_type === 'feed') {
      const bw = await pool.query(
        `SELECT male_weight, female_weight FROM flock_bird_weight
         WHERE flock_no = $1 AND weight_date = $2 LIMIT 1`,
        [flock_no, date]
      );
      bird_weight = bw.rows[0] || null;
    }

    return res.json({ success: true, flock_no, date, feed_type, bird_weight, data: result.rows });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ────────────────────────────────────────────────────────────────────────
// 3. DELETE FEED ROW  DELETE /api/admin/grid/daily-feed/:id
// ────────────────────────────────────────────────────────────────────────
exports.deleteFeedEntry = async (req, res) => {
  try {
    await pool.query(`DELETE FROM flock_feeding_log WHERE id = $1`, [req.params.id]);
    return res.json({ success: true, message: 'Feed entry deleted' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// DELETE /api/admin/grid/daily-feed/date?flock_no=LY000011&date=2026-04-25&plant_code=1902
// Deletes ALL feed/water/medicine/others entries for a flock on a date
exports.deleteFeedByDate = async (req, res) => {
  const { flock_no, date, plant_code } = req.query;
  if (!flock_no || !date) {
    return res.status(422).json({ success: false, message: 'flock_no and date required' });
  }
  try {
    const conds = ['flock_no=$1', 'feed_date=$2'];
    const vals  = [flock_no, date];
    if (plant_code) { conds.push(`plant_code=$3`); vals.push(plant_code); }

    const check = await pool.query(
      `SELECT COUNT(*) FROM flock_feeding_log WHERE ${conds.join(' AND ')}`, vals
    );
    const count = parseInt(check.rows[0].count);
    if (count === 0) {
      return res.status(404).json({ success: false, message: 'No feed entries found for that date' });
    }
    // SAP sync guard
    const syncCheck = await pool.query(
      `SELECT COUNT(*) FROM flock_feeding_log WHERE ${conds.join(' AND ')} AND sap_synced=TRUE`, vals
    );
    if (parseInt(syncCheck.rows[0].count) > 0) {
      return res.status(403).json({ success:false, message:'Cannot delete — one or more records are SAP Synced', sap_synced:true });
    }

    await pool.query(
      `DELETE FROM flock_feeding_log WHERE ${conds.join(' AND ')}`, vals
    );
    return res.json({
      success: true,
      message: `Deleted all ${count} feed entries for ${flock_no} on ${date}`,
      deleted_count: count
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ════════════════════════════════════════════════════════════════════════
// MORTALITY GRID helpers
// ════════════════════════════════════════════════════════════════════════
async function mortalityGridQuery(table, req, res) {
  try {
    const {
      search, from_date, to_date, plant_code, flock_no,
    } = req.query;

    const t = table; // 'mortality_log' or 'cull_kill_log'
    const conds = [];
    const vals  = [];
    let   idx   = 1;

    if (search) {
      conds.push(`(m.flock_no ILIKE $${idx} OR COALESCE(f.plant_name, m.plant_code) ILIKE $${idx})`);
      vals.push(`%${search}%`); idx++;
    }
    if (from_date) { conds.push(`m.entry_date >= $${idx}`); vals.push(from_date); idx++; }
    if (to_date)   { conds.push(`m.entry_date <= $${idx}`); vals.push(to_date);   idx++; }
    if (plant_code){ conds.push(`m.plant_code = $${idx}`);  vals.push(plant_code); idx++; }
    if (flock_no)  { conds.push(`m.flock_no = $${idx}`);    vals.push(flock_no);  idx++; }

    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';

    const countRes = await pool.query(
      `SELECT COUNT(*) FROM ${t} m
       LEFT JOIN farms f ON f.plant_code = m.plant_code
       ${where}`,
      vals
    );
    const total = parseInt(countRes.rows[0].count);

    const result = await pool.query(
      `SELECT
          m.id,
          TO_CHAR(m.entry_date,'YYYY-MM-DD') AS entry_date,
          m.plant_code,
          COALESCE(f.plant_name, m.plant_code)   AS plant_name,
          m.flock_no,
          COALESCE(fm.flock_name, m.flock_no)    AS flock_name,
          m.shed_id,
          COALESCE(sm.shed_no, '')               AS shed_no,
          COALESCE(sm.shed_name, '')             AS shed_name,
          m.part_id,
          COALESCE(spm.part_row_no, '')          AS part_row_no,
          m.line_id,
          COALESCE(slm.line_no, '')              AS line_no,
          m.cum_birds,
          m.total_male,
          m.total_female,
          m.morning_male, m.morning_female, m.morning_qty,
          m.afternoon_male, m.afternoon_female, m.afternoon_qty,
          m.evening_male, m.evening_female, m.evening_qty,
          m.total_qty,
          COALESCE(fda.stage, '') AS stage,
          m.created_at,
          m.updated_at,
          COALESCE(m.sap_synced, FALSE)    AS sap_synced,
          m.sap_synced_at
       FROM ${t} m
       LEFT JOIN farms              f   ON f.plant_code  = m.plant_code
       LEFT JOIN flock_master       fm  ON fm.flock_no   = m.flock_no
       LEFT JOIN shed_master        sm  ON sm.id         = m.shed_id
       LEFT JOIN shed_part_master   spm ON spm.id        = m.part_id
       LEFT JOIN shed_line_master   slm ON slm.id        = m.line_id
       LEFT JOIN flock_daily_activity fda ON fda.flock_no = m.flock_no
                                         AND fda.activity_date = m.entry_date
       ${where}
       ORDER BY m.entry_date DESC, m.id DESC`,
      vals
    );

    const data = result.rows.map((row, i) => ({
      sno: i + 1, ...formatRow(row)
    }));

    return res.json({ success: true, total, data });
  } catch (err) {
    console.error(`[${table}Grid]`, err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
}

// ────────────────────────────────────────────────────────────────────────
// 4. MORTALITY GRID  GET /api/admin/grid/mortality
// ────────────────────────────────────────────────────────────────────────
exports.getMortalityGrid = (req, res) => mortalityGridQuery('mortality_log', req, res);

// ────────────────────────────────────────────────────────────────────────
// 5. MORTALITY DETAIL  GET /api/admin/grid/mortality/:id
// ────────────────────────────────────────────────────────────────────────
exports.getMortalityDetail = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
          m.*,
          COALESCE(f.plant_name, m.plant_code)   AS plant_name,
          COALESCE(fm.flock_name, m.flock_no)    AS flock_name,
          COALESCE(sm.shed_no, '')               AS shed_no,
          COALESCE(sm.shed_name, '')             AS shed_name,
          COALESCE(spm.part_row_no, '')          AS part_row_no,
          COALESCE(slm.line_no, '')              AS line_no,
          COALESCE(fda.stage, '')                AS stage
       FROM mortality_log m
       LEFT JOIN farms              f   ON f.plant_code  = m.plant_code
       LEFT JOIN flock_master       fm  ON fm.flock_no   = m.flock_no
       LEFT JOIN shed_master        sm  ON sm.id         = m.shed_id
       LEFT JOIN shed_part_master   spm ON spm.id        = m.part_id
       LEFT JOIN shed_line_master   slm ON slm.id        = m.line_id
       LEFT JOIN flock_daily_activity fda ON fda.flock_no = m.flock_no
                                         AND fda.activity_date = m.entry_date
       WHERE m.id = $1`,
      [req.params.id]
    );
    if (!result.rows.length)
      return res.status(404).json({ success: false, message: 'Record not found' });

    // Also get reasons
    const reasons = await pool.query(
      `SELECT * FROM mortality_reason_log WHERE mortality_id = $1`, [req.params.id]
    );

    return res.json({ success: true, data: { ...result.rows[0], reasons: reasons.rows } });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ────────────────────────────────────────────────────────────────────────
// 6. DELETE MORTALITY  DELETE /api/admin/grid/mortality/:id
//    Cascades to mortality_reason_log and mortality_photo_log
// ────────────────────────────────────────────────────────────────────────
exports.deleteMortality = async (req, res) => {
  try {
    const chk = await pool.query(`SELECT sap_synced FROM mortality_log WHERE id=$1`, [req.params.id]);
    if (!chk.rowCount) return res.status(404).json({ success:false, message:'Record not found' });
    if (chk.rows[0].sap_synced) return res.status(403).json({ success:false, message:'Cannot delete — record is SAP Synced', sap_synced:true });
    await pool.query(`DELETE FROM mortality_log WHERE id = $1`, [req.params.id]);
    return res.json({ success: true, message: 'Mortality entry deleted' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ────────────────────────────────────────────────────────────────────────
// 7. CULL KILL GRID  GET /api/admin/grid/cull-kill
// ────────────────────────────────────────────────────────────────────────
exports.getCullKillGrid = (req, res) => mortalityGridQuery('cull_kill_log', req, res);

// ────────────────────────────────────────────────────────────────────────
// 8. CULL KILL DETAIL  GET /api/admin/grid/cull-kill/:id
// ────────────────────────────────────────────────────────────────────────
exports.getCullKillDetail = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
          m.*,
          COALESCE(f.plant_name, m.plant_code)   AS plant_name,
          COALESCE(fm.flock_name, m.flock_no)    AS flock_name,
          COALESCE(sm.shed_no, '')               AS shed_no,
          COALESCE(sm.shed_name, '')             AS shed_name,
          COALESCE(spm.part_row_no, '')          AS part_row_no,
          COALESCE(slm.line_no, '')              AS line_no,
          COALESCE(fda.stage, '')                AS stage
       FROM cull_kill_log m
       LEFT JOIN farms              f   ON f.plant_code  = m.plant_code
       LEFT JOIN flock_master       fm  ON fm.flock_no   = m.flock_no
       LEFT JOIN shed_master        sm  ON sm.id         = m.shed_id
       LEFT JOIN shed_part_master   spm ON spm.id        = m.part_id
       LEFT JOIN shed_line_master   slm ON slm.id        = m.line_id
       LEFT JOIN flock_daily_activity fda ON fda.flock_no = m.flock_no
                                         AND fda.activity_date = m.entry_date
       WHERE m.id = $1`,
      [req.params.id]
    );
    if (!result.rows.length)
      return res.status(404).json({ success: false, message: 'Record not found' });

    const reasons = await pool.query(
      `SELECT * FROM cull_kill_reason_log WHERE cull_kill_id = $1`, [req.params.id]
    );

    return res.json({ success: true, data: { ...result.rows[0], reasons: reasons.rows } });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ────────────────────────────────────────────────────────────────────────
// 9. DELETE CULL KILL  DELETE /api/admin/grid/cull-kill/:id
// ────────────────────────────────────────────────────────────────────────
exports.deleteCullKill = async (req, res) => {
  try {
    const chk = await pool.query(`SELECT sap_synced FROM cull_kill_log WHERE id=$1`, [req.params.id]);
    if (!chk.rowCount) return res.status(404).json({ success:false, message:'Record not found' });
    if (chk.rows[0].sap_synced) return res.status(403).json({ success:false, message:'Cannot delete — record is SAP Synced', sap_synced:true });
    await pool.query(`DELETE FROM cull_kill_log WHERE id = $1`, [req.params.id]);
    return res.json({ success: true, message: 'Cull kill entry deleted' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ════════════════════════════════════════════════════════════════════════
// EGG COLLECTION GRID
// GET /api/admin/grid/egg-collection
// Columns: S.No | Date | Plant | Flock | Age | Season | T | J | C | W | HE | Total
// Query params: search, from_date, to_date, plant_code, flock_no (no pagination)
// ════════════════════════════════════════════════════════════════════════
exports.getEggCollectionGrid = async (req, res) => {
  try {
    const { search, from_date, to_date, plant_code, flock_no } = req.query;

    const conds = [], vals = [];
    let idx = 1;
    if (search) {
      conds.push(`(h.flock_no ILIKE $${idx} OR COALESCE(f.plant_name,h.plant_code) ILIKE $${idx})`);
      vals.push(`%${search}%`); idx++;
    }
    if (from_date)  { conds.push(`h.collection_date >= $${idx}`); vals.push(from_date);  idx++; }
    if (to_date)    { conds.push(`h.collection_date <= $${idx}`); vals.push(to_date);    idx++; }
    if (plant_code) { conds.push(`h.plant_code = $${idx}`);       vals.push(plant_code); idx++; }
    if (flock_no)   { conds.push(`h.flock_no = $${idx}`);         vals.push(flock_no);   idx++; }

    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';

    const countRes = await pool.query(
      `SELECT COUNT(*) FROM egg_collection_header h
       LEFT JOIN farms f ON f.plant_code = h.plant_code
       ${where}`, vals
    );
    const total = parseInt(countRes.rows[0].count);

    const result = await pool.query(
      `SELECT
          h.id                                                        AS header_id,
          TO_CHAR(h.collection_date,'YYYY-MM-DD')                    AS collection_date,
          h.flock_no,
          COALESCE(fm.flock_name, h.flock_no)                        AS flock_name,
          h.plant_code,
          COALESCE(f.plant_name, h.plant_code)                       AS plant_name,
          h.age_days,
          h.season,
          ecr.shed_id,
          COALESCE(sm.shed_no,  '')                                   AS shed_no,
          COALESCE(sm.shed_name,'')                                   AS shed_name,
          ecr.part_id,
          COALESCE(spm.part_row_no,'')                                AS part_row_no,
          ecr.line_id,
          COALESCE(slm.line_no, '')                                   AS line_no,
          SUM(ecr.table_egg)        AS table_egg,
          SUM(ecr.jumbo_egg)        AS jumbo_egg,
          SUM(ecr.crack_egg)        AS crack_egg,
          SUM(ecr.waste_reject_egg) AS waste_reject_egg,
          SUM(ecr.hatching_egg)     AS hatching_egg,
          SUM(ecr.total_eggs)       AS total_eggs,
          h.created_at,
          COALESCE(h.sap_synced, FALSE) AS sap_synced,
          h.sap_synced_at
       FROM egg_collection_header h
       LEFT JOIN farms            f   ON f.plant_code  = h.plant_code
       LEFT JOIN flock_master     fm  ON fm.flock_no   = h.flock_no
       LEFT JOIN egg_collection_rows ecr ON ecr.header_id = h.id
       LEFT JOIN shed_master          sm  ON sm.id  = ecr.shed_id
       LEFT JOIN shed_part_master     spm ON spm.id = ecr.part_id
       LEFT JOIN shed_line_master     slm ON slm.id = ecr.line_id
       ${where}
       GROUP BY h.id, h.collection_date, h.flock_no, fm.flock_name,
                h.plant_code, f.plant_name, h.age_days, h.season,
                ecr.shed_id, sm.shed_no, sm.shed_name,
                ecr.part_id, spm.part_row_no,
                ecr.line_id, slm.line_no,
                h.created_at, h.sap_synced, h.sap_synced_at
       ORDER BY h.collection_date DESC, h.id DESC, sm.shed_no, spm.part_row_no, slm.line_no`,
      vals
    );

    const data = result.rows.map((row, i) => ({ sno: i + 1, ...formatRow(row) }));
    return res.json({ success:true, total, data });
  } catch (err) {
    console.error('[getEggCollectionGrid]', err.message);
    return res.status(500).json({ success:false, message:err.message });
  }
};

// ────────────────────────────────────────────────────────────────────────
// EGG COLLECTION DETAIL  GET /api/admin/grid/egg-collection/:id
// Returns full header + all slots + rows + summary (for view popup)
// ────────────────────────────────────────────────────────────────────────
exports.getEggCollectionDetail = async (req, res) => {
  try {
    const { id } = req.params;

    const hRes = await pool.query(
      `SELECT h.*,
              COALESCE(f.plant_name, h.plant_code)  AS plant_name,
              COALESCE(fm.flock_name, h.flock_no)   AS flock_name
       FROM egg_collection_header h
       LEFT JOIN farms        f  ON f.plant_code = h.plant_code
       LEFT JOIN flock_master fm ON fm.flock_no  = h.flock_no
       WHERE h.id = $1`,
      [id]
    );
    if (!hRes.rowCount)
      return res.status(404).json({ success:false, message:'Record not found' });

    const header = hRes.rows[0];

    const slotsRes = await pool.query(
      `SELECT * FROM egg_collection_slots WHERE header_id=$1 ORDER BY id`, [id]
    );

    const slots = [];
    for (const slot of slotsRes.rows) {
      const rowsRes    = { rows: [] };  // egg_collection_rows populated after migrate:db:fix
      const summaryRes = { rows: [{ table_egg: slot.table_egg, jumbo_egg: slot.jumbo_egg, crack_egg: slot.crack_egg, waste_reject_egg: slot.waste_reject_egg, hatching_egg: slot.hatching_egg, total_eggs: slot.total_eggs }] };
      slots.push({ ...slot, rows: rowsRes.rows, summary: summaryRes.rows[0] || null });
    }

    const grandRes = await pool.query(
      `SELECT SUM(table_egg) AS table_egg, SUM(jumbo_egg) AS jumbo_egg, SUM(crack_egg) AS crack_egg, SUM(waste_reject_egg) AS waste_reject_egg, SUM(hatching_egg) AS hatching_egg, SUM(total_eggs) AS total_eggs FROM egg_collection_slots WHERE header_id=$1`, [id]
    );

    return res.json({ success:true, data:{ ...header, slots, grand_summary: grandRes.rows[0]||null } });
  } catch (err) {
    return res.status(500).json({ success:false, message:err.message });
  }
};

// ────────────────────────────────────────────────────────────────────────
// DELETE EGG COLLECTION  DELETE /api/admin/grid/egg-collection/:id
// Cascades to slots → rows → summary
// ────────────────────────────────────────────────────────────────────────
exports.deleteEggCollection = async (req, res) => {
  try {
    const chk = await pool.query(`SELECT sap_synced FROM egg_collection_header WHERE id=$1`, [req.params.id]);
    if (!chk.rowCount) return res.status(404).json({ success:false, message:'Record not found' });
    if (chk.rows[0].sap_synced) return res.status(403).json({ success:false, message:'Cannot delete — record is SAP Synced', sap_synced:true });
    await pool.query(`DELETE FROM egg_collection_header WHERE id=$1`, [req.params.id]);
    return res.json({ success:true, message:'Egg collection entry deleted' });
  } catch (err) {
    return res.status(500).json({ success:false, message:err.message });
  }
};
