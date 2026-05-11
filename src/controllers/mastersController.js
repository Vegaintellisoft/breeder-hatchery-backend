const pool = require('../config/db');

// ═══════════════════════════════════════════════════════════════════════════
// SHED MASTER — Plant → Shed → Part → Line
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/masters/shed?plant_code=1902
// Returns shed grid view (tabs structure)
exports.getShedMaster = async (req, res) => {
  const { plant_code } = req.query;
  try {
    let where = `WHERE sm.is_active=TRUE`;
    const params = [];
    if (plant_code) { where += ` AND sm.plant_code=$1`; params.push(plant_code); }

    const result = await pool.query(`
      SELECT
        sm.id AS shed_id, sm.plant_code, sm.shed_no, sm.shed_name,
        sp.id AS part_id, sp.part_row_no, sp.cum_birds,
        sl.id AS line_id, sl.line_no, sl.male_birds, sl.female_birds, sl.total_birds
      FROM shed_master sm
      LEFT JOIN shed_part_master sp ON sp.shed_id = sm.id AND sp.is_active=TRUE
      LEFT JOIN shed_line_master sl ON sl.part_id = sp.id AND sl.is_active=TRUE
      ${where}
      ORDER BY sm.shed_no, sp.part_row_no, sl.line_no
    `, params);

    // Group: shed → parts → lines
    const sheds = {};
    for (const row of result.rows) {
      if (!sheds[row.shed_id]) {
        sheds[row.shed_id] = {
          id: row.shed_id, plant_code: row.plant_code,
          shed_no: row.shed_no, shed_name: row.shed_name, parts: {}
        };
      }
      if (row.part_id && !sheds[row.shed_id].parts[row.part_id]) {
        sheds[row.shed_id].parts[row.part_id] = {
          id: row.part_id, part_row_no: row.part_row_no,
          cum_birds: row.cum_birds, lines: []
        };
      }
      if (row.line_id) {
        sheds[row.shed_id].parts[row.part_id].lines.push({
          id: row.line_id, line_no: row.line_no,
          male_birds: row.male_birds, female_birds: row.female_birds,
          total_birds: row.total_birds
        });
      }
    }

    const data = Object.values(sheds).map(s => ({
      ...s, parts: Object.values(s.parts)
    }));

    return res.json({ success:true, total:data.length, data });
  } catch(err) { return res.status(500).json({ success:false, message:err.message }); }
};

// POST /api/masters/shed
// Add shed + part + line in one call
exports.addShed = async (req, res) => {
  const { plant_code, shed_no, shed_name, part_row_no, cum_birds, line_no, male_birds, female_birds } = req.body;
  if (!plant_code || !shed_no) return res.status(422).json({ success:false, message:'plant_code and shed_no required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Upsert shed
    let shedRes = await client.query(
      `SELECT id FROM shed_master WHERE plant_code=$1 AND shed_no=$2`,
      [plant_code, shed_no]
    );
    let shedId;
    if (shedRes.rowCount > 0) {
      shedId = shedRes.rows[0].id;
    } else {
      shedRes = await client.query(
        `INSERT INTO shed_master (plant_code,shed_no,shed_name) VALUES ($1,$2,$3) RETURNING id`,
        [plant_code, shed_no, shed_name||shed_no]
      );
      shedId = shedRes.rows[0].id;
    }

    let partId = null;
    if (part_row_no) {
      let partRes = await client.query(
        `SELECT id FROM shed_part_master WHERE shed_id=$1 AND part_row_no=$2`,
        [shedId, part_row_no]
      );
      if (partRes.rowCount > 0) {
        partId = partRes.rows[0].id;
      } else {
        partRes = await client.query(
          `INSERT INTO shed_part_master (shed_id,part_row_no,cum_birds) VALUES ($1,$2,$3) RETURNING id`,
          [shedId, part_row_no, cum_birds||0]
        );
        partId = partRes.rows[0].id;
      }
    }

    let lineId = null;
    if (partId && line_no) {
      const male   = parseInt(male_birds)||0;
      const female = parseInt(female_birds)||0;
      const lineRes = await client.query(
        `INSERT INTO shed_line_master (part_id,line_no,male_birds,female_birds,total_birds)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (part_id,line_no)
         DO UPDATE SET male_birds=$3,female_birds=$4,total_birds=$5 RETURNING id`,
        [partId, line_no, male, female, male+female]
      );
      lineId = lineRes.rows[0].id;
    }

    await client.query('COMMIT');
    return res.status(201).json({
      success:true, message:'Shed saved',
      shed_id:shedId, part_id:partId, line_id:lineId
    });
  } catch(err) {
    await client.query('ROLLBACK');
    return res.status(500).json({ success:false, message:err.message });
  } finally { client.release(); }
};

// POST /api/masters/shed/:shed_id/part/:part_id/line
// Add line to existing part
exports.addLine = async (req, res) => {
  const { part_id } = req.params;
  const { line_no, male_birds, female_birds } = req.body;
  if (!line_no) return res.status(422).json({ success:false, message:'line_no required' });
  const male = parseInt(male_birds)||0, female = parseInt(female_birds)||0;
  try {
    const r = await pool.query(
      `INSERT INTO shed_line_master (part_id,line_no,male_birds,female_birds,total_birds)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (part_id,line_no)
       DO UPDATE SET male_birds=$3,female_birds=$4,total_birds=$5 RETURNING *`,
      [part_id, line_no, male, female, male+female]
    );
    return res.status(201).json({ success:true, data:r.rows[0] });
  } catch(err) { return res.status(500).json({ success:false, message:err.message }); }
};

exports.updateShed = async (req, res) => {
  const { shed_no, shed_name, is_active } = req.body;
  const r = await pool.query(
    `UPDATE shed_master SET shed_no=COALESCE($1,shed_no),shed_name=COALESCE($2,shed_name),is_active=COALESCE($3,is_active),updated_at=NOW() WHERE id=$4 RETURNING *`,
    [shed_no||null, shed_name||null, is_active??null, req.params.id]
  );
  if (r.rowCount===0) return res.status(404).json({ success:false, message:'Not found' });
  return res.json({ success:true, data:r.rows[0] });
};

exports.deleteShed = async (req, res) => {
  await pool.query(`UPDATE shed_master SET is_active=FALSE WHERE id=$1`,[req.params.id]);
  return res.json({ success:true, message:'Shed deleted' });
};

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

exports.deletePart = async (req, res) => {
  try {
    await pool.query(`UPDATE shed_part_master SET is_active=FALSE WHERE id=$1`, [req.params.id]);
    return res.json({ success:true, message:'Part deleted' });
  } catch(err) { return res.status(500).json({ success:false, message:err.message }); }
};

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

exports.deleteLine = async (req, res) => {
  await pool.query(`UPDATE shed_line_master SET is_active=FALSE WHERE id=$1`,[req.params.id]);
  return res.json({ success:true, message:'Line deleted' });
};

// ═══════════════════════════════════════════════════════════════════════════
// STANDARD WEIGHT MASTER
// ═══════════════════════════════════════════════════════════════════════════

exports.getStandardWeights = async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT h.*, COUNT(d.id) AS total_weeks
      FROM standard_weight_header h
      LEFT JOIN standard_weight_detail d ON d.header_id=h.id
      WHERE h.is_active=TRUE
      GROUP BY h.id ORDER BY h.created_at DESC
    `);
    return res.json({ success:true, total:r.rowCount, data:r.rows });
  } catch(err) { return res.status(500).json({ success:false, message:err.message }); }
};

exports.getStandardWeightById = async (req, res) => {
  try {
    const h = await pool.query(`SELECT * FROM standard_weight_header WHERE id=$1`,[req.params.id]);
    if (h.rowCount===0) return res.status(404).json({ success:false, message:'Not found' });
    const d = await pool.query(`SELECT * FROM standard_weight_detail WHERE header_id=$1 ORDER BY age_in_weeks`,[req.params.id]);
    return res.json({ success:true, data:{ ...h.rows[0], details:d.rows } });
  } catch(err) { return res.status(500).json({ success:false, message:err.message }); }
};

exports.addStandardWeight = async (req, res) => {
  const { doc_no, doc_date, start_date, end_date, season, remarks } = req.body;
  if (!doc_no) return res.status(422).json({ success:false, message:'doc_no required' });
  try {
    const r = await pool.query(
      `INSERT INTO standard_weight_header (doc_no,doc_date,start_date,end_date,season,remarks,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [doc_no, doc_date||null, start_date||null, end_date||null, season||'All', remarks||null, req.user?.username||'admin']
    );
    return res.status(201).json({ success:true, message:'Standard weight created', data:r.rows[0] });
  } catch(err) { return res.status(500).json({ success:false, message:err.message }); }
};

exports.updateStandardWeight = async (req, res) => {
  const { doc_no, doc_date, start_date, end_date, season, remarks, is_active } = req.body;
  const sets=[]; const vals=[]; let idx=1;
  if (doc_no     !== undefined) { sets.push(`doc_no=$${idx++}`);     vals.push(doc_no); }
  if (doc_date   !== undefined) { sets.push(`doc_date=$${idx++}`);   vals.push(doc_date); }
  if (start_date !== undefined) { sets.push(`start_date=$${idx++}`); vals.push(start_date); }
  if (end_date   !== undefined) { sets.push(`end_date=$${idx++}`);   vals.push(end_date); }
  if (season     !== undefined) { sets.push(`season=$${idx++}`);     vals.push(season); }
  if (remarks    !== undefined) { sets.push(`remarks=$${idx++}`);    vals.push(remarks); }
  if (is_active  !== undefined) { sets.push(`is_active=$${idx++}`);  vals.push(is_active); }
  if (!sets.length) return res.status(400).json({ success:false, message:'Nothing to update' });
  sets.push(`updated_at=NOW()`); vals.push(req.params.id);
  const r = await pool.query(`UPDATE standard_weight_header SET ${sets.join(',')} WHERE id=$${idx} RETURNING *`, vals);
  return res.json({ success:true, data:r.rows[0] });
};

exports.deleteStandardWeight = async (req, res) => {
  await pool.query(`UPDATE standard_weight_header SET is_active=FALSE WHERE id=$1`,[req.params.id]);
  return res.json({ success:true, message:'Deleted' });
};

// Week detail CRUD
exports.addWeekDetail = async (req, res) => {
  const { age_in_weeks, male_weight, female_weight } = req.body;
  if (!age_in_weeks) return res.status(422).json({ success:false, message:'age_in_weeks required' });
  try {
    const r = await pool.query(
      `INSERT INTO standard_weight_detail (header_id,age_in_weeks,male_weight,female_weight)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.params.id, age_in_weeks, male_weight||null, female_weight||null]
    );
    return res.status(201).json({ success:true, data:r.rows[0] });
  } catch(err) { return res.status(500).json({ success:false, message:err.message }); }
};

exports.updateWeekDetail = async (req, res) => {
  const { age_in_weeks, male_weight, female_weight } = req.body;
  const r = await pool.query(
    `UPDATE standard_weight_detail SET age_in_weeks=COALESCE($1,age_in_weeks),male_weight=COALESCE($2,male_weight),female_weight=COALESCE($3,female_weight),updated_at=NOW() WHERE id=$4 RETURNING *`,
    [age_in_weeks||null, male_weight||null, female_weight||null, req.params.id]
  );
  return res.json({ success:true, data:r.rows[0] });
};

exports.deleteWeekDetail = async (req, res) => {
  await pool.query(`DELETE FROM standard_weight_detail WHERE id=$1`,[req.params.id]);
  return res.json({ success:true, message:'Deleted' });
};

// ═══════════════════════════════════════════════════════════════════════════
// MORTALITY/CULL REASON MASTER (combined)
// ═══════════════════════════════════════════════════════════════════════════

exports.getMortalityCullReasons = async (req, res) => {
  const { module } = req.query;
  let q = `SELECT * FROM mortality_cull_reason_master WHERE is_active=TRUE`;
  const p = [];
  if (module) { q += ` AND (module=$1 OR module='Both')`; p.push(module); }
  q += ` ORDER BY reason_id`;
  const r = await pool.query(q, p);
  return res.json({ success:true, total:r.rowCount, data:r.rows });
};

exports.addMortalityCullReason = async (req, res) => {
  const { reason_id, reason_name, module } = req.body;
  if (!reason_name) return res.status(422).json({ success:false, message:'reason_name required' });
  if (!module || !['Mortality','Cull','Both'].includes(module)) {
    return res.status(422).json({ success:false, message:'module required: Mortality, Cull, or Both' });
  }
  try {
    const r = await pool.query(
      `INSERT INTO mortality_cull_reason_master (reason_id,reason_name,module,created_by) VALUES ($1,$2,$3,$4) RETURNING *`,
      [reason_id||null, reason_name, module, req.user?.username||'admin']
    );
    return res.status(201).json({ success:true, data:r.rows[0] });
  } catch(err) { return res.status(500).json({ success:false, message:err.message }); }
};

exports.updateMortalityCullReason = async (req, res) => {
  const { reason_id, reason_name, module, is_active } = req.body;
  const sets=[]; const vals=[]; let idx=1;
  if (reason_id  !== undefined) { sets.push(`reason_id=$${idx++}`);   vals.push(reason_id); }
  if (reason_name!== undefined) { sets.push(`reason_name=$${idx++}`); vals.push(reason_name); }
  if (module     !== undefined) { sets.push(`module=$${idx++}`);      vals.push(module); }
  if (is_active  !== undefined) { sets.push(`is_active=$${idx++}`);   vals.push(is_active); }
  if (!sets.length) return res.status(400).json({ success:false, message:'Nothing to update' });
  sets.push(`updated_at=NOW()`); vals.push(req.params.id);
  const r = await pool.query(`UPDATE mortality_cull_reason_master SET ${sets.join(',')} WHERE id=$${idx} RETURNING *`, vals);
  if (r.rowCount===0) return res.status(404).json({ success:false, message:'Not found' });
  return res.json({ success:true, data:r.rows[0] });
};

exports.deleteMortalityCullReason = async (req, res) => {
  await pool.query(`UPDATE mortality_cull_reason_master SET is_active=FALSE WHERE id=$1`,[req.params.id]);
  return res.json({ success:true, message:'Deleted' });
};

// ═══════════════════════════════════════════════════════════════════════════
// BIRD GRADING MASTER
// ═══════════════════════════════════════════════════════════════════════════

exports.getBirdGrading = async (req, res) => {
  const r = await pool.query(`SELECT * FROM bird_grading_master WHERE is_active=TRUE ORDER BY created_at DESC`);
  return res.json({ success:true, total:r.rowCount, data:r.rows });
};

exports.addBirdGrading = async (req, res) => {
  const { doc_no, doc_date, start_date, end_date, age_in_weeks } = req.body;
  if (!doc_no) return res.status(422).json({ success:false, message:'doc_no required' });
  try {
    const r = await pool.query(
      `INSERT INTO bird_grading_master (doc_no,doc_date,start_date,end_date,age_in_weeks,created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [doc_no, doc_date||null, start_date||null, end_date||null, age_in_weeks||null, req.user?.username||'admin']
    );
    return res.status(201).json({ success:true, data:r.rows[0] });
  } catch(err) { return res.status(500).json({ success:false, message:err.message }); }
};

exports.updateBirdGrading = async (req, res) => {
  const { doc_no, doc_date, start_date, end_date, age_in_weeks, is_active } = req.body;
  const sets=[]; const vals=[]; let idx=1;
  if (doc_no      !== undefined) { sets.push(`doc_no=$${idx++}`);      vals.push(doc_no); }
  if (doc_date    !== undefined) { sets.push(`doc_date=$${idx++}`);    vals.push(doc_date); }
  if (start_date  !== undefined) { sets.push(`start_date=$${idx++}`);  vals.push(start_date); }
  if (end_date    !== undefined) { sets.push(`end_date=$${idx++}`);    vals.push(end_date); }
  if (age_in_weeks!== undefined) { sets.push(`age_in_weeks=$${idx++}`);vals.push(age_in_weeks); }
  if (is_active   !== undefined) { sets.push(`is_active=$${idx++}`);   vals.push(is_active); }
  if (!sets.length) return res.status(400).json({ success:false, message:'Nothing to update' });
  sets.push(`updated_at=NOW()`); vals.push(req.params.id);
  const r = await pool.query(`UPDATE bird_grading_master SET ${sets.join(',')} WHERE id=$${idx} RETURNING *`, vals);
  return res.json({ success:true, data:r.rows[0] });
};

exports.deleteBirdGrading = async (req, res) => {
  await pool.query(`UPDATE bird_grading_master SET is_active=FALSE WHERE id=$1`,[req.params.id]);
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
    const r = await pool.query(
      `INSERT INTO egg_grading_master (grading_id,grading_name,short_code,created_by) VALUES ($1,$2,$3,$4) RETURNING *`,
      [grading_id||null, grading_name, short_code||null, req.user?.username||'admin']
    );
    return res.status(201).json({ success:true, data:r.rows[0] });
  } catch(err) { return res.status(500).json({ success:false, message:err.message }); }
};

exports.updateEggGrading = async (req, res) => {
  const { grading_id, grading_name, short_code, is_active } = req.body;
  const sets=[]; const vals=[]; let idx=1;
  if (grading_id  !== undefined) { sets.push(`grading_id=$${idx++}`);   vals.push(grading_id); }
  if (grading_name!== undefined) { sets.push(`grading_name=$${idx++}`); vals.push(grading_name); }
  if (short_code  !== undefined) { sets.push(`short_code=$${idx++}`);   vals.push(short_code); }
  if (is_active   !== undefined) { sets.push(`is_active=$${idx++}`);    vals.push(is_active); }
  if (!sets.length) return res.status(400).json({ success:false, message:'Nothing to update' });
  sets.push(`updated_at=NOW()`); vals.push(req.params.id);
  const r = await pool.query(`UPDATE egg_grading_master SET ${sets.join(',')} WHERE id=$${idx} RETURNING *`, vals);
  return res.json({ success:true, data:r.rows[0] });
};

exports.deleteEggGrading = async (req, res) => {
  await pool.query(`UPDATE egg_grading_master SET is_active=FALSE WHERE id=$1`,[req.params.id]);
  return res.json({ success:true, message:'Deleted' });
};
