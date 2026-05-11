const pool = require('../config/db');

// ── Auto-generate vaccination schedule for a flock ────────────────────────
// Called automatically when new flock arrives (SAP sync)
async function generateVaccinationSchedule(flock_no, plant_code, chick_start_date) {
  if (!flock_no || !plant_code || !chick_start_date) return 0;

  // Check if already generated
  const existing = await pool.query(
    `SELECT COUNT(*) FROM flock_vaccination_schedule WHERE flock_no=$1`,
    [flock_no]
  );
  if (parseInt(existing.rows[0].count) > 0) {
    console.log(`[vaccination] Schedule already exists for flock ${flock_no}`);
    return 0;
  }

  // Get active program header (fixed: BD-8 Vencobb 430Y)
  const headerRes = await pool.query(`
    SELECT id FROM vaccination_program_header
    WHERE is_active = TRUE
    ORDER BY id LIMIT 1
  `);
  if (headerRes.rowCount === 0) {
    console.log('[vaccination] No active vaccination program found');
    return 0;
  }
  const header_id = headerRes.rows[0].id;

  // Get all detail rows for this program
  const detailsRes = await pool.query(`
    SELECT id, day_number FROM vaccination_program_detail
    WHERE header_id = $1 AND is_active = TRUE
    ORDER BY day_number, id
  `, [header_id]);

  if (detailsRes.rowCount === 0) return 0;

  const start = new Date(chick_start_date);
  start.setHours(0, 0, 0, 0);

  let inserted = 0;
  for (const detail of detailsRes.rows) {
    const dueDate = new Date(start);
    dueDate.setDate(start.getDate() + detail.day_number - 1);
    const dueDateStr = dueDate.toISOString().split('T')[0];

    try {
      await pool.query(`
        INSERT INTO flock_vaccination_schedule
          (flock_no, plant_code, header_id, detail_id, chick_start_date, due_date, day_number, status)
        VALUES ($1,$2,$3,$4,$5,$6,$7,'pending')
        ON CONFLICT (flock_no, detail_id, due_date) DO NOTHING
      `, [flock_no, plant_code, header_id, detail.id, chick_start_date, dueDateStr, detail.day_number]);
      inserted++;
    } catch(e) {
      console.error(`[vaccination] Insert error flock=${flock_no} detail=${detail.id}:`, e.message);
    }
  }

  console.log(`[vaccination] Generated ${inserted} schedule entries for flock ${flock_no}`);
  return inserted;
}

exports.generateVaccinationSchedule = generateVaccinationSchedule;

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/vaccination-schedule/notifications?plant_code=1902
// Returns today's + overdue vaccination notifications
// Same structure as biosecurity notifications
// ═══════════════════════════════════════════════════════════════════════════
exports.getVaccinationNotifications = async (req, res) => {
  const plant_code = req.query.plant_code || req.user?.plant_code;
  if (!plant_code) return res.status(422).json({ success: false, message: 'plant_code required' });

  try {
    const today = new Date().toISOString().split('T')[0];

    // Today's pending
    const todayRes = await pool.query(`
      SELECT
        fvs.id AS schedule_id, fvs.flock_no, fvs.due_date, fvs.day_number, fvs.status,
        fm.flock_name,
        vpd.disease, vpd.vaccine_name, vpd.vaccine_type,
        vpd.manufacturer, vpd.dose, vpd.route, vpd.category,
        'today' AS entry_type, 0 AS days_late
      FROM flock_vaccination_schedule fvs
      JOIN flock_master fm ON fm.flock_no = fvs.flock_no
      JOIN vaccination_program_detail vpd ON vpd.id = fvs.detail_id
      WHERE fvs.plant_code = $1
        AND fvs.due_date = CURRENT_DATE
        AND fvs.status = 'pending'
      ORDER BY fvs.flock_no, fvs.day_number
    `, [plant_code]);

    // Overdue pending (last 2 days only)
    const overdueRes = await pool.query(`
      SELECT
        fvs.id AS schedule_id, fvs.flock_no, fvs.due_date, fvs.day_number, fvs.status,
        fm.flock_name,
        vpd.disease, vpd.vaccine_name, vpd.vaccine_type,
        vpd.manufacturer, vpd.dose, vpd.route, vpd.category,
        'overdue' AS entry_type,
        (CURRENT_DATE - fvs.due_date::date) AS days_late
      FROM flock_vaccination_schedule fvs
      JOIN flock_master fm ON fm.flock_no = fvs.flock_no
      JOIN vaccination_program_detail vpd ON vpd.id = fvs.detail_id
      WHERE fvs.plant_code = $1
        AND fvs.due_date >= CURRENT_DATE - 2
        AND fvs.due_date < CURRENT_DATE
        AND fvs.status = 'pending'
      ORDER BY fvs.due_date DESC, fvs.flock_no
    `, [plant_code]);

    // Group by date → flock
    const grouped = {};
    const addRow = (row) => {
      const d = row.due_date instanceof Date
        ? row.due_date.toISOString().split('T')[0]
        : String(row.due_date).split('T')[0];

      if (!grouped[d]) {
        grouped[d] = {
          due_date:   d,
          entry_type: row.entry_type,
          days_late:  parseInt(row.days_late),
          flocks: {}
        };
      }
      if (!grouped[d].flocks[row.flock_no]) {
        grouped[d].flocks[row.flock_no] = {
          flock_no:   row.flock_no,
          flock_name: row.flock_name || row.flock_no,
          vaccinations: []
        };
      }
      grouped[d].flocks[row.flock_no].vaccinations.push({
        schedule_id:   row.schedule_id,
        day_number:    row.day_number,
        disease:       row.disease,
        vaccine_name:  row.vaccine_name,
        vaccine_type:  row.vaccine_type,
        manufacturer:  row.manufacturer,
        dose:          row.dose,
        route:         row.route,
        category:      row.category,
      });
    };

    overdueRes.rows.forEach(addRow);
    todayRes.rows.forEach(addRow);

    const notifications = Object.values(grouped)
      .map(g => ({ ...g, flocks: Object.values(g.flocks) }))
      .sort((a, b) => a.due_date.localeCompare(b.due_date));

    const totalPending = todayRes.rowCount + overdueRes.rowCount;

    return res.json({
      success:         true,
      plant_code,
      badge_count:     totalPending,
      total_pending:   totalPending,
      today_count:     todayRes.rowCount,
      overdue_count:   overdueRes.rowCount,
      has_pending:     totalPending > 0,
      has_overdue:     overdueRes.rowCount > 0,
      summary_message: overdueRes.rowCount > 0
        ? `🔴 ${overdueRes.rowCount} overdue + ${todayRes.rowCount} today pending`
        : totalPending > 0
          ? `💉 ${totalPending} vaccinations due today`
          : '✅ All vaccinations up to date',
      notifications,
    });
  } catch (err) {
    console.error('[getVaccinationNotifications]', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/vaccination-schedule/record
// Supervisor marks vaccination as done or not done
// Body: { schedule_id, status: 'vaccinated'|'not_vaccinated', remarks }
// ═══════════════════════════════════════════════════════════════════════════
exports.recordVaccination = async (req, res) => {
  const { schedule_id, status, remarks } = req.body;

  if (!schedule_id) return res.status(422).json({ success: false, message: 'schedule_id required' });
  // 3 statuses: vaccinated, skipped, no_vaccination
  if (!status || !['vaccinated','skipped','no_vaccination'].includes(status)) {
    return res.status(422).json({ success: false, message: 'status must be: vaccinated, skipped, or no_vaccination' });
  }
  if (['skipped','no_vaccination'].includes(status) && (!remarks || remarks.trim() === '')) {
    return res.status(422).json({ success: false, message: `remarks required when status is ${status}` });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Get schedule row
    const schedRes = await client.query(`
      SELECT fvs.*, vpd.vaccine_name, vpd.disease, vpd.day_number AS vpd_day
      FROM flock_vaccination_schedule fvs
      JOIN vaccination_program_detail vpd ON vpd.id = fvs.detail_id
      WHERE fvs.id = $1
    `, [schedule_id]);

    if (schedRes.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Schedule entry not found' });
    }

    const sched = schedRes.rows[0];
    const today = new Date().toISOString().split('T')[0];

    // Insert vaccination log
    await client.query(`
      INSERT INTO flock_vaccination_log
        (schedule_id, flock_no, plant_code, detail_id, due_date,
         day_number, status, remarks, done_date, supervisor_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    `, [
      schedule_id, sched.flock_no, sched.plant_code, sched.detail_id,
      sched.due_date, sched.day_number, status,
      remarks || null, today, req.user?.id || null
    ]);

    // Update schedule status
    // If not_vaccinated → mark as not_vaccinated (disappears from notification)
    // If vaccinated → mark as vaccinated
    await client.query(`
      UPDATE flock_vaccination_schedule
      SET status=$1, completed_at=NOW(), updated_at=NOW()
      WHERE id=$2
    `, [status, schedule_id]);

    await client.query('COMMIT');

    return res.status(201).json({
      success:  true,
      message:  status === 'vaccinated'
        ? `✅ Vaccination recorded for ${sched.flock_no} — ${sched.vaccine_name}`
        : `⚠️ Not vaccinated recorded for ${sched.flock_no} — ${sched.vaccine_name}. Reason saved.`,
      flock_no:     sched.flock_no,
      vaccine_name: sched.vaccine_name,
      due_date:     sched.due_date,
      status,
      remarks: remarks || null,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[recordVaccination]', err.message);
    return res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/vaccination-schedule/flock/:flock_no
// Full vaccination schedule for a flock
// ═══════════════════════════════════════════════════════════════════════════
exports.getFlockSchedule = async (req, res) => {
  const { flock_no } = req.params;
  const { status }   = req.query;

  try {
    let where = [`fvs.flock_no=$1`];
    let params = [flock_no];

    if (status) { where.push(`fvs.status=$2`); params.push(status); }

    const result = await pool.query(`
      SELECT
        fvs.id AS schedule_id, fvs.flock_no, fvs.due_date,
        fvs.day_number, fvs.status, fvs.completed_at,
        fvs.chick_start_date,
        vpd.disease, vpd.vaccine_name, vpd.vaccine_type,
        vpd.manufacturer, vpd.dose, vpd.route, vpd.category,
        vph.program_name,
        fvl.remarks AS log_remarks, fvl.done_date, fvl.supervisor_id
      FROM flock_vaccination_schedule fvs
      JOIN vaccination_program_detail vpd ON vpd.id = fvs.detail_id
      JOIN vaccination_program_header vph ON vph.id = fvs.header_id
      LEFT JOIN flock_vaccination_log fvl ON fvl.schedule_id = fvs.id
      WHERE ${where.join(' AND ')}
      ORDER BY fvs.day_number, fvs.due_date
    `, params);

    const today = new Date().toISOString().split('T')[0];

    // Summary counts
    const summary = {
      total:          result.rowCount,
      vaccinated:     result.rows.filter(r => r.status === 'vaccinated').length,
      not_vaccinated: result.rows.filter(r => r.status === 'not_vaccinated').length,
      pending:        result.rows.filter(r => r.status === 'pending').length,
      missed:         result.rows.filter(r => r.status === 'missed').length,
    };

    return res.json({
      success: true,
      flock_no,
      chick_start_date: result.rows[0]?.chick_start_date || null,
      program_name:     result.rows[0]?.program_name || null,
      summary,
      data: result.rows.map(r => ({
        ...r,
        is_today:  r.due_date?.toISOString?.().split('T')[0] === today,
        is_entered: ['vaccinated','skipped','no_vaccination'].includes(r.status),
        is_past:   r.due_date?.toISOString?.().split('T')[0] < today,
        is_future: r.due_date?.toISOString?.().split('T')[0] > today,
      }))
    });
  } catch (err) {
    console.error('[getFlockSchedule]', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/vaccination-schedule/generate
// Manually trigger schedule generation for a flock
// Body: { flock_no, plant_code, chick_start_date }
// Also called automatically from SAP sync
// ═══════════════════════════════════════════════════════════════════════════
exports.generateSchedule = async (req, res) => {
  const { flock_no, plant_code, chick_start_date } = req.body;

  if (!flock_no || !plant_code || !chick_start_date) {
    return res.status(422).json({ success: false, message: 'flock_no, plant_code, chick_start_date required' });
  }

  try {
    const count = await generateVaccinationSchedule(flock_no, plant_code, chick_start_date);
    return res.json({
      success: true,
      message: count > 0
        ? `Generated ${count} vaccination schedule entries for flock ${flock_no}`
        : `Schedule already exists or no active program found for flock ${flock_no}`,
      flock_no, entries_created: count,
    });
  } catch (err) {
    console.error('[generateSchedule]', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/vaccination-schedule/generate-all
// Generate schedule for ALL flocks in flock_master that don't have one yet
// ═══════════════════════════════════════════════════════════════════════════
exports.generateAllSchedules = async (req, res) => {
  try {
    const flocksRes = await pool.query(`
      SELECT fm.flock_no, fm.farm_code AS plant_code, TO_CHAR(fm.hatchery_date,'YYYY-MM-DD') AS hatchery_date
      FROM flock_master fm
      WHERE fm.status = 'A'
        AND fm.hatchery_date IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM flock_vaccination_schedule fvs
          WHERE fvs.flock_no = fm.flock_no
        )
    `);

    const results = [];
    for (const flock of flocksRes.rows) {
      const count = await generateVaccinationSchedule(
        flock.flock_no, flock.plant_code, flock.hatchery_date
      );
      results.push({ flock_no: flock.flock_no, entries_created: count });
    }

    return res.json({
      success: true,
      message: `Processed ${results.length} flocks`,
      results,
    });
  } catch (err) {
    console.error('[generateAllSchedules]', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/vaccination-schedule/today?plant_code=1902
// What vaccinations are due today — same as notification but detailed
// ═══════════════════════════════════════════════════════════════════════════
exports.getTodaySchedule = async (req, res) => {
  const plant_code = req.query.plant_code || req.user?.plant_code;
  if (!plant_code) return res.status(422).json({ success: false, message: 'plant_code required' });

  try {
    const result = await pool.query(`
      SELECT
        fvs.id AS schedule_id, fvs.flock_no, fvs.due_date, fvs.day_number, fvs.status,
        fm.flock_name, fm.farm_name,
        vpd.disease, vpd.vaccine_name, vpd.vaccine_type,
        vpd.manufacturer, vpd.dose, vpd.route, vpd.category, vpd.s_no,
        vph.program_name
      FROM flock_vaccination_schedule fvs
      JOIN flock_master fm ON fm.flock_no = fvs.flock_no
      JOIN vaccination_program_detail vpd ON vpd.id = fvs.detail_id
      JOIN vaccination_program_header vph ON vph.id = fvs.header_id
      WHERE fvs.plant_code = $1
        AND fvs.due_date = CURRENT_DATE
        AND fvs.status = 'pending'
      ORDER BY fvs.flock_no, vpd.s_no
    `, [plant_code]);

    return res.json({
      success:    true,
      plant_code,
      date:       new Date().toISOString().split('T')[0],
      total:      result.rowCount,
      data:       result.rows,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};
