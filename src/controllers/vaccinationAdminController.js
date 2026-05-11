const pool = require('../config/db');
const XLSX = require('xlsx');
const path = require('path');
const fs   = require('fs');
const { generateVaccinationSchedule } = require('./vaccinationScheduleController');

// ═══════════════════════════════════════════════════════════════════════════
// SCREEN 1 APIs — Vaccination Program Management (Version Control)
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/vaccination-admin/programs/:id/details
// Tap a program in list → load all detail rows for that program
exports.getProgramWithDetails = async (req, res) => {
  const { id } = req.params;
  const { category, day_from, day_to } = req.query;
  try {
    // Get header
    const hRes = await pool.query(`SELECT * FROM vaccination_program_header WHERE id=$1`, [id]);
    if (hRes.rowCount === 0) return res.status(404).json({ success:false, message:'Program not found' });

    // Get details with filters
    let where = [`header_id=$1`];
    let params = [id];
    let idx = 2;
    if (category) { where.push(`category=$${idx++}`);         params.push(category); }
    if (day_from) { where.push(`day_number>=$${idx++}`);      params.push(parseInt(day_from)); }
    if (day_to)   { where.push(`day_number<=$${idx++}`);      params.push(parseInt(day_to)); }

    const dRes = await pool.query(`
      SELECT * FROM vaccination_program_detail
      WHERE ${where.join(' AND ')}
      ORDER BY day_number, s_no
    `, params);

    return res.json({
      success: true,
      program: {
        ...hRes.rows[0],
        status_label: hRes.rows[0].is_current ? '🟢 Active (Current)' : '⚫ Inactive',
      },
      total_details: dRes.rowCount,
      details: dRes.rows,
    });
  } catch (err) {
    return res.status(500).json({ success:false, message:err.message });
  }
};

// POST /api/vaccination-admin/programs/:id/details
// Add new detail line to existing program
// Also auto-generates schedule entries for all active flocks using this program
exports.addDetailLine = async (req, res) => {
  const header_id = req.params.id;
  const {
    s_no, day_number, week_number, disease, vaccine_name,
    vaccine_type, manufacturer, dose, route, category
  } = req.body;

  if (!day_number) return res.status(422).json({ success:false, message:'day_number required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Check program exists
    const hRes = await client.query(`SELECT * FROM vaccination_program_header WHERE id=$1`, [header_id]);
    if (hRes.rowCount === 0) return res.status(404).json({ success:false, message:'Program not found' });

    // Get next s_no
    const maxSno = await client.query(
      `SELECT COALESCE(MAX(s_no),0)+1 AS next_sno FROM vaccination_program_detail WHERE header_id=$1`,
      [header_id]
    );
    const nextSno = s_no || maxSno.rows[0].next_sno;

    // Insert new detail
    const detailRes = await client.query(`
      INSERT INTO vaccination_program_detail
        (header_id, s_no, day_number, week_number, disease, vaccine_name,
         vaccine_type, manufacturer, dose, route, category, is_active)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,TRUE)
      RETURNING *
    `, [
      header_id, nextSno, day_number, week_number||null,
      disease||null, vaccine_name||null, vaccine_type||null,
      manufacturer||null, dose||null, route||null, category||'vaccine'
    ]);

    const newDetail = detailRes.rows[0];

    // Auto-generate schedule entries for all active flocks using this program
    const flocksRes = await client.query(`
      SELECT DISTINCT fvs.flock_no, fvs.plant_code, fvs.chick_start_date
      FROM flock_vaccination_schedule fvs
      WHERE fvs.header_id = $1
    `, [header_id]);

    let schedulesCreated = 0;
    for (const flock of flocksRes.rows) {
      const start  = new Date(flock.chick_start_date);
      start.setHours(0,0,0,0);
      const dueDate = new Date(start);
      dueDate.setDate(start.getDate() + day_number - 1);
      const dueDateStr = dueDate.toISOString().split('T')[0];

      await client.query(`
        INSERT INTO flock_vaccination_schedule
          (flock_no, plant_code, header_id, detail_id, chick_start_date, due_date, day_number, status)
        VALUES ($1,$2,$3,$4,$5,$6,$7,'pending')
        ON CONFLICT (flock_no, detail_id, due_date) DO NOTHING
      `, [flock.flock_no, flock.plant_code, header_id, newDetail.id, flock.chick_start_date, dueDateStr, day_number]);
      schedulesCreated++;
    }

    await client.query('COMMIT');

    return res.status(201).json({
      success: true,
      message: `New detail line added. ${schedulesCreated} flock schedule(s) updated.`,
      data:              newDetail,
      schedules_created: schedulesCreated,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[addDetailLine]', err.message);
    return res.status(500).json({ success:false, message:err.message });
  } finally {
    client.release();
  }
};

// GET /api/vaccination-admin/programs
// List all programs — only ONE is current/active at a time
exports.getAllPrograms = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT h.*,
             COUNT(d.id)                                          AS total_entries,
             COUNT(CASE WHEN d.category='vaccine'    THEN 1 END) AS vaccine_count,
             COUNT(CASE WHEN d.category='antibiotic' THEN 1 END) AS antibiotic_count,
             COUNT(CASE WHEN d.category='activity'   THEN 1 END) AS activity_count
      FROM vaccination_program_header h
      LEFT JOIN vaccination_program_detail d ON d.header_id = h.id AND d.is_active = TRUE
      GROUP BY h.id
      ORDER BY h.version_no DESC, h.created_at DESC
    `);

    // Ensure only one is marked current
    const programs = result.rows;
    const currentCount = programs.filter(p => p.is_current).length;
    if (currentCount > 1) {
      // Fix: keep only latest as current
      const latestId = programs.find(p => p.is_current)?.id;
      await pool.query(
        `UPDATE vaccination_program_header SET is_current=FALSE WHERE id != $1 AND is_current=TRUE`,
        [latestId]
      );
      programs.forEach((p, i) => {
        if (p.is_current && p.id !== latestId) programs[i].is_current = false;
      });
    }

    return res.json({
      success: true,
      total:   result.rowCount,
      current_program_id: programs.find(p => p.is_current)?.id || null,
      data:    programs.map(p => ({
        ...p,
        status_label: p.is_current ? '🟢 Active (Current)' : '⚫ Inactive',
      }))
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/vaccination-admin/programs/current
// Returns the currently active program
exports.getCurrentProgram = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT h.*, COUNT(d.id) AS total_entries
      FROM vaccination_program_header h
      LEFT JOIN vaccination_program_detail d ON d.header_id = h.id
      WHERE h.is_current = TRUE AND h.is_active = TRUE
      GROUP BY h.id
      ORDER BY h.version_no DESC LIMIT 1
    `);
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'No active vaccination program found' });
    }
    // Get details
    const details = await pool.query(`
      SELECT * FROM vaccination_program_detail
      WHERE header_id=$1 AND is_active=TRUE
      ORDER BY day_number, s_no
    `, [result.rows[0].id]);

    return res.json({
      success: true,
      data: { ...result.rows[0], details: details.rows }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/vaccination-admin/programs/upload-new-version
// Upload new Excel vaccination program — sets start_date, auto-closes previous
// Form-data: file (xlsx), program_name, start_date, season, remarks
exports.uploadNewVersion = async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: 'Excel file required' });

  const { program_name, start_date, season, remarks } = req.body;
  if (!program_name) return res.status(422).json({ success: false, message: 'program_name required' });
  if (!start_date)   return res.status(422).json({ success: false, message: 'start_date required — new program starts from this date' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Get current active program — will be ended
    const currentRes = await client.query(`
      SELECT id, version_no, program_name, effective_from
      FROM vaccination_program_header
      WHERE is_current = TRUE AND is_active = TRUE
      ORDER BY version_no DESC LIMIT 1
    `);

    const newVersionNo = currentRes.rowCount > 0
      ? (currentRes.rows[0].version_no || 1) + 1
      : 1;

    // Close previous program — set end date = start_date - 1
    if (currentRes.rowCount > 0) {
      const prevEndDate = new Date(start_date);
      prevEndDate.setDate(prevEndDate.getDate() - 1);
      await client.query(`
        UPDATE vaccination_program_header
        SET is_current    = FALSE,
            effective_to  = $1,
            updated_by    = $2,
            updated_at    = NOW()
        WHERE id = $3
      `, [prevEndDate.toISOString().split('T')[0], req.user?.username || 'admin', currentRes.rows[0].id]);
    }

    // Create new program header
    const headerRes = await client.query(`
      INSERT INTO vaccination_program_header
        (program_name, doc_date, effective_from, season, remarks,
         is_active, is_current, version_no, created_by)
      VALUES ($1, CURRENT_DATE, $2, $3, $4, TRUE, TRUE, $5, $6)
      RETURNING *
    `, [
      program_name, start_date,
      season || 'all', remarks || null,
      newVersionNo, req.user?.username || 'admin'
    ]);

    const newHeaderId = headerRes.rows[0].id;

    // Parse Excel file
    const wb   = XLSX.readFile(req.file.path);
    const ws   = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    // Find header row — scan all rows, find first row that has 'days' anywhere
    let dataStartRow = -1;
    let headerRowIndex = -1;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row || !row.length) continue;
      const rowStr = row.map(c => String(c||'').toLowerCase().trim()).join(' ');
      if (rowStr.includes('days') || rowStr.includes('day') || rowStr.includes('disease') || rowStr.includes('vaccine')) {
        headerRowIndex = i;
        dataStartRow   = i + 1;
        break;
      }
    }

    // If no header row found — treat entire sheet as data starting row 0
    // Use positional columns as fallback
    const usePositional = dataStartRow === -1;
    if (usePositional) dataStartRow = 0;

    // Detect column positions from header row (if found)
    let colIdx = { sno:0, days:1, wk:2, disease:3, vname:4, vtype:5, maker:6, dose:7, route:8 };

    if (!usePositional && headerRowIndex >= 0) {
      const headerRow = rows[headerRowIndex].map(c => String(c||'').toLowerCase().trim());
      const find = (...keywords) => {
        const idx = headerRow.findIndex(c => keywords.some(k => c.includes(k)));
        return idx >= 0 ? idx : -1;
      };
      const detected = {
        sno:     find('s.no','s. no','sno','sl','serial'),
        days:    find('days','day','age'),
        wk:      find('wk','week'),
        disease: find('disease','dis'),
        vname:   find('vaccine','vaccin','name of'),
        vtype:   find('type'),
        maker:   find('make','manufacturer','company','mfg'),
        dose:    find('dose'),
        route:   find('route','via'),
      };
      // Only override if detected positively
      Object.keys(detected).forEach(k => {
        if (detected[k] >= 0) colIdx[k] = detected[k];
      });
    }

    const saved = [];
    let sno = 1;

    for (let i = dataStartRow; i < rows.length; i++) {
      const row = rows[i];
      if (!row || !row[colIdx.days]) continue;

      const dayNum  = parseInt(row[colIdx.days]) || 0;
      if (!dayNum) continue;

      const weekNum = parseFloat(row[colIdx.wk]) || null;
      const disease = String(row[colIdx.disease] || '').trim() || null;
      const vname   = String(row[colIdx.vname]   || '').trim() || null;
      const vtype   = String(row[colIdx.vtype]   || '').trim() || null;
      const maker   = String(row[colIdx.maker]   || '').trim() || null;
      const dose    = String(row[colIdx.dose]    || '').trim() || null;
      const route   = String(row[colIdx.route]   || '').trim() || null;

      // Determine category
      let category = 'vaccine';
      const lower  = ((disease||'') + ' ' + (vname||'')).toLowerCase();
      if (lower.includes('amp') || lower.includes('antibiotic')) category = 'antibiotic';
      else if (lower.includes('debeak') || lower.includes('grading') ||
               lower.includes('transfer') || lower.includes('deworming')) category = 'activity';

      // Normalize vaccine type
      let normalizedType = null;
      if (vtype === 'K' || vtype.toLowerCase() === 'killed')       normalizedType = 'Killed';
      else if (vtype.toLowerCase() === 'live')                      normalizedType = 'Live';
      else if (category === 'antibiotic')                           normalizedType = 'Antibiotic';
      else if (category === 'activity')                             normalizedType = 'Activity';
      else if (vtype && vtype.trim() !== '')                        normalizedType = vtype;

      const r = await client.query(`
        INSERT INTO vaccination_program_detail
          (header_id, s_no, day_number, week_number, disease, vaccine_name,
           vaccine_type, manufacturer, dose, route, category, is_active)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,TRUE)
        RETURNING id
      `, [newHeaderId, sno, dayNum, weekNum, disease, vname,
          normalizedType, maker||null, dose||null, route||null, category]);

      saved.push(r.rows[0].id);
      sno++;
    }

    // Clean up file
    try { fs.unlinkSync(req.file.path); } catch(_) {}

    await client.query('COMMIT');

    return res.status(201).json({
      success: true,
      message: `✅ New vaccination program v${newVersionNo} created. ${saved.length} records imported.`,
      new_program: {
        id:           newHeaderId,
        version_no:   newVersionNo,
        program_name,
        effective_from: start_date,
        records_imported: saved.length,
      },
      previous_program: currentRes.rowCount > 0 ? {
        id:           currentRes.rows[0].id,
        program_name: currentRes.rows[0].program_name,
        effective_to: new Date(new Date(start_date) - 86400000).toISOString().split('T')[0],
        status:       'closed',
      } : null,
      note: `All NEW flocks created from ${start_date} onwards will use this program. Existing flocks continue with their assigned program.`
    });
  } catch (err) {
    await client.query('ROLLBACK');
    try { if (req.file?.path) fs.unlinkSync(req.file.path); } catch(_) {}
    console.error('[uploadNewVersion]', err.message);
    return res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// SCREEN 2 APIs — Admin Missed Entry (Flock Grid View)
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/vaccination-admin/flock-dropdown?plant_code=1902
// Returns all active flocks for dropdown
exports.getFlockDropdown = async (req, res) => {
  const { plant_code } = req.query;
  try {
    let q = `
      SELECT fm.flock_no, fm.flock_name, fm.farm_code, fm.farm_name,
             fm.hatchery_date, fm.document_date,
             vph.id AS program_id, vph.program_name, vph.version_no
      FROM flock_master fm
      LEFT JOIN flock_vaccination_schedule fvs ON fvs.flock_no = fm.flock_no
      LEFT JOIN vaccination_program_header vph ON vph.id = fvs.header_id
      WHERE fm.status = 'A' AND fm.deletion_flag != 'X'
    `;
    const params = [];
    if (plant_code) { q += ` AND fm.farm_code = $1`; params.push(plant_code); }
    q += ` GROUP BY fm.flock_no, fm.flock_name, fm.farm_code, fm.farm_name,
                    fm.hatchery_date, fm.document_date, vph.id, vph.program_name, vph.version_no
           ORDER BY fm.flock_no`;

    const result = await pool.query(q, params);
    return res.json({
      success: true,
      total:   result.rowCount,
      data:    result.rows.map(r => ({
        flock_no:        r.flock_no,
        flock_name:      r.flock_name || r.flock_no,
        farm_code:       r.farm_code,
        farm_name:       r.farm_name,
        hatchery_date:   r.hatchery_date,
        document_date:   r.document_date,
        program_name:    r.program_name || 'Not assigned',
        version_no:      r.version_no,
        label:           `${r.flock_no} — ${r.flock_name || r.flock_no}`,
      }))
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/vaccination-admin/flock-grid/:flock_no
// Returns full vaccination grid for a flock — like the Excel screenshot
// Header info + all schedule rows with status
exports.getFlockGrid = async (req, res) => {
  const { flock_no } = req.params;
  const today = new Date().toISOString().split('T')[0];

  try {
    // Get flock info
    const flockRes = await pool.query(`
      SELECT fm.*, vph.program_name, vph.version_no, vph.id AS program_id,
             (fm.hatchery_date + INTERVAL '503 days')::date AS flock_end_date
      FROM flock_master fm
      LEFT JOIN flock_vaccination_schedule fvs ON fvs.flock_no = fm.flock_no
      LEFT JOIN vaccination_program_header vph ON vph.id = fvs.header_id
      WHERE fm.flock_no = $1
      GROUP BY fm.flock_no, fm.flock_name, fm.farm_code, fm.farm_name,
               fm.hatchery_date, fm.document_date, fm.batch, fm.status,
               fm.deletion_flag, fm.sap_user, fm.sap_time, fm.source,
               fm.created_at, fm.updated_at, fm.id,
               vph.program_name, vph.version_no, vph.id
    `, [flock_no]);

    if (flockRes.rowCount === 0) {
      return res.status(404).json({ success: false, message: `Flock ${flock_no} not found` });
    }

    const flock = flockRes.rows[0];

    // Get full vaccination schedule with log data
    const schedRes = await pool.query(`
      SELECT
        fvs.id            AS schedule_id,
        fvs.day_number,
        fvs.due_date,
        fvs.status,
        fvs.completed_at,
        vpd.s_no,
        vpd.week_number   AS wk,
        vpd.disease,
        vpd.vaccine_name,
        vpd.vaccine_type  AS type,
        vpd.manufacturer  AS make,
        vpd.dose,
        vpd.route,
        vpd.category,
        fvl.done_date,
        fvl.remarks       AS log_remarks,
        fvl.supervisor_id,
        a.first_name || ' ' || a.last_name AS supervisor_name
      FROM flock_vaccination_schedule fvs
      JOIN vaccination_program_detail vpd ON vpd.id = fvs.detail_id
      LEFT JOIN flock_vaccination_log fvl  ON fvl.schedule_id = fvs.id
      LEFT JOIN admin a                    ON a.id = fvl.supervisor_id
      WHERE fvs.flock_no = $1
      ORDER BY fvs.day_number, vpd.s_no
    `, [flock_no]);

    // Build grid rows with editable flags
    const gridRows = schedRes.rows.map(row => {
      const dueDate = row.due_date instanceof Date
        ? row.due_date.toISOString().split('T')[0]
        : String(row.due_date).split('T')[0];

      const isPast   = dueDate < today;
      const isToday  = dueDate === today;
      const isFuture = dueDate > today;

      // Editable: past dates with no entry OR today with no entry
      // Disabled: future dates OR already entered
      const isEntered  = ['vaccinated','skipped','no_vaccination'].includes(row.status);
      const isEditable = (isPast || isToday) && !isEntered;
      const isDisabled = isFuture || isEntered;

      return {
        schedule_id:    row.schedule_id,
        s_no:           row.s_no,
        days:           row.day_number,
        wk:             row.wk,
        due_date:       dueDate,
        disease:        row.disease,
        vaccine_name:   row.vaccine_name,
        type:           row.type,
        make:           row.make,
        dose:           row.dose,
        route:          row.route,
        category:       row.category,
        // Status
        status:         row.status,
        done_date:      row.done_date || null,
        remarks:        row.log_remarks || null,
        supervisor:     row.supervisor_name || null,
        // UI flags
        is_past:        isPast,
        is_today:       isToday,
        is_future:      isFuture,
        is_entered:     isEntered,
        is_editable:    isEditable,   // show input fields
        is_disabled:    isDisabled,   // grey out row
      };
    });

    // Summary
    const summary = {
      total:           gridRows.length,
      vaccinated:      gridRows.filter(r => r.status === 'vaccinated').length,
      not_vaccinated:  gridRows.filter(r => r.status === 'not_vaccinated').length,
      pending_past:    gridRows.filter(r => r.is_past && !r.is_entered).length,
      pending_today:   gridRows.filter(r => r.is_today && !r.is_entered).length,
      future:          gridRows.filter(r => r.is_future).length,
    };

    return res.json({
      success:    true,
      flock_no:   flock.flock_no,
      flock_name: flock.flock_name,
      farm_code:  flock.farm_code,
      hatchery_date:   flock.hatchery_date,
      flock_end_date:  flock.flock_end_date,
      program_name:    flock.program_name,
      version_no:      flock.version_no,
      summary,
      // Grid columns: s_no | days | wk | due_date | disease | vaccine_name | type | make | dose | route | done_date | action | remarks
      // is_editable=true → show action dropdown + remarks input
      // is_disabled=true → grey out row (future or already entered)
      grid: gridRows,
    });
  } catch (err) {
    console.error('[getFlockGrid]', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/vaccination-admin/record-missed
// Admin enters missed vaccination data
// Body: { schedule_id, status, remarks, done_date }
exports.recordMissedEntry = async (req, res) => {
  const { schedule_id, status, remarks, done_date } = req.body;

  if (!schedule_id) return res.status(422).json({ success: false, message: 'schedule_id required' });
  if (!status || !['vaccinated', 'skipped', 'no_vaccination'].includes(status)) {
    return res.status(422).json({ success: false, message: 'status must be: vaccinated / skipped / no_vaccination' });
  }
  if (['skipped', 'no_vaccination'].includes(status) && (!remarks || remarks.trim() === '')) {
    return res.status(422).json({ success: false, message: 'remarks required when status is skipped or no_vaccination' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Get schedule row
    const schedRes = await client.query(`
      SELECT fvs.*, vpd.vaccine_name, vpd.disease
      FROM flock_vaccination_schedule fvs
      JOIN vaccination_program_detail vpd ON vpd.id = fvs.detail_id
      WHERE fvs.id = $1
    `, [schedule_id]);

    if (schedRes.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Schedule entry not found' });
    }

    const sched   = schedRes.rows[0];
    const today   = new Date().toISOString().split('T')[0];
    const dueDate = sched.due_date instanceof Date
      ? sched.due_date.toISOString().split('T')[0]
      : String(sched.due_date).split('T')[0];

    // Cannot enter future dates
    if (dueDate > today) {
      return res.status(400).json({
        success: false,
        message: `Cannot enter data for future date ${dueDate}. This row is disabled.`
      });
    }

    // Cannot re-enter already entered data
    if (['vaccinated','skipped','no_vaccination'].includes(sched.status)) {
      return res.status(400).json({
        success: false,
        message: `Already entered as ${sched.status}. Cannot edit.`
      });
    }

    // Insert log
    await client.query(`
      INSERT INTO flock_vaccination_log
        (schedule_id, flock_no, plant_code, detail_id, due_date,
         day_number, status, remarks, done_date, supervisor_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    `, [
      schedule_id, sched.flock_no, sched.plant_code, sched.detail_id,
      sched.due_date, sched.day_number, status,
      remarks || null, done_date || today, req.user?.id || null
    ]);

    // Update schedule status
    await client.query(`
      UPDATE flock_vaccination_schedule
      SET status=$1, completed_at=NOW(), updated_at=NOW()
      WHERE id=$2
    `, [status, schedule_id]);

    await client.query('COMMIT');

    return res.status(201).json({
      success:      true,
      message:      `✅ Missed entry recorded — ${sched.flock_no} Day ${sched.day_number} ${sched.vaccine_name} → ${status}`,
      schedule_id,
      flock_no:     sched.flock_no,
      vaccine_name: sched.vaccine_name,
      due_date:     dueDate,
      status,
      remarks:      remarks || null,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[recordMissedEntry]', err.message);
    return res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
};

// POST /api/vaccination-admin/record-missed/bulk
// Admin enters multiple missed rows at once
// Body: { entries: [{ schedule_id, status, remarks, done_date }] }
exports.recordMissedBulk = async (req, res) => {
  const { entries } = req.body;
  if (!Array.isArray(entries) || !entries.length) {
    return res.status(422).json({ success: false, message: 'entries array required' });
  }

  const today   = new Date().toISOString().split('T')[0];
  const saved   = [];
  const errors  = [];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const entry of entries) {
      const { schedule_id, status, remarks, done_date } = entry;

      if (!schedule_id || !status) {
        errors.push({ schedule_id, error: 'schedule_id and status required' });
        continue;
      }
      if (!['vaccinated','skipped','no_vaccination'].includes(status)) {
        errors.push({ schedule_id, error: 'status must be: vaccinated / skipped / no_vaccination' });
        continue;
      }
      if (['skipped','no_vaccination'].includes(status) && (!remarks || remarks.trim() === '')) {
        errors.push({ schedule_id, error: 'remarks required when skipped or no_vaccination' });
        continue;
      }

      // Get schedule
      const schedRes = await client.query(`
        SELECT fvs.*, vpd.vaccine_name
        FROM flock_vaccination_schedule fvs
        JOIN vaccination_program_detail vpd ON vpd.id = fvs.detail_id
        WHERE fvs.id = $1
      `, [schedule_id]);

      if (schedRes.rowCount === 0) {
        errors.push({ schedule_id, error: 'Not found' });
        continue;
      }

      const sched   = schedRes.rows[0];
      const dueDate = sched.due_date instanceof Date
        ? sched.due_date.toISOString().split('T')[0]
        : String(sched.due_date).split('T')[0];

      if (dueDate > today) {
        errors.push({ schedule_id, error: `Future date ${dueDate} — cannot enter` });
        continue;
      }
      if (['vaccinated','skipped','no_vaccination'].includes(sched.status)) {
        errors.push({ schedule_id, error: 'Already entered — cannot edit' });
        continue;
      }

      try {
        await client.query(`
          INSERT INTO flock_vaccination_log
            (schedule_id, flock_no, plant_code, detail_id, due_date,
             day_number, status, remarks, done_date, supervisor_id)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        `, [schedule_id, sched.flock_no, sched.plant_code, sched.detail_id,
            sched.due_date, sched.day_number, status,
            remarks || null, done_date || today, req.user?.id || null]);

        await client.query(`
          UPDATE flock_vaccination_schedule
          SET status=$1, completed_at=NOW(), updated_at=NOW()
          WHERE id=$2
        `, [status, schedule_id]);

        saved.push({ schedule_id, flock_no: sched.flock_no, vaccine_name: sched.vaccine_name, status });
      } catch(e) {
        errors.push({ schedule_id, error: e.message });
      }
    }

    await client.query('COMMIT');

    return res.status(errors.length && !saved.length ? 400 : 201).json({
      success:   saved.length > 0,
      message:   `${saved.length} entries saved, ${errors.length} errors`,
      saved,
      errors,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[recordMissedBulk]', err.message);
    return res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
};

// Download Excel template for upload
exports.downloadTemplate = async (req, res) => {
  try {
    const wb = XLSX.utils.book_new();
    const headers = ['S.No', 'Days', 'Wk', 'Disease', 'Name of the Vaccine',
                     'Type (Live/Killed/Antibiotic/Activity)', 'Make', 'Dose',
                     'Route (Eye Drop/S/C Neck/I/M Right/I/M Left/D/W/W/W)'];
    const sample = [
      [1,  1,   0.1,  'IB L V - 1',   'IB H120',        'Live',       'Phibro', '0.03ml', 'Eye Drop'],
      [2,  7,   1.0,  'ND B1',         'ND B1',           'Live',       'Ventri', '0.03ml', 'Eye Drop'],
      [3,  9,   1.3,  'Debeak - 1/2',  'Beak Debeaking',  'Activity',   '',       '',        ''],
      [4,  13,  1.9,  'AMP. 5Days',    'AMP.20mg/kg',     'Antibiotic', 'Elanco', '',        'D/W'],
      [5,  14,  2.0,  'IBH K - 1/7',   'IBH Killed',      'Killed',     'Ventri', '0.3ml',   'S/C Neck'],
    ];
    const ws = XLSX.utils.aoa_to_sheet([headers, ...sample]);
    ws['!cols'] = [{ wch:6 },{ wch:6 },{ wch:6 },{ wch:25 },{ wch:30 },{ wch:35 },{ wch:15 },{ wch:10 },{ wch:40 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Vaccination Program');

    const instrWs = XLSX.utils.aoa_to_sheet([
      ['KRISHI Vaccination Program Upload Template'],
      [''],
      ['INSTRUCTIONS:'],
      ['1. Fill rows from row 2 onwards'],
      ['2. Days = age of bird in days (1, 3, 7...)'],
      ['3. Wk = week number (0.1, 1, 1.7...)'],
      ['4. Type: Live / Killed / Antibiotic / Activity'],
      ['5. Route: Eye Drop / S/C Neck / I/M Right / I/M Left / D/W / W/W'],
      ['6. Do NOT change column headers'],
    ]);
    instrWs['!cols'] = [{ wch:60 }];
    XLSX.utils.book_append_sheet(wb, instrWs, 'Instructions');

    const buf = XLSX.write(wb, { type:'buffer', bookType:'xlsx' });
    res.setHeader('Content-Disposition', 'attachment; filename=vaccination_program_template.xlsx');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    return res.send(buf);
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};
