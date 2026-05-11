const pool = require('../config/db');

// ═══════════════════════════════════════════════════════════════════════════
// SHED MASTER
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/masters/shed?plant_code=1902
// Returns sheds grouped with parts and lines for grid view
exports.getShedMaster = async (req, res) => {
  const { plant_code } = req.query;
  try {
    let q = `SELECT * FROM shed_master WHERE is_active=TRUE`;
    const p = [];
    if (plant_code) { q += ` AND plant_code=$1`; p.push(plant_code); }
    q += ` ORDER BY shed_no`;
    const sheds = await pool.query(q, p);

    // For each shed get parts and lines
    const result = [];
    for (const shed of sheds.rows) {
      const parts = await pool.query(
        `SELECT * FROM shed_part_master WHERE shed_id=$1 AND is_active=TRUE ORDER BY part_row_no`,
        [shed.id]
      );
      const partsWithLines = [];
      for (const part of parts.rows) {
        const lines = await pool.query(
          `SELECT * FROM shed_line_master WHERE part_id=$1 AND is_active=TRUE ORDER BY line_no`,
          [part.id]
        );
        partsWithLines.push({ ...part, lines: lines.rows });
      }
      result.push({ ...shed, parts: partsWithLines });
    }

    return res.json({ success:true, total:result.length, data:result });
  } catch(err) { return res.status(500).json({ success:false, message:err.message }); }
};

// POST /api/masters/shed
// Add shed + part + line in one call
exports.addShed = async (req, res) => {
  const { plant_code, shed_no, shed_name, part_row_no, cum_birds, line_no, male_birds, female_birds, total_birds } = req.body;
  if (!plant_code || !shed_no) return res.status(422).json({ success:false, message:'plant_code and shed_no required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Upsert shed
    const shedRes = await client.query(`
      INSERT INTO shed_master (plant_code, shed_no, shed_name)
      VALUES ($1,$2,$3)
      ON CONFLICT (plant_code, shed_no) DO UPDATE SET shed_name=EXCLUDED.shed_name, updated_at=NOW()
      RETURNING *
    `, [plant_code, shed_no, shed_name||shed_no]);

    const shed = shedRes.rows[0];
    let part = null, line = null;

    // Add part if provided
    if (part_row_no) {
      const partRes = await client.query(`
        INSERT INTO shed_part_master (shed_id, part_row_no, cum_birds)
        VALUES ($1,$2,$3)
        ON CONFLICT (shed_id, part_row_no) DO UPDATE SET cum_birds=EXCLUDED.cum_birds, updated_at=NOW()
        RETURNING *
      `, [shed.id, part_row_no, cum_birds||0]);
      part = partRes.rows[0];

      // Add line if provided
      if (line_no && part) {
        const tot = total_birds || (parseInt(male_birds||0) + parseInt(female_birds||0));
        const lineRes = await client.query(`
          INSERT INTO shed_line_master (part_id, line_no, male_birds, female_birds, total_birds)
          VALUES ($1,$2,$3,$4,$5)
          ON CONFLICT (part_id, line_no) DO UPDATE SET
            male_birds=EXCLUDED.male_birds, female_birds=EXCLUDED.female_birds,
            total_birds=EXCLUDED.total_birds, updated_at=NOW()
          RETURNING *
        `, [part.id, line_no, male_birds||0, female_birds||0, tot]);
        line = lineRes.rows[0];
      }
    }

    await client.query('COMMIT');
    return res.status(201).json({ success:true, message:'Shed saved', shed, part, line });
  } catch(err) {
    await client.query('ROLLBACK');
    return res.status(500).json({ success:false, message:err.message });
  } finally { client.release(); }
};

// POST /api/masters/shed/:shed_id/part
// Add part to existing shed
exports.addPart = async (req, res) => {
  const { shed_id } = req.params;
  const { part_row_no, cum_birds } = req.body;
  if (!part_row_no) return res.status(422).json({ success:false, message:'part_row_no required' });
  try {
    const r = await pool.query(`
      INSERT INTO shed_part_master (shed_id, part_row_no, cum_birds)
      VALUES ($1,$2,$3)
      ON CONFLICT (shed_id, part_row_no) DO UPDATE SET cum_birds=EXCLUDED.cum_birds
      RETURNING *
    `, [shed_id, part_row_no, cum_birds||0]);
    return res.status(201).json({ success:true, data:r.rows[0] });
  } catch(err) { return res.status(500).json({ success:false, message:err.message }); }
};

// POST /api/masters/shed/part/:part_id/line
// Add line to existing part
exports.addLine = async (req, res) => {
  const { part_id } = req.params;
  const { line_no, male_birds, female_birds, total_birds } = req.body;
  if (!line_no) return res.status(422).json({ success:false, message:'line_no required' });
  try {
    const tot = total_birds || (parseInt(male_birds||0) + parseInt(female_birds||0));
    const r = await pool.query(`
      INSERT INTO shed_line_master (part_id, line_no, male_birds, female_birds, total_birds)
      VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (part_id, line_no) DO UPDATE SET
        male_birds=EXCLUDED.male_birds, female_birds=EXCLUDED.female_birds, total_birds=EXCLUDED.total_birds
      RETURNING *
    `, [part_id, line_no, male_birds||0, female_birds||0, tot]);
    return res.status(201).json({ success:true, data:r.rows[0] });
  } catch(err) { return res.status(500).json({ success:false, message:err.message }); }
};

// PUT /api/masters/shed/:id
exports.updateShed = async (req, res) => {
  const { shed_no, shed_name, is_active } = req.body;
  const r = await pool.query(`
    UPDATE shed_master SET
      shed_no=COALESCE($1,shed_no), shed_name=COALESCE($2,shed_name),
      is_active=COALESCE($3,is_active), updated_at=NOW()
    WHERE id=$4 RETURNING *
  `, [shed_no||null, shed_name||null, is_active??null, req.params.id]);
  if (r.rowCount===0) return res.status(404).json({ success:false, message:'Not found' });
  return res.json({ success:true, data:r.rows[0] });
};

// DELETE /api/masters/shed/:id
exports.deleteShed = async (req, res) => {
  await pool.query(`UPDATE shed_master SET is_active=FALSE WHERE id=$1`, [req.params.id]);
  return res.json({ success:true, message:'Shed deactivated' });
};

// PUT /api/masters/shed/part/:id
// Body: { part_row_no, cum_birds, is_active }
exports.updatePart = async (req, res) => {
  try {
    const { part_row_no, cum_birds, is_active } = req.body;
    const r = await pool.query(`
      UPDATE shed_part_master SET
        part_row_no = COALESCE($1, part_row_no),
        cum_birds   = COALESCE($2, cum_birds),
        is_active   = COALESCE($3, is_active),
        updated_at  = NOW()
      WHERE id = $4 RETURNING *
    `, [part_row_no||null, cum_birds!=null?cum_birds:null, is_active??null, req.params.id]);
    if (r.rowCount===0) return res.status(404).json({ success:false, message:'Part not found' });
    return res.json({ success:true, message:'Part updated', data:r.rows[0] });
  } catch(err) { return res.status(500).json({ success:false, message:err.message }); }
};

// DELETE /api/masters/shed/part/:id
exports.deletePart = async (req, res) => {
  try {
    await pool.query(`UPDATE shed_part_master SET is_active=FALSE WHERE id=$1`, [req.params.id]);
    return res.json({ success:true, message:'Part deactivated' });
  } catch(err) { return res.status(500).json({ success:false, message:err.message }); }
};

// PUT /api/masters/shed/line/:id
// Body: { line_no, male_birds, female_birds, total_birds, is_active }
exports.updateLine = async (req, res) => {
  try {
    const { line_no, male_birds, female_birds, total_birds, is_active } = req.body;
    const tot = total_birds != null ? total_birds
              : (male_birds != null && female_birds != null)
                ? (parseInt(male_birds)||0) + (parseInt(female_birds)||0)
                : null;
    const r = await pool.query(`
      UPDATE shed_line_master SET
        line_no      = COALESCE($1, line_no),
        male_birds   = COALESCE($2, male_birds),
        female_birds = COALESCE($3, female_birds),
        total_birds  = COALESCE($4, total_birds),
        is_active    = COALESCE($5, is_active),
        updated_at   = NOW()
      WHERE id = $6 RETURNING *
    `, [line_no||null, male_birds??null, female_birds??null, tot, is_active??null, req.params.id]);
    if (r.rowCount===0) return res.status(404).json({ success:false, message:'Line not found' });
    return res.json({ success:true, message:'Line updated', data:r.rows[0] });
  } catch(err) { return res.status(500).json({ success:false, message:err.message }); }
};

// DELETE /api/masters/shed/line/:id
exports.deleteLine = async (req, res) => {
  await pool.query(`UPDATE shed_line_master SET is_active=FALSE WHERE id=$1`, [req.params.id]);
  return res.json({ success:true, message:'Line deactivated' });
};

// ═══════════════════════════════════════════════════════════════════════════
// STANDARD WEIGHT MASTER
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/masters/standard-weight
exports.getStandardWeights = async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT swh.*, COUNT(swd.id) AS total_weeks
      FROM standard_weight_header swh
      LEFT JOIN standard_weight_detail swd ON swd.header_id = swh.id
      WHERE swh.is_active=TRUE
      GROUP BY swh.id ORDER BY swh.doc_no
    `);
    return res.json({ success:true, total:r.rowCount, data:r.rows });
  } catch(err) { return res.status(500).json({ success:false, message:err.message }); }
};

// GET /api/masters/standard-weight/:id
exports.getStandardWeightById = async (req, res) => {
  try {
    const h = await pool.query(`SELECT * FROM standard_weight_header WHERE id=$1`, [req.params.id]);
    if (h.rowCount===0) return res.status(404).json({ success:false, message:'Not found' });
    const d = await pool.query(`SELECT * FROM standard_weight_detail WHERE header_id=$1 ORDER BY age_in_weeks`, [req.params.id]);
    return res.json({ success:true, data:{ ...h.rows[0], details:d.rows } });
  } catch(err) { return res.status(500).json({ success:false, message:err.message }); }
};

// POST /api/masters/standard-weight
exports.addStandardWeight = async (req, res) => {
  const { doc_no, doc_date, start_date, end_date, season, remarks } = req.body;
  if (!doc_no) return res.status(422).json({ success:false, message:'doc_no required' });
  try {
    const r = await pool.query(`
      INSERT INTO standard_weight_header (doc_no, doc_date, start_date, end_date, season, remarks, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *
    `, [doc_no, doc_date||null, start_date||null, end_date||null, season||'All', remarks||null, req.user?.username||'admin']);
    return res.status(201).json({ success:true, message:'Standard weight created', data:r.rows[0] });
  } catch(err) { return res.status(500).json({ success:false, message:err.message }); }
};

// PUT /api/masters/standard-weight/:id
exports.updateStandardWeight = async (req, res) => {
  const { doc_no, doc_date, start_date, end_date, season, remarks, is_active } = req.body;
  const r = await pool.query(`
    UPDATE standard_weight_header SET
      doc_no=COALESCE($1,doc_no), doc_date=COALESCE($2,doc_date),
      start_date=COALESCE($3,start_date), end_date=COALESCE($4,end_date),
      season=COALESCE($5,season), remarks=COALESCE($6,remarks),
      is_active=COALESCE($7,is_active), updated_at=NOW()
    WHERE id=$8 RETURNING *
  `, [doc_no||null, doc_date||null, start_date||null, end_date||null, season||null, remarks||null, is_active??null, req.params.id]);
  if (r.rowCount===0) return res.status(404).json({ success:false, message:'Not found' });
  return res.json({ success:true, data:r.rows[0] });
};

// DELETE /api/masters/standard-weight/:id
exports.deleteStandardWeight = async (req, res) => {
  await pool.query(`UPDATE standard_weight_header SET is_active=FALSE WHERE id=$1`, [req.params.id]);
  return res.json({ success:true, message:'Deleted' });
};

// POST /api/masters/standard-weight/:id/weeks
// Add week row to header
exports.addWeekRow = async (req, res) => {
  const { age_in_weeks, male_weight, female_weight } = req.body;
  if (!age_in_weeks) return res.status(422).json({ success:false, message:'age_in_weeks required' });
  try {
    const r = await pool.query(`
      INSERT INTO standard_weight_detail (header_id, age_in_weeks, male_weight, female_weight)
      VALUES ($1,$2,$3,$4)
      ON CONFLICT (header_id, age_in_weeks) DO UPDATE SET
        male_weight=EXCLUDED.male_weight, female_weight=EXCLUDED.female_weight, updated_at=NOW()
      RETURNING *
    `, [req.params.id, age_in_weeks, male_weight||null, female_weight||null]);
    return res.status(201).json({ success:true, data:r.rows[0] });
  } catch(err) { return res.status(500).json({ success:false, message:err.message }); }
};

// PUT /api/masters/standard-weight/week/:id
exports.updateWeekRow = async (req, res) => {
  const { age_in_weeks, male_weight, female_weight } = req.body;
  const r = await pool.query(`
    UPDATE standard_weight_detail SET
      age_in_weeks=COALESCE($1,age_in_weeks),
      male_weight=COALESCE($2,male_weight),
      female_weight=COALESCE($3,female_weight),
      updated_at=NOW()
    WHERE id=$4 RETURNING *
  `, [age_in_weeks||null, male_weight||null, female_weight||null, req.params.id]);
  if (r.rowCount===0) return res.status(404).json({ success:false, message:'Not found' });
  return res.json({ success:true, data:r.rows[0] });
};

// DELETE /api/masters/standard-weight/week/:id
exports.deleteWeekRow = async (req, res) => {
  await pool.query(`DELETE FROM standard_weight_detail WHERE id=$1`, [req.params.id]);
  return res.json({ success:true, message:'Week row deleted' });
};

// ═══════════════════════════════════════════════════════════════════════════
// MORTALITY/CULL REASON MASTER (combined — module: Mortality | Cull)
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/masters/mortality-cull-reasons?module=Mortality
exports.getMortalityCullReasons = async (req, res) => {
  const { module } = req.query;
  let q = `SELECT * FROM mortality_cull_reason_master WHERE is_active=TRUE`;
  const p = [];
  if (module) { q += ` AND module=$1`; p.push(module); }
  q += ` ORDER BY module, reason_id`;
  const r = await pool.query(q, p);
  return res.json({ success:true, total:r.rowCount, data:r.rows });
};

// POST /api/masters/mortality-cull-reasons
exports.addMortalityCullReason = async (req, res) => {
  const { reason_id, reason_name, module } = req.body;
  if (!reason_name || !module) return res.status(422).json({ success:false, message:'reason_name and module required' });
  if (!['Mortality','Cull'].includes(module)) return res.status(422).json({ success:false, message:'module must be Mortality or Cull' });
  try {
    const r = await pool.query(`
      INSERT INTO mortality_cull_reason_master (reason_id, reason_name, module, created_by)
      VALUES ($1,$2,$3,$4) RETURNING *
    `, [reason_id||null, reason_name, module, req.user?.username||'admin']);
    return res.status(201).json({ success:true, data:r.rows[0] });
  } catch(err) { return res.status(500).json({ success:false, message:err.message }); }
};

// PUT /api/masters/mortality-cull-reasons/:id
exports.updateMortalityCullReason = async (req, res) => {
  const { reason_id, reason_name, module, is_active } = req.body;
  const r = await pool.query(`
    UPDATE mortality_cull_reason_master SET
      reason_id=COALESCE($1,reason_id), reason_name=COALESCE($2,reason_name),
      module=COALESCE($3,module), is_active=COALESCE($4,is_active), updated_at=NOW()
    WHERE id=$5 RETURNING *
  `, [reason_id||null, reason_name||null, module||null, is_active??null, req.params.id]);
  if (r.rowCount===0) return res.status(404).json({ success:false, message:'Not found' });
  return res.json({ success:true, data:r.rows[0] });
};

// DELETE /api/masters/mortality-cull-reasons/:id
exports.deleteMortalityCullReason = async (req, res) => {
  await pool.query(`UPDATE mortality_cull_reason_master SET is_active=FALSE WHERE id=$1`, [req.params.id]);
  return res.json({ success:true, message:'Deleted' });
};

// ═══════════════════════════════════════════════════════════════════════════
// BIRD GRADING MASTER
// ═══════════════════════════════════════════════════════════════════════════

exports.getBirdGrading = async (req, res) => {
  const r = await pool.query(`SELECT * FROM bird_grading_master WHERE is_active=TRUE ORDER BY doc_no`);
  return res.json({ success:true, total:r.rowCount, data:r.rows });
};

exports.addBirdGrading = async (req, res) => {
  const { doc_no, doc_date, start_date, end_date, age_in_weeks } = req.body;
  if (!doc_no) return res.status(422).json({ success:false, message:'doc_no required' });
  try {
    const r = await pool.query(`
      INSERT INTO bird_grading_master (doc_no, doc_date, start_date, end_date, age_in_weeks, created_by)
      VALUES ($1,$2,$3,$4,$5,$6) RETURNING *
    `, [doc_no, doc_date||null, start_date||null, end_date||null, age_in_weeks||null, req.user?.username||'admin']);
    return res.status(201).json({ success:true, data:r.rows[0] });
  } catch(err) { return res.status(500).json({ success:false, message:err.message }); }
};

exports.updateBirdGrading = async (req, res) => {
  const { doc_no, doc_date, start_date, end_date, age_in_weeks, is_active } = req.body;
  const r = await pool.query(`
    UPDATE bird_grading_master SET
      doc_no=COALESCE($1,doc_no), doc_date=COALESCE($2,doc_date),
      start_date=COALESCE($3,start_date), end_date=COALESCE($4,end_date),
      age_in_weeks=COALESCE($5,age_in_weeks), is_active=COALESCE($6,is_active), updated_at=NOW()
    WHERE id=$7 RETURNING *
  `, [doc_no||null, doc_date||null, start_date||null, end_date||null, age_in_weeks||null, is_active??null, req.params.id]);
  if (r.rowCount===0) return res.status(404).json({ success:false, message:'Not found' });
  return res.json({ success:true, data:r.rows[0] });
};

exports.deleteBirdGrading = async (req, res) => {
  await pool.query(`UPDATE bird_grading_master SET is_active=FALSE WHERE id=$1`, [req.params.id]);
  return res.json({ success:true, message:'Deleted' });
};

// ═══════════════════════════════════════════════════════════════════════════
// EGG GRADING MASTER
// ═══════════════════════════════════════════════════════════════════════════

exports.getEggGrading = async (req, res) => {
  const r = await pool.query(`SELECT * FROM egg_grading_master WHERE is_active=TRUE ORDER BY grading_id`);
  return res.json({ success:true, total:r.rowCount, data:r.rows });
};

exports.addEggGrading = async (req, res) => {
  const { grading_id, grading_name, short_code } = req.body;
  if (!grading_name) return res.status(422).json({ success:false, message:'grading_name required' });
  try {
    const r = await pool.query(`
      INSERT INTO egg_grading_master (grading_id, grading_name, short_code, created_by)
      VALUES ($1,$2,$3,$4) RETURNING *
    `, [grading_id||null, grading_name, short_code||null, req.user?.username||'admin']);
    return res.status(201).json({ success:true, data:r.rows[0] });
  } catch(err) { return res.status(500).json({ success:false, message:err.message }); }
};

exports.updateEggGrading = async (req, res) => {
  const { grading_id, grading_name, short_code, is_active } = req.body;
  const r = await pool.query(`
    UPDATE egg_grading_master SET
      grading_id=COALESCE($1,grading_id), grading_name=COALESCE($2,grading_name),
      short_code=COALESCE($3,short_code), is_active=COALESCE($4,is_active), updated_at=NOW()
    WHERE id=$5 RETURNING *
  `, [grading_id||null, grading_name||null, short_code||null, is_active??null, req.params.id]);
  if (r.rowCount===0) return res.status(404).json({ success:false, message:'Not found' });
  return res.json({ success:true, data:r.rows[0] });
};

exports.deleteEggGrading = async (req, res) => {
  await pool.query(`UPDATE egg_grading_master SET is_active=FALSE WHERE id=$1`, [req.params.id]);
  return res.json({ success:true, message:'Deleted' });
};

// ═══════════════════════════════════════════════════════════════════════════
// EGG TYPE MASTER (SAP IDs like EG000001)
// ═══════════════════════════════════════════════════════════════════════════

function normalizeSapFieldKey(value) {
  const key = String(value || '').trim().toLowerCase();
  const map = {
    hatching_egg: 'hatching_egg',
    broiler_egg: 'hatching_egg',
    table_egg: 'table_egg',
    jumbo_egg: 'jumbo_egg',
    crack_egg: 'crack_egg',
    waste_reject_egg: 'waste_reject_egg',
    waste_rejected_egg: 'waste_reject_egg',
    waste_egg: 'waste_reject_egg',
  };
  return map[key] || null;
}

async function generateNextEggTypeId(client) {
  const r = await client.query(`
    SELECT COALESCE(MAX(CAST(SUBSTRING(egg_type_id FROM 3) AS INT)), 5) AS max_num
    FROM egg_type_lookup
    WHERE egg_type_id ~ '^EG[0-9]+$'
  `);
  const next = (parseInt(r.rows[0].max_num) || 5) + 1;
  return `EG${String(next).padStart(6, '0')}`;
}

exports.getEggTypes = async (req, res) => {
  try {
    const { include_inactive } = req.query;
    const r = await pool.query(
      `SELECT id, egg_type_id, egg_type_name, sap_field_key, sort_order, is_active
       FROM egg_type_lookup
       ${include_inactive === 'true' ? '' : 'WHERE is_active=TRUE'}
       ORDER BY sort_order, egg_type_id`
    );
    return res.json({ success: true, total: r.rowCount, data: r.rows });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.addEggType = async (req, res) => {
  const client = await pool.connect();
  try {
    const { egg_type_name, sap_field_key, egg_type_id, sort_order } = req.body;
    if (!egg_type_name) {
      return res.status(422).json({ success: false, message: 'egg_type_name required' });
    }
    const normalizedKey = normalizeSapFieldKey(sap_field_key);
    if (!normalizedKey) {
      return res.status(422).json({
        success: false,
        message: 'sap_field_key required (hatching_egg|table_egg|jumbo_egg|crack_egg|waste_reject_egg)',
      });
    }

    await client.query('BEGIN');
    const finalEggTypeId = egg_type_id || (await generateNextEggTypeId(client));
    const r = await client.query(
      `INSERT INTO egg_type_lookup (egg_type_id, egg_type_name, sap_field_key, sort_order, created_by)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING *`,
      [finalEggTypeId, egg_type_name, normalizedKey, sort_order ?? 0, req.user?.username || 'admin']
    );
    await client.query('COMMIT');
    return res.status(201).json({ success: true, data: r.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    return res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
};

exports.updateEggType = async (req, res) => {
  try {
    const { egg_type_name, sap_field_key, sort_order, is_active } = req.body;
    const normalizedKey = sap_field_key !== undefined ? normalizeSapFieldKey(sap_field_key) : undefined;
    if (sap_field_key !== undefined && !normalizedKey) {
      return res.status(422).json({
        success: false,
        message: 'invalid sap_field_key',
      });
    }
    const r = await pool.query(
      `UPDATE egg_type_lookup SET
         egg_type_name = COALESCE($1, egg_type_name),
         sap_field_key = COALESCE($2, sap_field_key),
         sort_order    = COALESCE($3, sort_order),
         is_active     = COALESCE($4, is_active),
         updated_at    = NOW()
       WHERE id=$5
       RETURNING *`,
      [egg_type_name || null, normalizedKey ?? null, sort_order ?? null, is_active ?? null, req.params.id]
    );
    if (r.rowCount === 0) return res.status(404).json({ success: false, message: 'Not found' });
    return res.json({ success: true, data: r.rows[0] });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.deleteEggType = async (req, res) => {
  try {
    await pool.query(`UPDATE egg_type_lookup SET is_active=FALSE, updated_at=NOW() WHERE id=$1`, [req.params.id]);
    return res.json({ success: true, message: 'Deleted' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};
