const { parseDate, todayDate, formatRow } = require('../utils/dateUtils');
const pool   = require('../config/db');
const upload = require('../middleware/upload');
const path   = require('path');

// ═══════════════════════════════════════════════════════════════════════════
// DROPDOWN CHAIN: Plant → Shed → Part/Row → Line → Auto-fill birds
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/mortality-cull/flocks?plant_code=1902
// Step between plant and shed — returns flocks for plant
exports.getFlocks = async (req, res) => {
  const { plant_code } = req.query;
  if (!plant_code) return res.status(422).json({ success:false, message:'plant_code required' });
  try {
    const result = await pool.query(`
      SELECT flock_no, flock_name, farm_code,
        (CURRENT_DATE - hatchery_date::date) AS age_days,
        CASE
          WHEN (CURRENT_DATE - hatchery_date::date) <= 42  THEN 'Brooming'
          WHEN (CURRENT_DATE - hatchery_date::date) <= 126 THEN 'Grooming'
          ELSE 'Laying'
        END AS stage
      FROM flock_master
      WHERE farm_code=$1 AND status='A' AND deletion_flag!='X'
      ORDER BY flock_no
    `, [plant_code]);
    return res.json({
      success: true,
      data: result.rows.map(r => ({
        flock_no:   r.flock_no,
        flock_name: r.flock_name || r.flock_no,
        stage:      r.stage,
        age_days:   parseInt(r.age_days)||0,
        label:      `${r.flock_no} — ${r.flock_name||r.flock_no}`,
      }))
    });
  } catch(err) { return res.status(500).json({ success:false, message:err.message }); }
};

// GET /api/mortality-cull/sheds?plant_code=1902
exports.getSheds = async (req, res) => {
  const { plant_code } = req.query;
  if (!plant_code) return res.status(422).json({ success:false, message:'plant_code required' });
  try {
    const result = await pool.query(
      `SELECT id, shed_no, shed_name FROM shed_master WHERE plant_code=$1 AND is_active=TRUE ORDER BY shed_no`,
      [plant_code]
    );
    return res.json({ success:true, data: result.rows.map(r => ({
      id: r.id, shed_no: r.shed_no, shed_name: r.shed_name,
      label: `${r.shed_no} — ${r.shed_name||r.shed_no}`
    }))});
  } catch(err) { return res.status(500).json({ success:false, message:err.message }); }
};

// GET /api/mortality/parts?shed_id=1
exports.getParts = async (req, res) => {
  const { shed_id } = req.query;
  if (!shed_id) return res.status(422).json({ success:false, message:'shed_id required' });
  try {
    const result = await pool.query(
      `SELECT id, part_row_no, cum_birds FROM shed_part_master WHERE shed_id=$1 AND is_active=TRUE ORDER BY part_row_no`,
      [shed_id]
    );
    return res.json({ success:true, data: result.rows.map(r => ({
      id: r.id, part_row_no: r.part_row_no, cum_birds: r.cum_birds,
      label: `Part/Row ${r.part_row_no}`
    }))});
  } catch(err) { return res.status(500).json({ success:false, message:err.message }); }
};

// GET /api/mortality/lines?part_id=1
// Returns lines + auto-fills male/female/total birds
exports.getLines = async (req, res) => {
  const { part_id } = req.query;
  if (!part_id) return res.status(422).json({ success:false, message:'part_id required' });
  try {
    // Get part info (cum_birds)
    const partRes = await pool.query(
      `SELECT sp.cum_birds, sm.shed_no FROM shed_part_master sp JOIN shed_master sm ON sm.id=sp.shed_id WHERE sp.id=$1`,
      [part_id]
    );
    const lineRes = await pool.query(
      `SELECT id, line_no, male_birds, female_birds, total_birds FROM shed_line_master WHERE part_id=$1 AND is_active=TRUE ORDER BY line_no`,
      [part_id]
    );
    return res.json({
      success:   true,
      cum_birds: partRes.rows[0]?.cum_birds || 0,
      data: lineRes.rows.map(r => ({
        id:           r.id,
        line_no:      r.line_no,
        male_birds:   r.male_birds,
        female_birds: r.female_birds,
        total_birds:  r.total_birds,
        label:        `Line ${r.line_no} (M:${r.male_birds} F:${r.female_birds})`,
      }))
    });
  } catch(err) { return res.status(500).json({ success:false, message:err.message }); }
};

// ═══════════════════════════════════════════════════════════════════════════
// MASTERS — Reasons + Photo Types
// ═══════════════════════════════════════════════════════════════════════════

// Reasons now from combined table
exports.getMortalityReasons = async (req, res) => {
  const r = await pool.query(`SELECT * FROM mortality_cull_reason_master WHERE is_active=TRUE AND module='Mortality' ORDER BY reason_id`);
  return res.json({ success:true, data:r.rows });
};
exports.getCullKillReasons = async (req, res) => {
  const r = await pool.query(`SELECT * FROM mortality_cull_reason_master WHERE is_active=TRUE AND module='Cull' ORDER BY reason_id`);
  return res.json({ success:true, data:r.rows });
};
exports.addMortalityReason = async (req, res) => {
  const { reason_id, reason_name } = req.body;
  if (!reason_name) return res.status(422).json({ success:false, message:'reason_name required' });
  const r = await pool.query(`INSERT INTO mortality_cull_reason_master (reason_id,reason_name,module,created_by) VALUES ($1,$2,'Mortality',$3) RETURNING *`,[reason_id||null,reason_name,req.user?.username||'admin']);
  return res.status(201).json({ success:true, data:r.rows[0] });
};
exports.updateMortalityReason = async (req, res) => {
  const { reason_name, is_active } = req.body;
  const r = await pool.query(`UPDATE mortality_cull_reason_master SET reason_name=COALESCE($1,reason_name), is_active=COALESCE($2,is_active), updated_at=NOW() WHERE id=$3 AND module='Mortality' RETURNING *`,[reason_name||null,is_active??null,req.params.id]);
  if (r.rowCount===0) return res.status(404).json({ success:false, message:'Not found' });
  return res.json({ success:true, data:r.rows[0] });
};
exports.deleteMortalityReason = async (req, res) => {
  await pool.query(`UPDATE mortality_cull_reason_master SET is_active=FALSE WHERE id=$1`,[req.params.id]);
  return res.json({ success:true, message:'Deleted' });
};
exports.addCullKillReason = async (req, res) => {
  const { reason_id, reason_name } = req.body;
  if (!reason_name) return res.status(422).json({ success:false, message:'reason_name required' });
  const r = await pool.query(`INSERT INTO mortality_cull_reason_master (reason_id,reason_name,module,created_by) VALUES ($1,$2,'Cull',$3) RETURNING *`,[reason_id||null,reason_name,req.user?.username||'admin']);
  return res.status(201).json({ success:true, data:r.rows[0] });
};
exports.updateCullKillReason = async (req, res) => {
  const { reason_name, is_active } = req.body;
  const r = await pool.query(`UPDATE mortality_cull_reason_master SET reason_name=COALESCE($1,reason_name), is_active=COALESCE($2,is_active), updated_at=NOW() WHERE id=$3 AND module='Cull' RETURNING *`,[reason_name||null,is_active??null,req.params.id]);
  if (r.rowCount===0) return res.status(404).json({ success:false, message:'Not found' });
  return res.json({ success:true, data:r.rows[0] });
};
exports.deleteCullKillReason = async (req, res) => {
  await pool.query(`UPDATE mortality_cull_reason_master SET is_active=FALSE WHERE id=$1`,[req.params.id]);
  return res.json({ success:true, message:'Deleted' });
};

exports.getMortalityPhotoTypes = async (req, res) => {
  const r = await pool.query(`SELECT * FROM mortality_photo_type_master WHERE is_active=TRUE ORDER BY sort_order`);
  return res.json({ success:true, data:r.rows });
};
exports.addMortalityPhotoType = async (req, res) => {
  const { type_code, type_name, is_required, sort_order } = req.body;
  if (!type_name) return res.status(422).json({ success:false, message:'type_name required' });
  const r = await pool.query(`INSERT INTO mortality_photo_type_master (type_code,type_name,is_required,sort_order) VALUES ($1,$2,$3,$4) RETURNING *`,[type_code||null,type_name,is_required||false,sort_order||0]);
  return res.status(201).json({ success:true, data:r.rows[0] });
};
exports.updateMortalityPhotoType = async (req, res) => {
  const { type_name, is_required, sort_order, is_active } = req.body;
  const r = await pool.query(`UPDATE mortality_photo_type_master SET type_name=COALESCE($1,type_name), is_required=COALESCE($2,is_required), sort_order=COALESCE($3,sort_order), is_active=COALESCE($4,is_active), updated_at=NOW() WHERE id=$5 RETURNING *`,[type_name||null,is_required??null,sort_order??null,is_active??null,req.params.id]);
  return res.json({ success:true, data:r.rows[0] });
};

exports.getCullKillPhotoTypes = async (req, res) => {
  const r = await pool.query(`SELECT * FROM cull_kill_photo_type_master WHERE is_active=TRUE ORDER BY sort_order`);
  return res.json({ success:true, data:r.rows });
};
exports.addCullKillPhotoType = async (req, res) => {
  const { type_code, type_name, is_required, sort_order } = req.body;
  if (!type_name) return res.status(422).json({ success:false, message:'type_name required' });
  const r = await pool.query(`INSERT INTO cull_kill_photo_type_master (type_code,type_name,is_required,sort_order) VALUES ($1,$2,$3,$4) RETURNING *`,[type_code||null,type_name,is_required||false,sort_order||0]);
  return res.status(201).json({ success:true, data:r.rows[0] });
};
exports.updateCullKillPhotoType = async (req, res) => {
  const { type_name, is_required, sort_order, is_active } = req.body;
  const r = await pool.query(`UPDATE cull_kill_photo_type_master SET type_name=COALESCE($1,type_name), is_required=COALESCE($2,is_required), sort_order=COALESCE($3,sort_order), is_active=COALESCE($4,is_active), updated_at=NOW() WHERE id=$5 RETURNING *`,[type_name||null,is_required??null,sort_order??null,is_active??null,req.params.id]);
  return res.json({ success:true, data:r.rows[0] });
};

// ═══════════════════════════════════════════════════════════════════════════
// CORE SAVE FUNCTION — shared by mortality and cull kill
// ═══════════════════════════════════════════════════════════════════════════
async function saveEntry(type, req, res) {
  // type = 'mortality' | 'cull_kill'
  const logTable    = type === 'mortality' ? 'mortality_log'         : 'cull_kill_log';
  const reasonTable = type === 'mortality' ? 'mortality_reason_log'  : 'cull_kill_reason_log';
  const photoTable  = type === 'mortality' ? 'mortality_photo_log'   : 'cull_kill_photo_log';
  const fkCol       = type === 'mortality' ? 'mortality_id'          : 'cull_kill_id';

  const {
    flock_no, plant_code, order_no, shed_id, part_id, line_id, entry_date,
    cum_birds, total_male, total_female,
    morning_male, morning_female,
    afternoon_male, afternoon_female,
    evening_male, evening_female,
    reasons,   // JSON string or array
  } = req.body;

  if (!flock_no || !plant_code) {
    return res.status(422).json({ success:false, message:'flock_no and plant_code required' });
  }

  const date = parseDate(entry_date);
  const today = todayDate();
  if (date > today) return res.status(400).json({ success:false, message:'Cannot enter future date' });

  // Parse reasons
  let reasonsArr = [];
  try {
    if (reasons) reasonsArr = typeof reasons === 'string' ? JSON.parse(reasons) : reasons;
  } catch(e) { return res.status(400).json({ success:false, message:'Invalid reasons JSON' }); }

  // Calculate totals
  const mMale   = parseInt(morning_male)||0;
  const mFem    = parseInt(morning_female)||0;
  const aMale   = parseInt(afternoon_male)||0;
  const aFem    = parseInt(afternoon_female)||0;
  const eMale   = parseInt(evening_male)||0;
  const eFem    = parseInt(evening_female)||0;
  const mQty    = mMale + mFem;
  const aQty    = aMale + aFem;
  const eQty    = eMale + eFem;
  const totalQty= mQty + aQty + eQty;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Save main log
    const logRes = await client.query(`
      INSERT INTO ${logTable}
        (flock_no, plant_code, order_no, shed_id, part_id, line_id, entry_date,
         cum_birds, total_male, total_female,
         morning_male, morning_female, morning_qty,
         afternoon_male, afternoon_female, afternoon_qty,
         evening_male, evening_female, evening_qty,
         total_qty, entered_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
      ON CONFLICT (flock_no, shed_id, part_id, line_id, entry_date)
      DO UPDATE SET
        order_no         = EXCLUDED.order_no,
        cum_birds        = EXCLUDED.cum_birds,
        total_male       = EXCLUDED.total_male,
        total_female     = EXCLUDED.total_female,
        morning_male     = EXCLUDED.morning_male,
        morning_female   = EXCLUDED.morning_female,
        morning_qty      = EXCLUDED.morning_qty,
        afternoon_male   = EXCLUDED.afternoon_male,
        afternoon_female = EXCLUDED.afternoon_female,
        afternoon_qty    = EXCLUDED.afternoon_qty,
        evening_male     = EXCLUDED.evening_male,
        evening_female   = EXCLUDED.evening_female,
        evening_qty      = EXCLUDED.evening_qty,
        total_qty        = EXCLUDED.total_qty,
        entered_by       = EXCLUDED.entered_by,
        updated_at       = NOW()
      RETURNING *
    `, [
      flock_no, plant_code, order_no || null,
      shed_id||null, part_id||null, line_id||null,
      date,
      parseInt(cum_birds)||0,
      parseInt(total_male)||0, parseInt(total_female)||0,
      mMale, mFem, mQty,
      aMale, aFem, aQty,
      eMale, eFem, eQty,
      totalQty, req.user?.id||null
    ]);

    const logId = logRes.rows[0].id;

    // Delete old reasons and re-insert
    await client.query(`DELETE FROM ${reasonTable} WHERE ${fkCol}=$1`, [logId]);
    for (const r of reasonsArr) {
      if (!r.reason_id && !r.reason_name) continue;
      const male   = parseInt(r.male_count)||0;
      const female = parseInt(r.female_count)||0;
      await client.query(`
        INSERT INTO ${reasonTable} (${fkCol}, reason_id, reason_name, male_count, female_count, total_count, remarks)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
      `, [logId, r.reason_id||null, r.reason_name||null, male, female, male+female, r.remarks||null]);
    }

    // Handle photo uploads
    // req.files is an object { fieldname: [file] } from upload.fields()
    // Flatten to array
    const files = req.files
      ? Object.values(req.files).flat()
      : [];
    for (const file of files) {
      // fieldname format: photo_type_id_X  e.g. photo_type_id_1
      const match      = file.fieldname.match(/photo_type_id_(\d+)/);
      const photoTypeId= match ? parseInt(match[1]) : null;

      // Get photo type name
      let photoTypeName = null;
      if (photoTypeId) {
        const ptTable = type === 'mortality' ? 'mortality_photo_type_master' : 'cull_kill_photo_type_master';
        const pt = await client.query(`SELECT type_name FROM ${ptTable} WHERE id=$1`, [photoTypeId]);
        if (pt.rowCount > 0) photoTypeName = pt.rows[0].type_name;
      }

      await client.query(`
        INSERT INTO ${photoTable} (${fkCol}, photo_type_id, photo_type_name, image_path)
        VALUES ($1,$2,$3,$4)
      `, [logId, photoTypeId, photoTypeName, `/uploads/${file.filename}`]);
    }

    await client.query('COMMIT');

    return res.status(201).json({
      success:       true,
      message:       `✅ ${type === 'mortality' ? 'Mortality' : 'Cull Kill'} saved for flock ${flock_no}`,
      id:            logId,
      flock_no,
      entry_date:    date,
      total_qty:     totalQty,
      reasons_saved: reasonsArr.length,
      photos_saved:  files.length,
    });
  } catch(err) {
    await client.query('ROLLBACK');
    console.error(`[save${type}]`, err.message);
    return res.status(500).json({ success:false, message:err.message });
  } finally {
    client.release();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MORTALITY SAVE + GET
// ═══════════════════════════════════════════════════════════════════════════
exports.saveMortality = (req, res) => saveEntry('mortality', req, res);

exports.getMortality = async (req, res) => {
  const { flock_no } = req.params;
  const { date }     = req.query;
  const actDate = parseDate(date);
  try {
    const logRes = await pool.query(`
      SELECT ml.*, TO_CHAR(ml.entry_date,'YYYY-MM-DD') AS entry_date, sm.shed_no, sm.shed_name, sp.part_row_no, sl.line_no,
             sl.male_birds AS line_male, sl.female_birds AS line_female
      FROM mortality_log ml
      LEFT JOIN shed_master sm      ON sm.id = ml.shed_id
      LEFT JOIN shed_part_master sp ON sp.id = ml.part_id
      LEFT JOIN shed_line_master sl ON sl.id = ml.line_id
      WHERE ml.flock_no=$1 AND ml.entry_date=$2
    `, [flock_no, actDate]);

    if (logRes.rowCount === 0) return res.json({ success:true, flock_no, date:actDate, data:null });

    const log = logRes.rows[0];

    const reasons = await pool.query(`SELECT * FROM mortality_reason_log WHERE mortality_id=$1`, [log.id]);
    const photos  = await pool.query(`SELECT * FROM mortality_photo_log  WHERE mortality_id=$1 ORDER BY photo_type_id`, [log.id]);

    return res.json({ success:true, flock_no, date:actDate, data:{ ...formatRow(log), reasons:reasons.rows, photos:photos.rows } });
  } catch(err) { return res.status(500).json({ success:false, message:err.message }); }
};

// ═══════════════════════════════════════════════════════════════════════════
// CULL KILL SAVE + GET
// ═══════════════════════════════════════════════════════════════════════════
exports.saveCullKill = (req, res) => saveEntry('cull_kill', req, res);

exports.getCullKill = async (req, res) => {
  const { flock_no } = req.params;
  const { date }     = req.query;
  const actDate = parseDate(date);
  try {
    const logRes = await pool.query(`
      SELECT ck.*, TO_CHAR(ck.entry_date,'YYYY-MM-DD') AS entry_date, sm.shed_no, sm.shed_name, sp.part_row_no, sl.line_no,
             sl.male_birds AS line_male, sl.female_birds AS line_female
      FROM cull_kill_log ck
      LEFT JOIN shed_master sm      ON sm.id = ck.shed_id
      LEFT JOIN shed_part_master sp ON sp.id = ck.part_id
      LEFT JOIN shed_line_master sl ON sl.id = ck.line_id
      WHERE ck.flock_no=$1 AND ck.entry_date=$2
    `, [flock_no, actDate]);

    if (logRes.rowCount === 0) return res.json({ success:true, flock_no, date:actDate, data:null });

    const log = logRes.rows[0];
    const reasons = await pool.query(`SELECT * FROM cull_kill_reason_log WHERE cull_kill_id=$1`, [log.id]);
    const photos  = await pool.query(`SELECT * FROM cull_kill_photo_log  WHERE cull_kill_id=$1 ORDER BY photo_type_id`, [log.id]);

    return res.json({ success:true, flock_no, date:actDate, data:{ ...formatRow(log), reasons:reasons.rows, photos:photos.rows } });
  } catch(err) { return res.status(500).json({ success:false, message:err.message }); }
};
