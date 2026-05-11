const pool = require('../config/db');

const FLOCK_DURATION_DAYS = 504; // 72 weeks

function freqLabel(f) {
  const map = {
    daily: 'Daily', weekly: 'Weekly', fortnightly: 'Fortnightly',
    monthly: 'Monthly', quarterly: 'Quarterly', bi_annually: 'Bi-Annual',
  };
  return map[f] || f;
}

// ── Build full 72-week calendar from chick start date ─────────────────────
function buildFlockCalendar(chick_start_date) {
  const start = new Date(chick_start_date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + FLOCK_DURATION_DAYS - 1);

  const calendar = {};
  for (let day = 1; day <= FLOCK_DURATION_DAYS; day++) {
    const date = new Date(start);
    date.setDate(start.getDate() + day - 1);
    const dateStr = date.toISOString().split('T')[0];
    const freqs   = ['daily'];
    if (day % 7   === 0) freqs.push('weekly');
    if (day % 15  === 0) freqs.push('fortnightly');
    if (day % 30  === 0) freqs.push('monthly');
    if (day % 90  === 0) freqs.push('quarterly');
    if (day % 180 === 0) freqs.push('bi_annually');
    calendar[dateStr] = { day_number: day, date: dateStr, frequencies: freqs };
  }

  return {
    start: start.toISOString().split('T')[0],
    end:   end.toISOString().split('T')[0],
    calendar
  };
}

// ── Get flock info (chick_start_date) from DB ─────────────────────────────
async function getFlockInfo(flock_no) {
  // Try flock_frequency_schedule first
  const r1 = await pool.query(`
    SELECT ffs.flock_no, ffs.chick_start_date, ffs.plant_code,
           fm.flock_name
    FROM flock_frequency_schedule ffs
    LEFT JOIN flock_master fm ON fm.flock_no = ffs.flock_no
    WHERE ffs.flock_no = $1
    LIMIT 1
  `, [flock_no]);

  if (r1.rowCount > 0 && r1.rows[0].chick_start_date) {
    return r1.rows[0];
  }

  // Fallback: flock_master hatchery_date
  const r2 = await pool.query(`
    SELECT flock_no, flock_name, hatchery_date AS chick_start_date, farm_code AS plant_code
    FROM flock_master WHERE flock_no = $1
  `, [flock_no]);

  return r2.rowCount > 0 ? r2.rows[0] : null;
}

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/calendar/flock/:flock_no
// Full 72-week calendar — shows all due dates per frequency
// Query: ?month=2025-07  OR  ?from=&to=  OR  ?special_only=true
// ═══════════════════════════════════════════════════════════════════════════
exports.getFlockCalendar = async (req, res) => {
  const { flock_no }                   = req.params;
  const { month, from, to, special_only } = req.query;

  try {
    const flock = await getFlockInfo(flock_no);
    if (!flock) return res.status(404).json({ success: false, message: `Flock ${flock_no} not found` });
    if (!flock.chick_start_date) return res.status(400).json({ success: false, message: 'Chick start date not set for this flock' });

    const { start, end, calendar } = buildFlockCalendar(flock.chick_start_date);

    // Get completion status from DB
    const compRes = await pool.query(`
      SELECT frequency, due_date, status
      FROM flock_frequency_schedule
      WHERE flock_no = $1
    `, [flock_no]);

    const compMap = {};
    for (const row of compRes.rows) {
      const d = row.due_date instanceof Date
        ? row.due_date.toISOString().split('T')[0]
        : String(row.due_date).split('T')[0];
      if (!compMap[d]) compMap[d] = {};
      compMap[d][row.frequency] = row.status;
    }

    const today = new Date().toISOString().split('T')[0];
    let days    = Object.values(calendar);

    // Apply filters
    if (special_only === 'true') days = days.filter(d => d.frequencies.length > 1);
    if (month) days = days.filter(d => d.date.startsWith(month));
    if (from)  days = days.filter(d => d.date >= from);
    if (to)    days = days.filter(d => d.date <= to);

    const result = days.map(d => {
      const comp      = compMap[d.date] || {};
      const freqStatus = d.frequencies.map(f => ({
        frequency: f,
        label:     freqLabel(f),
        status:    comp[f] || (d.date < today ? 'missed' : 'pending'),
        is_done:   comp[f] === 'completed' || comp[f] === 'late',
      }));
      const allDone = freqStatus.every(f => f.is_done);

      return {
        date:        d.date,
        day_number:  d.day_number,
        week_number: Math.ceil(d.day_number / 7),
        is_today:    d.date === today,
        is_past:     d.date < today,
        is_future:   d.date > today,
        is_special:  d.frequencies.length > 1,
        all_done:    allDone,
        must_enter:  d.frequencies.map(f => freqLabel(f)).join(' + '),
        frequencies: freqStatus,
      };
    });

    return res.status(200).json({
      success: true,
      flock_no,
      flock_name:       flock.flock_name || flock_no,
      plant_code:       flock.plant_code,
      chick_start_date: start,
      flock_end_date:   end,
      total_days:       FLOCK_DURATION_DAYS,
      total_weeks:      72,
      schedule_summary: {
        daily:       FLOCK_DURATION_DAYS,
        weekly:      72,
        fortnightly: Math.floor(FLOCK_DURATION_DAYS / 15),
        monthly:     Math.floor(FLOCK_DURATION_DAYS / 30),
        quarterly:   Math.floor(FLOCK_DURATION_DAYS / 90),
        bi_annually: Math.floor(FLOCK_DURATION_DAYS / 180),
      },
      total_returned: result.length,
      data: result,
    });

  } catch (err) {
    console.error('[getFlockCalendar]', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/calendar/today?plant_code=1902
// What supervisor must enter TODAY for all flocks in their plant
// ═══════════════════════════════════════════════════════════════════════════
exports.getWhatsDueToday = async (req, res) => {
  const { plant_code } = req.query;
  const today = new Date().toISOString().split('T')[0];

  if (!plant_code) return res.status(422).json({ success: false, message: 'plant_code required' });

  try {
    // Get all flocks for this plant
    const flocksRes = await pool.query(`
      SELECT DISTINCT ffs.flock_no, ffs.chick_start_date, ffs.plant_code,
             fm.flock_name
      FROM flock_frequency_schedule ffs
      LEFT JOIN flock_master fm ON fm.flock_no = ffs.flock_no
      WHERE ffs.plant_code = $1
        AND ffs.chick_start_date IS NOT NULL
    `, [plant_code]);

    if (flocksRes.rowCount === 0) {
      return res.status(200).json({
        success: true, date: today, plant_code,
        message: 'No flocks found. Generate schedule first.',
        flocks: []
      });
    }

    // Also get overdue (missed entries from previous days — max 2 days back)
    const overdueRes = await pool.query(`
      SELECT ffs.flock_no, ffs.frequency, ffs.due_date, ffs.day_number,
             fm.flock_name
      FROM flock_frequency_schedule ffs
      LEFT JOIN flock_master fm ON fm.flock_no = ffs.flock_no
      WHERE ffs.plant_code = $1
        AND ffs.due_date >= CURRENT_DATE - 2
        AND ffs.due_date < CURRENT_DATE
        AND ffs.status IN ('pending','missed')
      ORDER BY ffs.due_date DESC, ffs.flock_no
    `, [plant_code]);

    const flocksDue = [];

    for (const flock of flocksRes.rows) {
      const start  = new Date(flock.chick_start_date);
      start.setHours(0, 0, 0, 0);
      const todayD = new Date(today);
      const dayNum = Math.floor((todayD - start) / (1000 * 60 * 60 * 24)) + 1;

      // Skip if outside 72 weeks
      if (dayNum < 1 || dayNum > FLOCK_DURATION_DAYS) continue;

      // What frequencies are due today based on day number
      const dueFreqs = ['daily'];
      if (dayNum % 7   === 0) dueFreqs.push('weekly');
      if (dayNum % 15  === 0) dueFreqs.push('fortnightly');
      if (dayNum % 30  === 0) dueFreqs.push('monthly');
      if (dayNum % 90  === 0) dueFreqs.push('quarterly');
      if (dayNum % 180 === 0) dueFreqs.push('bi_annually');

      // Check what's already completed today
      const compRes = await pool.query(`
        SELECT frequency, status FROM flock_frequency_schedule
        WHERE flock_no = $1 AND due_date = $2
      `, [flock.flock_no, today]);

      const completed = {};
      for (const r of compRes.rows) completed[r.frequency] = r.status;

      const freqStatus = dueFreqs.map(f => ({
        frequency: f,
        label:     freqLabel(f),
        status:    completed[f] || 'pending',
        is_done:   completed[f] === 'completed' || completed[f] === 'late',
      }));

      const pending = freqStatus.filter(f => !f.is_done);
      const allDone = pending.length === 0;

      flocksDue.push({
        flock_no:         flock.flock_no,
        flock_name:       flock.flock_name || flock.flock_no,
        chick_start_date: flock.chick_start_date,
        day_number:       dayNum,
        week_number:      Math.ceil(dayNum / 7),
        due_frequencies:  freqStatus,
        pending_count:    pending.length,
        all_done:         allDone,
        // Clear message — supervisor sees this on app open
        message: allDone
          ? `✅ All entries done for today`
          : `⚠️ Must enter: ${pending.map(f => f.label).join(' + ')}`,
      });
    }

    const totalPending = flocksDue.reduce((s, f) => s + f.pending_count, 0);

    // Group overdue by flock
    const overdueByFlock = {};
    for (const row of overdueRes.rows) {
      const d = row.due_date instanceof Date
        ? row.due_date.toISOString().split('T')[0]
        : String(row.due_date).split('T')[0];
      if (!overdueByFlock[row.flock_no]) {
        overdueByFlock[row.flock_no] = {
          flock_no:   row.flock_no,
          flock_name: row.flock_name || row.flock_no,
          missed:     []
        };
      }
      overdueByFlock[row.flock_no].missed.push({
        frequency:  row.frequency,
        label:      freqLabel(row.frequency),
        due_date:   d,
        day_number: row.day_number,
        days_late:  Math.floor((new Date(today) - new Date(d)) / (1000*60*60*24)),
      });
    }

    const overdueFlocks     = Object.values(overdueByFlock);
    const totalOverdue      = overdueRes.rowCount;
    const canEnterLate      = overdueFlocks.length > 0; // max 2 days back allowed

    return res.status(200).json({
      success: true,
      date:        today,
      plant_code,
      total_flocks:  flocksDue.length,
      total_pending: totalPending,
      all_complete:  totalPending === 0 && totalOverdue === 0,
      supervisor_message: totalPending === 0 && totalOverdue === 0
        ? '✅ All biosecurity entries complete!'
        : `⚠️ ${totalPending} pending today + ${totalOverdue} overdue`,
      // Today's entries
      flocks: flocksDue,
      // Yesterday's / missed entries (can still be entered — max 2 days back)
      overdue: {
        total:   totalOverdue,
        can_enter_late: canEnterLate,
        note:    'You can enter up to 2 days back. A reason is required.',
        flocks:  overdueFlocks,
      }
    });

  } catch (err) {
    console.error('[getWhatsDueToday]', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/calendar/flock/:flock_no/special
// Only days where supervisor must enter MORE than just daily
// ═══════════════════════════════════════════════════════════════════════════
exports.getSpecialDays = async (req, res) => {
  const { flock_no } = req.params;

  try {
    const flock = await getFlockInfo(flock_no);
    if (!flock) return res.status(404).json({ success: false, message: 'Flock not found' });
    if (!flock.chick_start_date) return res.status(400).json({ success: false, message: 'Chick start date not set' });

    const { calendar } = buildFlockCalendar(flock.chick_start_date);
    const today        = new Date().toISOString().split('T')[0];

    const specialDays = Object.values(calendar)
      .filter(d => d.frequencies.length > 1)
      .map(d => ({
        date:        d.date,
        day_number:  d.day_number,
        week_number: Math.ceil(d.day_number / 7),
        is_past:     d.date < today,
        is_today:    d.date === today,
        is_future:   d.date > today,
        frequencies: d.frequencies,
        must_enter:  d.frequencies.map(f => freqLabel(f)).join(' + '),
      }));

    return res.status(200).json({
      success: true,
      flock_no,
      flock_name:       flock.flock_name || flock_no,
      chick_start_date: flock.chick_start_date,
      total_special_days: specialDays.length,
      note: 'On these days supervisor must enter DAILY + the extra frequency(ies)',
      data: specialDays,
    });

  } catch (err) {
    console.error('[getSpecialDays]', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
};
