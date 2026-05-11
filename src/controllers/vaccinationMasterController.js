const pool = require('../config/db');
const XLSX = require('xlsx');
const path = require('path');
const fs   = require('fs');

// ═══════════════════════════════════════════════════════════════════════════
// HEADER APIs
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/vaccination-master/programs
exports.getAllPrograms = async (req, res) => {
  try {
    const { is_active, season } = req.query;
    let where = [];
    let params = [];
    let idx = 1;

    if (is_active !== undefined) { where.push(`h.is_active=$${idx++}`); params.push(is_active === 'true'); }
    if (season)     { where.push(`h.season=$${idx++}`);    params.push(season); }

    const result = await pool.query(`
      SELECT h.*,
             COUNT(d.id) AS total_entries,
             COUNT(CASE WHEN d.category='vaccine'    THEN 1 END) AS vaccine_count,
             COUNT(CASE WHEN d.category='antibiotic' THEN 1 END) AS antibiotic_count,
             COUNT(CASE WHEN d.category='activity'   THEN 1 END) AS activity_count
      FROM vaccination_program_header h
      LEFT JOIN vaccination_program_detail d ON d.header_id = h.id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      GROUP BY h.id
      ORDER BY h.created_at DESC
    `, params);

    return res.json({ success: true, total: result.rowCount, data: result.rows });
  } catch (err) {
    console.error('[getAllPrograms]', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/vaccination-master/programs/:id
exports.getProgramById = async (req, res) => {
  try {
    const { id } = req.params;

    const header = await pool.query(
      `SELECT * FROM vaccination_program_header WHERE id=$1`, [id]
    );
    if (header.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Program not found' });
    }

    const details = await pool.query(`
      SELECT * FROM vaccination_program_detail
      WHERE header_id=$1
      ORDER BY day_number, s_no
    `, [id]);

    return res.json({
      success: true,
      data: {
        ...header.rows[0],
        details: details.rows,
      }
    });
  } catch (err) {
    console.error('[getProgramById]', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/vaccination-master/programs
exports.createProgram = async (req, res) => {
  const { program_name, doc_date, start_date, end_date, season, remarks } = req.body;

  if (!program_name) {
    return res.status(422).json({ success: false, message: 'program_name is required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query(`
      INSERT INTO vaccination_program_header
        (program_name, doc_date, start_date, end_date, season, remarks, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING *
    `, [
      program_name, doc_date||null, start_date||null, end_date||null,
      season||'all', remarks||null,
      req.user?.username || 'admin'
    ]);

    await client.query('COMMIT');
    return res.status(201).json({ success: true, message: 'Program created', data: result.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[createProgram]', err.message);
    return res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
};

// PUT /api/vaccination-master/programs/:id
exports.updateProgram = async (req, res) => {
  const { id } = req.params;
  const { program_name, doc_date, start_date, end_date, season, remarks, is_active } = req.body;

  try {
    const sets   = [];
    const vals   = [];
    let   idx    = 1;

    if (program_name !== undefined) { sets.push(`program_name=$${idx++}`); vals.push(program_name); }
    if (doc_date     !== undefined) { sets.push(`doc_date=$${idx++}`);     vals.push(doc_date); }
    if (start_date   !== undefined) { sets.push(`start_date=$${idx++}`);   vals.push(start_date); }
    if (end_date     !== undefined) { sets.push(`end_date=$${idx++}`);     vals.push(end_date); }
    if (season       !== undefined) { sets.push(`season=$${idx++}`);       vals.push(season); }
    if (remarks      !== undefined) { sets.push(`remarks=$${idx++}`);      vals.push(remarks); }
    if (is_active    !== undefined) { sets.push(`is_active=$${idx++}`);    vals.push(is_active); }

    if (!sets.length) return res.status(400).json({ success: false, message: 'Nothing to update' });

    sets.push(`updated_by=$${idx++}`); vals.push(req.user?.username || 'admin');
    sets.push(`updated_at=NOW()`);
    vals.push(id);

    const result = await pool.query(
      `UPDATE vaccination_program_header SET ${sets.join(',')} WHERE id=$${idx} RETURNING *`,
      vals
    );

    if (result.rowCount === 0) return res.status(404).json({ success: false, message: 'Program not found' });
    return res.json({ success: true, message: 'Updated', data: result.rows[0] });
  } catch (err) {
    console.error('[updateProgram]', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// DELETE /api/vaccination-master/programs/:id
exports.deleteProgram = async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE vaccination_program_header SET is_active=FALSE, updated_at=NOW() WHERE id=$1 RETURNING id, program_name`,
      [req.params.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ success: false, message: 'Program not found' });
    return res.json({ success: true, message: 'Program deactivated', data: result.rows[0] });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// DETAIL APIs
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/vaccination-master/programs/:id/details
exports.getProgramDetails = async (req, res) => {
  try {
    const { category, day_from, day_to } = req.query;
    let where = [`header_id=$1`];
    let params = [req.params.id];
    let idx = 2;

    if (category)  { where.push(`category=$${idx++}`);           params.push(category); }
    if (day_from)  { where.push(`day_number>=$${idx++}`);        params.push(parseInt(day_from)); }
    if (day_to)    { where.push(`day_number<=$${idx++}`);        params.push(parseInt(day_to)); }

    const result = await pool.query(`
      SELECT * FROM vaccination_program_detail
      WHERE ${where.join(' AND ')}
      ORDER BY day_number, s_no
    `, params);

    return res.json({ success: true, total: result.rowCount, data: result.rows });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/vaccination-master/programs/:id/details  (add single detail line)
exports.addDetail = async (req, res) => {
  const { header_id } = { header_id: req.params.id };
  const {
    s_no, day_number, week_number, disease, vaccine_name,
    vaccine_type, manufacturer, dose, route, category
  } = req.body;

  if (!day_number) return res.status(422).json({ success: false, message: 'day_number is required' });

  try {
    const result = await pool.query(`
      INSERT INTO vaccination_program_detail
        (header_id, s_no, day_number, week_number, disease, vaccine_name,
         vaccine_type, manufacturer, dose, route, category)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING *
    `, [header_id, s_no||null, day_number, week_number||null, disease||null,
        vaccine_name||null, vaccine_type||null, manufacturer||null,
        dose||null, route||null, category||'vaccine']);

    return res.status(201).json({ success: true, message: 'Detail added', data: result.rows[0] });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/vaccination-master/programs/:id/details/bulk  (add multiple lines)
exports.addDetailsBulk = async (req, res) => {
  const header_id = req.params.id;
  const { details } = req.body;

  if (!Array.isArray(details) || !details.length) {
    return res.status(422).json({ success: false, message: 'details array required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const saved = [];

    for (const d of details) {
      if (!d.day_number) continue;
      const r = await client.query(`
        INSERT INTO vaccination_program_detail
          (header_id, s_no, day_number, week_number, disease, vaccine_name,
           vaccine_type, manufacturer, dose, route, category)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        RETURNING *
      `, [header_id, d.s_no||null, d.day_number, d.week_number||null,
          d.disease||null, d.vaccine_name||null, d.vaccine_type||null,
          d.manufacturer||null, d.dose||null, d.route||null, d.category||'vaccine']);
      saved.push(r.rows[0]);
    }

    await client.query('COMMIT');
    return res.status(201).json({ success: true, message: `${saved.length} details added`, data: saved });
  } catch (err) {
    await client.query('ROLLBACK');
    return res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
};

// PUT /api/vaccination-master/details/:id
exports.updateDetail = async (req, res) => {
  const { id } = req.params;
  const {
    s_no, day_number, week_number, disease, vaccine_name,
    vaccine_type, manufacturer, dose, route, category, is_active
  } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Get current detail to check if day_number changed
    const currentRes = await client.query(
      `SELECT * FROM vaccination_program_detail WHERE id=$1`, [id]
    );
    if (currentRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Detail not found' });
    }
    const current = currentRes.rows[0];
    const oldDayNumber = current.day_number;
    const newDayNumber = day_number !== undefined ? parseInt(day_number) : oldDayNumber;
    const dayChanged   = newDayNumber !== oldDayNumber;

    // Update the detail row
    const sets = []; const vals = []; let idx = 1;
    if (s_no          !== undefined) { sets.push(`s_no=$${idx++}`);          vals.push(s_no); }
    if (day_number    !== undefined) { sets.push(`day_number=$${idx++}`);    vals.push(day_number); }
    if (week_number   !== undefined) { sets.push(`week_number=$${idx++}`);   vals.push(week_number); }
    if (disease       !== undefined) { sets.push(`disease=$${idx++}`);       vals.push(disease); }
    if (vaccine_name  !== undefined) { sets.push(`vaccine_name=$${idx++}`);  vals.push(vaccine_name); }
    if (vaccine_type  !== undefined) { sets.push(`vaccine_type=$${idx++}`);  vals.push(vaccine_type); }
    if (manufacturer  !== undefined) { sets.push(`manufacturer=$${idx++}`);  vals.push(manufacturer); }
    if (dose          !== undefined) { sets.push(`dose=$${idx++}`);          vals.push(dose); }
    if (route         !== undefined) { sets.push(`route=$${idx++}`);         vals.push(route); }
    if (category      !== undefined) { sets.push(`category=$${idx++}`);      vals.push(category); }
    if (is_active     !== undefined) { sets.push(`is_active=$${idx++}`);     vals.push(is_active); }

    if (!sets.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'Nothing to update' });
    }
    sets.push(`updated_at=NOW()`);
    vals.push(id);

    const result = await client.query(
      `UPDATE vaccination_program_detail SET ${sets.join(',')} WHERE id=$${idx} RETURNING *`,
      vals
    );

    let schedulesUpdated = 0;

    // If day_number changed → update all flock_vaccination_schedule entries for this detail
    if (dayChanged) {
      // Get all schedules for this detail_id
      const schedRes = await client.query(`
        SELECT fvs.id, fvs.flock_no, fvs.chick_start_date
        FROM flock_vaccination_schedule fvs
        WHERE fvs.detail_id = $1
          AND fvs.status = 'pending'
      `, [id]);

      for (const sched of schedRes.rows) {
        const start   = new Date(sched.chick_start_date);
        start.setHours(0,0,0,0);
        const newDue  = new Date(start);
        newDue.setDate(start.getDate() + newDayNumber - 1);
        const newDueStr = newDue.toISOString().split('T')[0];

        await client.query(`
          UPDATE flock_vaccination_schedule
          SET due_date   = $1,
              day_number = $2,
              updated_at = NOW()
          WHERE id = $3
        `, [newDueStr, newDayNumber, sched.id]);

        schedulesUpdated++;
      }
    }

    await client.query('COMMIT');

    return res.json({
      success: true,
      message: dayChanged
        ? `Updated. Day changed ${oldDayNumber}→${newDayNumber}. ${schedulesUpdated} flock schedule(s) updated.`
        : 'Updated',
      data:              result.rows[0],
      day_changed:       dayChanged,
      old_day_number:    oldDayNumber,
      new_day_number:    newDayNumber,
      schedules_updated: schedulesUpdated,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[updateDetail]', err.message);
    return res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
};

// DELETE /api/vaccination-master/details/:id
exports.deleteDetail = async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM vaccination_program_detail WHERE id=$1 RETURNING id, vaccine_name, day_number`,
      [req.params.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ success: false, message: 'Detail not found' });
    return res.json({ success: true, message: 'Detail deleted', data: result.rows[0] });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// EXCEL UPLOAD — POST /api/vaccination-master/programs/:id/upload-excel
// ═══════════════════════════════════════════════════════════════════════════
exports.uploadExcel = async (req, res) => {
  const header_id = req.params.id;

  if (!req.file) {
    return res.status(400).json({ success: false, message: 'Excel file required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const wb   = XLSX.readFile(req.file.path);
    const ws   = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    // Find header row — flexible detection
    let dataStartRow = -1;
    let headerRowIndex = -1;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row || !row.length) continue;
      const rowStr = row.map(c => String(c||'').toLowerCase()).join(' ');
      if (rowStr.includes('days') || rowStr.includes('day') || rowStr.includes('disease') || rowStr.includes('vaccine')) {
        headerRowIndex = i;
        dataStartRow   = i + 1;
        break;
      }
    }
    // If no header found — start from row 0 with positional columns
    if (dataStartRow === -1) dataStartRow = 0;

    const saved = [];
    let   sno   = 1;

    for (let i = dataStartRow; i < rows.length; i++) {
      const row = rows[i];
      if (!row[1] && !row[2]) continue; // skip empty rows

      const dayNum   = parseInt(row[2]) || 0;
      const weekNum  = parseFloat(row[3]) || null;
      const disease  = String(row[5] || '').trim() || null;
      const vname    = String(row[8] || '').trim() || null;
      const vtype    = String(row[9] || '').trim() || null;
      const maker    = String(row[10]|| '').trim() || null;
      const dose     = String(row[11]|| '').trim() || null;
      const route    = String(row[12]|| '').trim() || null;

      if (!dayNum) continue;

      // Determine category
      let category = 'vaccine';
      const lower  = (disease + ' ' + vname).toLowerCase();
      if (lower.includes('amp') || lower.includes('antibiotic')) category = 'antibiotic';
      else if (lower.includes('debeak') || lower.includes('grading') ||
               lower.includes('transfer') || lower.includes('deworming')) category = 'activity';

      // Normalize vaccine type
      let normalizedType = null;
      if (vtype === 'K' || vtype.toLowerCase() === 'killed') normalizedType = 'Killed';
      else if (vtype.toLowerCase() === 'live') normalizedType = 'Live';
      else if (category === 'antibiotic') normalizedType = 'Antibiotic';
      else if (category === 'activity')   normalizedType = 'Activity';

      const r = await client.query(`
        INSERT INTO vaccination_program_detail
          (header_id, s_no, day_number, week_number, disease, vaccine_name,
           vaccine_type, manufacturer, dose, route, category)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        RETURNING id
      `, [header_id, sno, dayNum, weekNum, disease, vname,
          normalizedType, maker||null, dose||null, route||null, category]);

      saved.push(r.rows[0].id);
      sno++;
    }

    // Clean up uploaded file
    fs.unlinkSync(req.file.path);

    await client.query('COMMIT');
    return res.status(201).json({
      success: true,
      message: `${saved.length} records imported from Excel`,
      imported: saved.length,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    if (req.file?.path) try { fs.unlinkSync(req.file.path); } catch(_) {}
    console.error('[uploadExcel]', err.message);
    return res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
};

// GET /api/vaccination-master/template  — Download Excel template
exports.downloadTemplate = async (req, res) => {
  try {
    const wb = XLSX.utils.book_new();

    // Template headers
    const headers = [
      'S.No', 'Days', 'Wk', 'Disease', 'Vaccine Name',
      'Type (Live/Killed/Antibiotic/Activity)', 'Manufacturer',
      'Dose', 'Route (Eye Drop/S/C Neck/I/M Right/I/M Left/D/W/W/W)',
      'Category (vaccine/antibiotic/activity)'
    ];

    // Sample rows
    const sampleData = [
      [1, 1,   0.1, 'IB L V - 1',   'IB H120',             'Live',       'Phibro', '0.03ml', 'Eye Drop', 'vaccine'],
      [2, 7,   1.0, 'ND B1',         'ND B1',               'Live',       'Ventri', '0.03ml', 'Eye Drop', 'vaccine'],
      [3, 9,   1.3, 'Debeak - 1/2',  'Beak Debeaking',      'Activity',   '',       '',        '',        'activity'],
      [4, 13,  1.9, 'AMP. 5Days',    'AMP.20mg/kg',         'Antibiotic', 'Elanco', '',        'D/W',     'antibiotic'],
      [5, 14,  2.0, 'IBH K - 1/7',   'IBH Killed',          'Killed',     'Ventri', '0.3ml',   'S/C Neck','vaccine'],
    ];

    const wsData = [headers, ...sampleData];
    const ws     = XLSX.utils.aoa_to_sheet(wsData);

    // Column widths
    ws['!cols'] = [
      { wch: 6 }, { wch: 6 }, { wch: 6 }, { wch: 25 }, { wch: 30 },
      { wch: 35 }, { wch: 15 }, { wch: 10 }, { wch: 40 }, { wch: 20 }
    ];

    XLSX.utils.book_append_sheet(wb, ws, 'Vaccination Program');

    // Instructions sheet
    const instrData = [
      ['KRISHI Vaccination Program Upload Template'],
      [''],
      ['INSTRUCTIONS:'],
      ['1. Fill in all rows starting from row 2'],
      ['2. Days = age of bird in days (1, 3, 7, 12...)'],
      ['3. Wk = week number (0.1, 1, 1.7...)'],
      ['4. Type: Live / Killed / Antibiotic / Activity'],
      ['5. Route: Eye Drop / S/C Neck / I/M Right / I/M Left / D/W / W/W'],
      ['6. Category: vaccine / antibiotic / activity'],
      ['7. Do NOT change column order'],
      ['8. Upload to: POST /api/vaccination-master/programs/:id/upload-excel'],
    ];
    const wsInstr = XLSX.utils.aoa_to_sheet(instrData);
    wsInstr['!cols'] = [{ wch: 60 }];
    XLSX.utils.book_append_sheet(wb, wsInstr, 'Instructions');

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Disposition', 'attachment; filename=vaccination_program_template.xlsx');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    return res.send(buffer);
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};
