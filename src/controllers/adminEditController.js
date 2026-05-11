const { parseDate, todayDate, formatRow } = require('../utils/dateUtils');
// ══════════════════════════════════════════════════════════════════════════
// adminEditController.js
// Admin panel — GET (pre-fill) + PUT (save) for edit actions
//
// FEED/WATER/MEDICINE/OTHERS edit:
//   Reads flock_feeding_log for all items flock+date+type → admin edits → rewrites rows
//
// MORTALITY edit:
//   Reads mortality_log + mortality_reason_log → admin edits → updates
//   Fields: shed_id, part_id, line_id, schedule (morning/afternoon/evening),
//           reasons (reason_id, male_count, female_count, remarks)
//
// CULL KILL edit: same as mortality but cull_kill_log + cull_kill_reason_log
// ══════════════════════════════════════════════════════════════════════════
const pool = require('../config/db');

// ── SAP sync guard ────────────────────────────────────────────────────────
async function checkSapSynced(pool, table, id) {
  const r = await pool.query(`SELECT sap_synced FROM ${table} WHERE id=$1`, [id]);
  if (!r.rowCount) return { notFound: true };
  return { synced: r.rows[0].sap_synced };
}


// ────────────────────────────────────────────────────────────────────────
// DROPDOWNS  GET /api/admin/grid/dropdowns
//   Returns all lookup data needed for edit forms in one call
// ────────────────────────────────────────────────────────────────────────
exports.getDropdowns = async (req, res) => {
  try {
    const [plants, flocks, sheds, feedItems, waterItems, medItems, otherItems,
           mortalityReasons, cullReasons] = await Promise.all([
      pool.query(`SELECT plant_code, plant_name FROM farms ORDER BY plant_name`),
      pool.query(`SELECT flock_no, flock_name FROM flock_master WHERE status='A' ORDER BY flock_no`),
      pool.query(`SELECT id, plant_code, shed_no, shed_name FROM shed_master WHERE is_active=TRUE ORDER BY plant_code, shed_no`),
      pool.query(`SELECT id, mat_id AS item_code, item_name, uom FROM feed_master WHERE is_active=TRUE ORDER BY item_name`),
      pool.query(`SELECT id, item_name, uom FROM water_master WHERE is_active=TRUE ORDER BY item_name`),
      pool.query(`SELECT id, item_name, uom FROM medicine_master WHERE is_active=TRUE ORDER BY item_name`),
      pool.query(`SELECT id, item_name, uom FROM others_master WHERE is_active=TRUE ORDER BY item_name`),
      pool.query(`SELECT id, reason_name FROM mortality_reason_master WHERE is_active=TRUE ORDER BY reason_name`),
      pool.query(`SELECT id, reason_name FROM cull_kill_reason_master WHERE is_active=TRUE ORDER BY reason_name`),
    ]);
    return res.json({
      success: true,
      data: {
        plants:           plants.rows,
        flocks:           flocks.rows,
        sheds:            sheds.rows,
        feed_items:       feedItems.rows,
        water_items:      waterItems.rows,
        medicine_items:   medItems.rows,
        other_items:      otherItems.rows,
        mortality_reasons: mortalityReasons.rows,
        cull_reasons:      cullReasons.rows,
      }
    });
  } catch (err) {
    console.error('[getDropdowns]', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ────────────────────────────────────────────────────────────────────────
// GET SHED PARTS  GET /api/admin/grid/sheds/:shed_id/parts
// GET SHED LINES  GET /api/admin/grid/parts/:part_id/lines
//   Cascading dropdowns in edit form for shed → part → line
// ────────────────────────────────────────────────────────────────────────
exports.getShedParts = async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, part_row_no, cum_birds FROM shed_part_master WHERE shed_id=$1 AND is_active=TRUE ORDER BY part_row_no`,
      [req.params.shed_id]
    );
    return res.json({ success: true, data: r.rows });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.getPartLines = async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, line_no, male_birds, female_birds, total_birds FROM shed_line_master WHERE part_id=$1 AND is_active=TRUE ORDER BY line_no`,
      [req.params.part_id]
    );
    return res.json({ success: true, data: r.rows });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ════════════════════════════════════════════════════════════════════════
// FEED / WATER / MEDICINE / OTHERS — EDIT
// ════════════════════════════════════════════════════════════════════════

// GET /api/admin/grid/edit/feeding/:flock_no?date=YYYY-MM-DD&feed_type=feed
// Pre-populate edit form — returns same shape as mobile GET /api/daily-activity/feeding/:flock_no
// Response matches mobile: { flock_no, date, feed_type, bird_weight, data: { feed:[], water:[], medicine:[], others:[] } }
// Also returns flat items[] for the requested feed_type for easy form binding
exports.getFeedingForEdit = async (req, res) => {
  try {
    const { flock_no } = req.params;
    const { date, feed_type } = req.query;  // feed_type optional — if blank returns all types

    if (!flock_no || !date)
      return res.status(400).json({ success: false, message: 'flock_no and date required' });

    // Build query — same columns as mobile getFeedingData
    let q = `
      SELECT ffl.*, TO_CHAR(ffl.feed_date,'YYYY-MM-DD') AS feed_date,
             sm.stock_qty, sm.cum_qty,
             COALESCE(f.plant_name, ffl.plant_code) AS plant_name,
             COALESCE(fm.flock_name, ffl.flock_no)  AS flock_name
      FROM flock_feeding_log ffl
      LEFT JOIN stock_master sm
        ON sm.plant_code = ffl.plant_code
        AND sm.item_type = ffl.feed_type
        AND sm.item_id   = ffl.item_id
      LEFT JOIN farms        f  ON f.plant_code = ffl.plant_code
      LEFT JOIN flock_master fm ON fm.flock_no  = ffl.flock_no
      WHERE ffl.flock_no=$1 AND ffl.feed_date=$2
    `;
    const params = [flock_no, date];
    if (feed_type) { q += ` AND ffl.feed_type=$3`; params.push(feed_type); }
    q += ` ORDER BY ffl.feed_type, ffl.item_id`;

    const feedRes = await pool.query(q, params);

    // Bird weight — same as mobile
    const weightRes = await pool.query(
      `SELECT male_weight, female_weight FROM flock_bird_weight
       WHERE flock_no=$1 AND weight_date=$2 LIMIT 1`,
      [flock_no, date]
    );

    // Group by feed_type — exactly like mobile getFeedingData
    const grouped = { feed: [], water: [], medicine: [], others: [] };
    for (const row of feedRes.rows) {
      if (grouped[row.feed_type]) grouped[row.feed_type].push(formatRow(row));
    }

    return res.json({
      success:     true,
      flock_no,
      date,                                                          // same as mobile
      feed_type:   feed_type || 'all',
      bird_weight: weightRes.rows[0] || { male_weight: null, female_weight: null },
      data:        grouped,                                          // same key as mobile
      // flat items for the requested type (for single-type edit forms)
      items: feed_type ? grouped[feed_type] || [] : feedRes.rows,
    });
  } catch (err) {
    console.error('[getFeedingForEdit]', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/admin/grid/edit/feeding/:flock_no
// Save edited feeding — same body shape as mobile POST /api/daily-activity/feeding/save
// Accepts both feed_date (mobile name) and date (admin convenience) — they are the same field
// Body: { plant_code, feed_date (or date), feed_type,
//         items:[{item_id, item_name, uom, qty_issued_male, qty_issued_female, stock_in_bags, cum_feed}],
//         male_weight, female_weight }
exports.updateFeeding = async (req, res) => {
  const client = await pool.connect();
  try {
    const { flock_no } = req.params;
    // SAP sync guard — check if any record for this flock is synced
    const sapCheck = await pool.query(
      `SELECT COUNT(*) FROM flock_feeding_log WHERE flock_no=$1 AND sap_synced=TRUE`, [flock_no]
    );
    if (parseInt(sapCheck.rows[0].count) > 0) {
      client.release();
      return res.status(403).json({ success:false, message:'Cannot edit — record is SAP Synced', sap_synced:true });
    }
    const {
      feed_date, date,           // accept both — mobile uses feed_date, admin may send date
      feed_type, plant_code,
      items = [],
      male_weight, female_weight,
    } = req.body;

    const resolvedDate = feed_date || date;  // support both field names
    if (!resolvedDate)
      return res.status(400).json({ success: false, message: 'feed_date required' });
    if (!feed_type)
      return res.status(400).json({ success: false, message: 'feed_type required' });

    await client.query('BEGIN');

    // Delete old rows for this flock + date + type
    await client.query(
      `DELETE FROM flock_feeding_log WHERE flock_no=$1 AND feed_date=$2 AND feed_type=$3`,
      [flock_no, resolvedDate, feed_type]
    );

    // Re-insert updated items — same INSERT logic as mobile saveFeedingData
    for (const item of items) {
      if (!item.item_id) continue;
      await client.query(
        `INSERT INTO flock_feeding_log
           (flock_no, plant_code, feed_date, feed_type, item_id, item_name, uom,
            qty_issued_male, qty_issued_female, stock_in_bags, cum_feed, entered_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (flock_no, feed_date, feed_type, item_id)
         DO UPDATE SET
           item_name         = EXCLUDED.item_name,
           uom               = EXCLUDED.uom,
           qty_issued_male   = EXCLUDED.qty_issued_male,
           qty_issued_female = EXCLUDED.qty_issued_female,
           stock_in_bags     = EXCLUDED.stock_in_bags,
           cum_feed          = EXCLUDED.cum_feed,
           updated_at        = NOW()`,
        [
          flock_no, plant_code || null, resolvedDate, feed_type,
          item.item_id, item.item_name || null, item.uom || null,
          item.qty_issued_male   || 0,
          item.qty_issued_female || 0,
          item.stock_in_bags     || 0,
          item.cum_feed          || 0,
          null,
        ]
      );
    }

    // Update bird weight — same as mobile (feed type only)
    if (feed_type === 'feed' && (male_weight != null || female_weight != null)) {
      await client.query(
        `INSERT INTO flock_bird_weight (flock_no, plant_code, weight_date, male_weight, female_weight, updated_at)
         VALUES ($1,$2,$3,$4,$5,NOW())
         ON CONFLICT (flock_no, weight_date)
         DO UPDATE SET male_weight=$4, female_weight=$5, updated_at=NOW()`,
        [flock_no, plant_code || null, resolvedDate, male_weight || null, female_weight || null]
      );
    }

    await client.query('COMMIT');
    return res.json({ success: true, message: `${feed_type} entry updated successfully` });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[updateFeeding]', err.message);
    return res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
};

// ════════════════════════════════════════════════════════════════════════
// MORTALITY — EDIT
// ════════════════════════════════════════════════════════════════════════

// GET /api/admin/grid/edit/mortality/:id
// Pre-populate mortality edit form
// Returns: all mortality_log fields + reason rows + shed/part/line names
exports.getMortalityForEdit = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
          m.*,
          TO_CHAR(m.entry_date,'YYYY-MM-DD')     AS entry_date,
          COALESCE(f.plant_name, m.plant_code)   AS plant_name,
          COALESCE(fm.flock_name, m.flock_no)    AS flock_name,
          COALESCE(sm.shed_no, '')               AS shed_no,
          COALESCE(sm.shed_name, '')             AS shed_name,
          COALESCE(spm.part_row_no, '')          AS part_row_no,
          COALESCE(slm.line_no, '')              AS line_no,
          COALESCE(slm.male_birds, 0)            AS line_male_birds,
          COALESCE(slm.female_birds, 0)          AS line_female_birds,
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
      return res.status(404).json({ success: false, message: 'Mortality record not found' });

    const reasons = await pool.query(
      `SELECT mrl.*, mrm.reason_name AS master_reason_name
       FROM mortality_reason_log mrl
       LEFT JOIN mortality_reason_master mrm ON mrm.id = mrl.reason_id
       WHERE mrl.mortality_id = $1`,
      [req.params.id]
    );

    return res.json({ success: true, data: { ...formatRow(result.rows[0]), reasons: reasons.rows } });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/admin/grid/edit/mortality/:id
// Save edited mortality
// Body: {
//   entry_date, plant_code, flock_no, shed_id, part_id, line_id, cum_birds,
//   total_male, total_female,
//   schedule: [{ slot: "morning", male: 2, female: 1 }, { slot: "afternoon", ... }, { slot: "evening", ... }],
//   reasons:  [{ reason_id: 1, reason_name: "Disease", male_count: 2, female_count: 1, remarks: "" }]
// }
exports.updateMortality = async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const sapCheck = await checkSapSynced(pool, 'mortality_log', id);
    if (sapCheck.notFound) { client.release(); return res.status(404).json({ success:false, message:'Record not found' }); }
    if (sapCheck.synced)   { client.release(); return res.status(403).json({ success:false, message:'Cannot edit — record is SAP Synced', sap_synced:true }); }
    const {
      entry_date, plant_code, flock_no,
      shed_id, part_id, line_id,
      cum_birds = 0,
      total_male = 0, total_female = 0,
      schedule = [],
      reasons  = [],
    } = req.body;

    const g = (slot) => schedule.find(s => s.slot === slot) || {};
    const mm = +(g('morning').male   || 0), mf = +(g('morning').female   || 0);
    const am = +(g('afternoon').male || 0), af = +(g('afternoon').female || 0);
    const em = +(g('evening').male   || 0), ef = +(g('evening').female   || 0);
    const tmc = mm + am + em;
    const tfc = mf + af + ef;
    const tq  = tmc + tfc;

    await client.query('BEGIN');

    await client.query(
      `UPDATE mortality_log SET
          entry_date       = COALESCE($1, entry_date),
          plant_code       = COALESCE($2, plant_code),
          flock_no         = COALESCE($3, flock_no),
          shed_id          = $4,
          part_id          = $5,
          line_id          = $6,
          cum_birds        = $7,
          total_male       = $8,
          total_female     = $9,
          morning_male     = $10, morning_female   = $11, morning_qty   = $12,
          afternoon_male   = $13, afternoon_female = $14, afternoon_qty = $15,
          evening_male     = $16, evening_female   = $17, evening_qty   = $18,
          total_qty        = $19,
          updated_at       = NOW()
       WHERE id = $20`,
      [
        entry_date || null, plant_code || null, flock_no || null,
        shed_id || null, part_id || null, line_id || null,
        cum_birds,
        total_male || tmc, total_female || tfc,
        mm, mf, mm+mf,
        am, af, am+af,
        em, ef, em+ef,
        tq,
        id
      ]
    );

    // Replace reasons
    await client.query(`DELETE FROM mortality_reason_log WHERE mortality_id = $1`, [id]);
    for (const r of reasons) {
      const male   = +(r.male_count   || r.male   || 0);
      const female = +(r.female_count || r.female || 0);
      await client.query(
        `INSERT INTO mortality_reason_log (mortality_id, reason_id, reason_name, male_count, female_count, total_count, remarks)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [id, r.reason_id || null, r.reason_name || null, male, female, male+female, r.remarks || null]
      );
    }

    await client.query('COMMIT');
    return res.json({ success: true, message: 'Mortality entry updated successfully' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[updateMortality]', err.message);
    return res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
};

// ════════════════════════════════════════════════════════════════════════
// CULL KILL — EDIT  (identical structure to mortality)
// ════════════════════════════════════════════════════════════════════════

// GET /api/admin/grid/edit/cull-kill/:id
exports.getCullKillForEdit = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
          m.*,
          TO_CHAR(m.entry_date,'YYYY-MM-DD')     AS entry_date,
          COALESCE(f.plant_name, m.plant_code)   AS plant_name,
          COALESCE(fm.flock_name, m.flock_no)    AS flock_name,
          COALESCE(sm.shed_no, '')               AS shed_no,
          COALESCE(sm.shed_name, '')             AS shed_name,
          COALESCE(spm.part_row_no, '')          AS part_row_no,
          COALESCE(slm.line_no, '')              AS line_no,
          COALESCE(slm.male_birds, 0)            AS line_male_birds,
          COALESCE(slm.female_birds, 0)          AS line_female_birds,
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
      return res.status(404).json({ success: false, message: 'Cull kill record not found' });

    const reasons = await pool.query(
      `SELECT ckrl.*, ckrm.reason_name AS master_reason_name
       FROM cull_kill_reason_log ckrl
       LEFT JOIN cull_kill_reason_master ckrm ON ckrm.id = ckrl.reason_id
       WHERE ckrl.cull_kill_id = $1`,
      [req.params.id]
    );

    return res.json({ success: true, data: { ...formatRow(result.rows[0]), reasons: reasons.rows } });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/admin/grid/edit/cull-kill/:id
// Body: same shape as mortality — { entry_date, plant_code, flock_no, shed_id, part_id, line_id,
//         cum_birds, total_male, total_female, schedule:[...], reasons:[...] }
exports.updateCullKill = async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const sapCheck = await checkSapSynced(pool, 'cull_kill_log', id);
    if (sapCheck.notFound) { client.release(); return res.status(404).json({ success:false, message:'Record not found' }); }
    if (sapCheck.synced)   { client.release(); return res.status(403).json({ success:false, message:'Cannot edit — record is SAP Synced', sap_synced:true }); }
    const {
      entry_date, plant_code, flock_no,
      shed_id, part_id, line_id,
      cum_birds = 0,
      total_male = 0, total_female = 0,
      schedule = [],
      reasons  = [],
    } = req.body;

    const g = (slot) => schedule.find(s => s.slot === slot) || {};
    const mm = +(g('morning').male   || 0), mf = +(g('morning').female   || 0);
    const am = +(g('afternoon').male || 0), af = +(g('afternoon').female || 0);
    const em = +(g('evening').male   || 0), ef = +(g('evening').female   || 0);
    const tmc = mm + am + em;
    const tfc = mf + af + ef;
    const tq  = tmc + tfc;

    await client.query('BEGIN');

    await client.query(
      `UPDATE cull_kill_log SET
          entry_date       = COALESCE($1, entry_date),
          plant_code       = COALESCE($2, plant_code),
          flock_no         = COALESCE($3, flock_no),
          shed_id          = $4,
          part_id          = $5,
          line_id          = $6,
          cum_birds        = $7,
          total_male       = $8,
          total_female     = $9,
          morning_male     = $10, morning_female   = $11, morning_qty   = $12,
          afternoon_male   = $13, afternoon_female = $14, afternoon_qty = $15,
          evening_male     = $16, evening_female   = $17, evening_qty   = $18,
          total_qty        = $19,
          updated_at       = NOW()
       WHERE id = $20`,
      [
        entry_date || null, plant_code || null, flock_no || null,
        shed_id || null, part_id || null, line_id || null,
        cum_birds,
        total_male || tmc, total_female || tfc,
        mm, mf, mm+mf,
        am, af, am+af,
        em, ef, em+ef,
        tq,
        id
      ]
    );

    // Replace reasons
    await client.query(`DELETE FROM cull_kill_reason_log WHERE cull_kill_id = $1`, [id]);
    for (const r of reasons) {
      const male   = +(r.male_count   || r.male   || 0);
      const female = +(r.female_count || r.female || 0);
      await client.query(
        `INSERT INTO cull_kill_reason_log (cull_kill_id, reason_id, reason_name, male_count, female_count, total_count, remarks)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [id, r.reason_id || null, r.reason_name || null, male, female, male+female, r.remarks || null]
      );
    }

    await client.query('COMMIT');
    return res.json({ success: true, message: 'Cull kill entry updated successfully' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[updateCullKill]', err.message);
    return res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
};

// ════════════════════════════════════════════════════════════════════════
// EGG COLLECTION — EDIT
// ════════════════════════════════════════════════════════════════════════

// GET /api/admin/grid/edit/egg-collection/:id
// Pre-fill edit form — returns same shape as POST /api/egg-collection/v2/save
// Response: { ...header, flock_name, plant_name, slots:[{...slot, rows:[...], summary}], grand_summary }
exports.getEggCollectionForEdit = async (req, res) => {
  try {
    const { id } = req.params;

    const hRes = await pool.query(
      `SELECT h.*,
              TO_CHAR(h.collection_date,'YYYY-MM-DD') AS collection_date,
              COALESCE(f.plant_name, h.plant_code)  AS plant_name,
              COALESCE(fm.flock_name, h.flock_no)   AS flock_name
       FROM egg_collection_header h
       LEFT JOIN farms        f  ON f.plant_code = h.plant_code
       LEFT JOIN flock_master fm ON fm.flock_no  = h.flock_no
       WHERE h.id = $1`,
      [id]
    );
    if (!hRes.rowCount)
      return res.status(404).json({ success:false, message:'Egg collection record not found' });

    const header = hRes.rows[0];

    const slotsRes = await pool.query(
      `SELECT * FROM egg_collection_slots WHERE header_id=$1 ORDER BY id`, [id]
    );

    const slots = [];
    for (const slot of slotsRes.rows) {
      // egg_collection_rows populated after migrate:db:fix — safe fallback to empty
      let rowsRes = { rows: [] };
      try {
        const rr = await pool.query(
          `SELECT ecr.*, sm.shed_no AS shed_label, spm.part_row_no, slm.line_no
           FROM egg_collection_rows ecr
           LEFT JOIN shed_master sm ON sm.id=ecr.shed_id
           LEFT JOIN shed_part_master spm ON spm.id=ecr.part_id
           LEFT JOIN shed_line_master slm ON slm.id=ecr.line_id
           WHERE ecr.slot_id=$1 ORDER BY ecr.sno`, [slot.id]);
        rowsRes = rr;
      } catch(e) { /* table not yet created */ }
      const summaryRes = await pool.query(
        `SELECT table_egg, jumbo_egg, crack_egg, waste_reject_egg, hatching_egg, total_eggs FROM egg_collection_slots WHERE id=$1`, [slot.id]
      );
      slots.push({ ...slot, rows: rowsRes.rows, summary: summaryRes.rows[0]||null });
    }

    const grandRes = await pool.query(
      `SELECT SUM(table_egg) AS table_egg, SUM(jumbo_egg) AS jumbo_egg, SUM(crack_egg) AS crack_egg, SUM(waste_reject_egg) AS waste_reject_egg, SUM(hatching_egg) AS hatching_egg, SUM(total_eggs) AS total_eggs FROM egg_collection_slots WHERE header_id=$1`, [id]
    );

    return res.json({
      success: true,
      data: { ...formatRow(header), slots, grand_summary: grandRes.rows[0]||null }
    });
  } catch (err) {
    console.error('[getEggCollectionForEdit]', err.message);
    return res.status(500).json({ success:false, message:err.message });
  }
};

// PUT /api/admin/grid/edit/egg-collection/:id
// Save edited egg collection — delegates to saveCollection logic
// Body: same shape as POST /api/egg-collection/v2/save
//   { flock_no, plant_code, collection_date, age_days, season,
//     slots:[{ schedule_time, egg_weight_time, egg_weight,
//              rows:[{ shed_id, part_id, line_id, table_egg, jumbo_egg, crack_egg, waste_reject_egg, hatching_egg }] }] }
exports.updateEggCollection = async (req, res) => {
  const pool = require('../config/db');
  const { parseDate } = require('../utils/dateUtils');
  const client = await pool.connect();
  try {
    const headerId = parseInt(req.params.id);
    const { age_days, season, slots = [] } = req.body;
    // SAP sync guard
    const sapCheck = await checkSapSynced(pool, 'egg_collection_header', headerId);
    if (sapCheck.notFound) { client.release(); return res.status(404).json({ success:false, message:'Record not found' }); }
    if (sapCheck.synced)   { client.release(); return res.status(403).json({ success:false, message:'Cannot edit — record is SAP Synced', sap_synced:true }); }
    // Check record exists
    const check = await client.query(`SELECT id FROM egg_collection_header WHERE id=$1`, [headerId]);
    if (!check.rowCount) return res.status(404).json({ success:false, message:'Record not found' });

    await client.query('BEGIN');

    // Update header
    await client.query(
      `UPDATE egg_collection_header SET age_days=$1, season=$2, updated_at=NOW() WHERE id=$3`,
      [age_days||null, season||null, headerId]
    );

    for (const slot of slots) {
      const { schedule_time, egg_weight_time=null, egg_weight=null, rows=[] } = slot;
      if (!schedule_time) continue;

      // Aggregate totals from rows
      const totals = { table_egg:0, jumbo_egg:0, crack_egg:0, waste_reject_egg:0, hatching_egg:0 };
      for (const row of rows) {
        totals.table_egg        += parseInt(row.table_egg)||0;
        totals.jumbo_egg        += parseInt(row.jumbo_egg)||0;
        totals.crack_egg        += parseInt(row.crack_egg)||0;
        totals.waste_reject_egg += parseInt(row.waste_reject_egg)||0;
        totals.hatching_egg     += parseInt(row.hatching_egg)||0;
      }

      // Upsert slot
      const sRes = await client.query(
        `INSERT INTO egg_collection_slots
           (header_id, schedule_time, egg_weight_time, egg_weight,
            table_egg, jumbo_egg, crack_egg, waste_reject_egg, hatching_egg)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (header_id, schedule_time)
         DO UPDATE SET
           egg_weight_time=$3, egg_weight=$4,
           table_egg=$5, jumbo_egg=$6, crack_egg=$7, waste_reject_egg=$8, hatching_egg=$9,
           updated_at=NOW()
         RETURNING *`,
        [headerId, schedule_time, egg_weight_time, egg_weight,
         totals.table_egg, totals.jumbo_egg, totals.crack_egg, totals.waste_reject_egg, totals.hatching_egg]
      );
      const slotId = sRes.rows[0].id;

      // Upsert rows
      for (let i=0; i<rows.length; i++) {
        const row = rows[i];
        const { shed_id, part_id, line_id } = row;
        if (!shed_id || !part_id || !line_id) continue;
        const t=parseInt(row.table_egg)||0, j=parseInt(row.jumbo_egg)||0,
              cr=parseInt(row.crack_egg)||0, w=parseInt(row.waste_reject_egg)||0, he=parseInt(row.hatching_egg)||0;
        const shedInfo = await client.query(`SELECT shed_no FROM shed_master WHERE id=$1`, [shed_id]);
        const partInfo = await client.query(`SELECT part_row_no FROM shed_part_master WHERE id=$1`, [part_id]);
        const lineInfo = await client.query(`SELECT line_no FROM shed_line_master WHERE id=$1`, [line_id]);
        await client.query(
          `INSERT INTO egg_collection_rows
             (slot_id, header_id, sno, shed_id, shed_no, part_id, part_row_no, line_id, line_no,
              table_egg, jumbo_egg, crack_egg, waste_reject_egg, hatching_egg)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
           ON CONFLICT (slot_id, shed_id, part_id, line_id)
           DO UPDATE SET sno=$3, shed_no=$5, part_row_no=$7, line_no=$9,
             table_egg=$10, jumbo_egg=$11, crack_egg=$12, waste_reject_egg=$13, hatching_egg=$14,
             updated_at=NOW()`,
          [slotId, headerId, i+1,
           shed_id, shedInfo.rows[0]?.shed_no||'',
           part_id, partInfo.rows[0]?.part_row_no||'',
           line_id, lineInfo.rows[0]?.line_no||'',
           t, j, cr, w, he]
        );
      }
    }

    await client.query('COMMIT');
    return res.json({ success:true, message:`Egg collection id=${headerId} updated` });
  } catch(err) {
    await client.query('ROLLBACK');
    console.error('[updateEggCollection]', err.message);
    return res.status(500).json({ success:false, message:err.message });
  } finally { client.release(); }
};
