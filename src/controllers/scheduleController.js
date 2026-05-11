const pool = require('../config/db');

// ── Calculate due dates from chick start date ─────────────────────────────
function calculateDueDates(chick_start_date, plant_code, flock_no) {
  const start  = new Date(chick_start_date);
  const today  = new Date();
  const schedules = [];

  // Daily — every day from start
  const diffDays = Math.floor((today - start) / (1000 * 60 * 60 * 24));
  for (let d = 0; d <= diffDays + 30; d++) {
    const due = new Date(start);
    due.setDate(start.getDate() + d);
    schedules.push({ frequency: 'daily', due_date: due.toISOString().split('T')[0], day_number: d + 1 });
  }

  // Weekly — every 7 days
  for (let w = 1; w <= 52; w++) {
    const due = new Date(start);
    due.setDate(start.getDate() + (w * 7) - 1);
    if (due > new Date(today.getTime() + 60 * 24 * 60 * 60 * 1000)) break;
    schedules.push({ frequency: 'weekly', due_date: due.toISOString().split('T')[0], day_number: w * 7 });
  }

  // Fortnightly — every 15 days
  for (let f = 1; f <= 26; f++) {
    const due = new Date(start);
    due.setDate(start.getDate() + (f * 15) - 1);
    if (due > new Date(today.getTime() + 60 * 24 * 60 * 60 * 1000)) break;
    schedules.push({ frequency: 'fortnightly', due_date: due.toISOString().split('T')[0], day_number: f * 15 });
  }

  // Monthly — every 30 days
  for (let m = 1; m <= 12; m++) {
    const due = new Date(start);
    due.setDate(start.getDate() + (m * 30) - 1);
    if (due > new Date(today.getTime() + 60 * 24 * 60 * 60 * 1000)) break;
    schedules.push({ frequency: 'monthly', due_date: due.toISOString().split('T')[0], day_number: m * 30 });
  }

  // Quarterly — every 90 days
  for (let q = 1; q <= 4; q++) {
    const due = new Date(start);
    due.setDate(start.getDate() + (q * 90) - 1);
    if (due > new Date(today.getTime() + 60 * 24 * 60 * 60 * 1000)) break;
    schedules.push({ frequency: 'quarterly', due_date: due.toISOString().split('T')[0], day_number: q * 90 });
  }

  // Bi-annually — every 180 days
  for (let b = 1; b <= 2; b++) {
    const due = new Date(start);
    due.setDate(start.getDate() + (b * 180) - 1);
    if (due > new Date(today.getTime() + 60 * 24 * 60 * 60 * 1000)) break;
    schedules.push({ frequency: 'bi_annually', due_date: due.toISOString().split('T')[0], day_number: b * 180 });
  }

  return schedules.map(s => ({ ...s, plant_code, flock_no, chick_start_date }));
}

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/schedule/generate
// Generate schedule for a flock from SAP chick start date
// Body: { flock_no, plant_code, chick_start_date }
// ═══════════════════════════════════════════════════════════════════════════
exports.generateSchedule = async (req, res) => {
  const { flock_no, plant_code, chick_start_date } = req.body;

  if (!flock_no || !plant_code || !chick_start_date) {
    return res.status(422).json({
      success: false,
      message: 'flock_no, plant_code, chick_start_date required'
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const schedules = calculateDueDates(chick_start_date, plant_code, flock_no);
    let inserted = 0;

    for (const s of schedules) {
      const existing = await client.query(`
        SELECT id, status FROM flock_frequency_schedule
        WHERE flock_no=$1 AND frequency=$2 AND due_date=$3
      `, [s.flock_no, s.frequency, s.due_date]);

      if (existing.rowCount === 0) {
        // Determine if past due date = missed
        const isPast   = new Date(s.due_date) < new Date(new Date().toDateString());
        const status   = s.frequency === 'daily' && isPast ? 'missed' : 'pending';

        await client.query(`
          INSERT INTO flock_frequency_schedule
            (flock_no, plant_code, chick_start_date, frequency, due_date, day_number, status)
          VALUES ($1,$2,$3,$4,$5,$6,$7)
          ON CONFLICT (flock_no, frequency, due_date) DO NOTHING
        `, [s.flock_no, s.plant_code, s.chick_start_date, s.frequency, s.due_date, s.day_number, status]);
        inserted++;
      }
    }

    await client.query('COMMIT');

    return res.status(200).json({
      success: true,
      message: `Schedule generated for flock ${flock_no}`,
      flock_no,
      plant_code,
      chick_start_date,
      total_schedules: schedules.length,
      inserted,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[generateSchedule]', err.message);
    return res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/schedule/today?plant_code=1902
// Get today's due frequencies for a plant
// ═══════════════════════════════════════════════════════════════════════════
exports.getTodaySchedule = async (req, res) => {
  const { plant_code } = req.query;
  const today = new Date().toISOString().split('T')[0];

  if (!plant_code) {
    return res.status(422).json({ success: false, message: 'plant_code required' });
  }

  try {
    const result = await pool.query(`
      SELECT ffs.*, fm.flock_name,
             bcl.is_fully_completed, bcl.supervisor_id,
             u.first_name || ' ' || u.last_name AS supervisor_name
      FROM flock_frequency_schedule ffs
      LEFT JOIN flock_master fm ON fm.flock_no = ffs.flock_no
      LEFT JOIN biosecurity_completion_log bcl
        ON bcl.flock_no = ffs.flock_no
        AND bcl.frequency = ffs.frequency
        AND bcl.entry_date = $2
      LEFT JOIN admin u ON u.id = bcl.supervisor_id AND u.category='Breeder'
      WHERE ffs.plant_code = $1 AND ffs.due_date = $2
      ORDER BY ffs.flock_no, ffs.frequency
    `, [plant_code, today]);

    const grouped = {};
    for (const row of result.rows) {
      if (!grouped[row.flock_no]) {
        grouped[row.flock_no] = {
          flock_no:   row.flock_no,
          flock_name: row.flock_name || row.flock_no,
          plant_code: row.plant_code,
          due_today:  [],
        };
      }
      grouped[row.flock_no].due_today.push({
        frequency:          row.frequency,
        day_number:         row.day_number,
        due_date:           row.due_date,
        status:             row.status,
        is_fully_completed: row.is_fully_completed || false,
        supervisor_name:    row.supervisor_name || null,
      });
    }

    return res.status(200).json({
      success: true,
      date: today,
      plant_code,
      total_flocks: Object.keys(grouped).length,
      data: Object.values(grouped),
    });
  } catch (err) {
    console.error('[getTodaySchedule]', err.message);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/schedule/overdue?plant_code=1902
// ═══════════════════════════════════════════════════════════════════════════
exports.getOverdueSchedule = async (req, res) => {
  const { plant_code } = req.query;
  const today = new Date().toISOString().split('T')[0];

  try {
    let where = [`ffs.due_date < $1`, `ffs.status = 'pending'`];
    let params = [today];
    let idx = 2;

    if (plant_code) { where.push(`ffs.plant_code = $${idx++}`); params.push(plant_code); }

    const result = await pool.query(`
      SELECT ffs.*, fm.flock_name,
             (CURRENT_DATE - ffs.due_date) AS days_overdue
      FROM flock_frequency_schedule ffs
      LEFT JOIN flock_master fm ON fm.flock_no = ffs.flock_no
      WHERE ${where.join(' AND ')}
      ORDER BY ffs.due_date, ffs.plant_code, ffs.flock_no
    `, params);

    return res.status(200).json({
      success: true,
      total_overdue: result.rowCount,
      data: result.rows,
    });
  } catch (err) {
    console.error('[getOverdueSchedule]', err.message);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/schedule/complete — Mark frequency as completed
// Body: { flock_no, plant_code, frequency, entry_date, total_activities,
//         completed_activities, is_late, late_reason }
// ═══════════════════════════════════════════════════════════════════════════
exports.markComplete = async (req, res) => {
  const {
    flock_no, plant_code, frequency, entry_date,
    total_activities, completed_activities,
    is_late, late_reason
  } = req.body;

  if (!flock_no || !plant_code || !frequency || !entry_date) {
    return res.status(422).json({
      success: false,
      message: 'flock_no, plant_code, frequency, entry_date required'
    });
  }

  const today     = new Date().toISOString().split('T')[0];
  const entryDate = entry_date;

  // Check max 2 days back
  const diffDays = Math.floor(
    (new Date(today) - new Date(entryDate)) / (1000 * 60 * 60 * 24)
  );

  if (diffDays > 2) {
    return res.status(422).json({
      success: false,
      message: 'Cannot enter data more than 2 days back'
    });
  }

  if (diffDays > 0 && !late_reason) {
    return res.status(422).json({
      success: false,
      message: 'late_reason is required when entering previous day data'
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const isFullyCompleted = completed_activities >= total_activities;

    // Upsert completion log
    await client.query(`
      INSERT INTO biosecurity_completion_log
        (flock_no, plant_code, supervisor_id, frequency, entry_date,
         is_late, late_reason, late_days,
         total_activities, completed_activities, is_fully_completed)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      ON CONFLICT (flock_no, frequency, entry_date, supervisor_id)
      DO UPDATE SET
        total_activities     = EXCLUDED.total_activities,
        completed_activities = EXCLUDED.completed_activities,
        is_fully_completed   = EXCLUDED.is_fully_completed,
        is_late              = EXCLUDED.is_late,
        late_reason          = EXCLUDED.late_reason,
        late_days            = EXCLUDED.late_days,
        updated_at           = NOW()
    `, [
      flock_no, plant_code, req.user.id, frequency, entryDate,
      diffDays > 0, late_reason || null, diffDays,
      total_activities || 0, completed_activities || 0, isFullyCompleted
    ]);

    // Update schedule status
    if (isFullyCompleted) {
      await client.query(`
        UPDATE flock_frequency_schedule
        SET status = $1, completed_at = NOW(), completed_by = $2, updated_at = NOW()
        WHERE flock_no = $3 AND frequency = $4 AND due_date = $5
      `, [diffDays > 0 ? 'late' : 'completed', req.user.id, flock_no, frequency, entryDate]);
    }

    await client.query('COMMIT');

    return res.status(200).json({
      success: true,
      message: isFullyCompleted
        ? `${frequency} entry marked as ${diffDays > 0 ? 'late completed' : 'completed'}`
        : `${frequency} entry partially saved`,
      data: {
        flock_no, frequency, entry_date: entryDate,
        is_fully_completed: isFullyCompleted,
        is_late: diffDays > 0,
        late_days: diffDays,
      }
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[markComplete]', err.message);
    return res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/schedule/completion?plant_code=&from_date=&to_date=
// Get completion report
// ═══════════════════════════════════════════════════════════════════════════
exports.getCompletionReport = async (req, res) => {
  const { plant_code, from_date, to_date, flock_no } = req.query;
  const today = new Date().toISOString().split('T')[0];

  try {
    let where = [];
    let params = [];
    let idx = 1;

    if (plant_code) { where.push(`bcl.plant_code = $${idx++}`); params.push(plant_code); }
    if (flock_no)   { where.push(`bcl.flock_no = $${idx++}`);   params.push(flock_no); }
    where.push(`bcl.entry_date >= $${idx++}`); params.push(from_date || today);
    if (to_date) { where.push(`bcl.entry_date <= $${idx++}`); params.push(to_date); }

    const result = await pool.query(`
      SELECT bcl.*, u.full_name AS supervisor_name,
             fm.flock_name
      FROM biosecurity_completion_log bcl
      JOIN admin u ON u.id = bcl.supervisor_id AND u.category='Breeder'
      LEFT JOIN flock_master fm ON fm.flock_no = bcl.flock_no
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY bcl.entry_date DESC, bcl.flock_no
    `, params);

    return res.status(200).json({
      success: true,
      total: result.rowCount,
      data: result.rows,
    });
  } catch (err) {
    console.error('[getCompletionReport]', err.message);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/schedule/late-reasons — Get all late entry reasons
// ═══════════════════════════════════════════════════════════════════════════
exports.getLateReasons = async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM late_entry_reasons WHERE is_active=TRUE ORDER BY code`);
    return res.status(200).json({ success: true, data: result.rows });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};
