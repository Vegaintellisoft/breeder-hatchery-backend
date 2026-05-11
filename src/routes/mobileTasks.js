const express = require('express');
const router  = require('express').Router();
const pool    = require('../config/db');
const upload  = require('../middleware/upload');

// ── UPSERT SQL ────────────────────────────────────────────────────────────
const UPSERT_SQL = `
  INSERT INTO farm_biosecurity_master (
    farm_id, flock_id, activity_id, frequency, target_date,
    toggle_enabled, value, image_path, remarks, recorded_time,
    ph_level, tds_level, male_count, female_count,
    quantity, opening_stock, consumed_qty, entered_by,
    sample_date_time, sample_flock, sample_age, sample_shed_no,
    sample_type, no_of_samples, organ_name, collected_by,
    sample_sent_date, sample_sent_through, pod_slip_no, lab_name
  )
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30)
  ON CONFLICT (farm_id, flock_id, activity_id, target_date)
  DO UPDATE SET
    toggle_enabled  = TRUE,
    value           = COALESCE(EXCLUDED.value,          farm_biosecurity_master.value),
    image_path      = COALESCE(EXCLUDED.image_path,     farm_biosecurity_master.image_path),
    remarks         = COALESCE(EXCLUDED.remarks,        farm_biosecurity_master.remarks),
    recorded_time   = COALESCE(EXCLUDED.recorded_time,  farm_biosecurity_master.recorded_time),
    ph_level        = COALESCE(EXCLUDED.ph_level,       farm_biosecurity_master.ph_level),
    tds_level       = COALESCE(EXCLUDED.tds_level,      farm_biosecurity_master.tds_level),
    male_count      = COALESCE(EXCLUDED.male_count,     farm_biosecurity_master.male_count),
    female_count    = COALESCE(EXCLUDED.female_count,   farm_biosecurity_master.female_count),
    quantity        = COALESCE(EXCLUDED.quantity,       farm_biosecurity_master.quantity),
    opening_stock   = COALESCE(EXCLUDED.opening_stock,  farm_biosecurity_master.opening_stock),
    consumed_qty    = COALESCE(EXCLUDED.consumed_qty,   farm_biosecurity_master.consumed_qty),
    updated_at      = NOW()
  RETURNING id, activity_id, remarks, recorded_time, image_path, updated_at
`;

function buildParams(item, farm_id, flock_id, frequency, date) {
  return [
    parseInt(farm_id),
    flock_id ? parseInt(flock_id) : null,
    parseInt(item.activity_id),
    frequency, date, true,
    item.value         || null,
    item.image_path    || null,
    item.remarks       || null,
    item.recorded_time || null,
    item.ph_level      != null ? parseFloat(item.ph_level)     : null,
    item.tds_level     != null ? parseFloat(item.tds_level)    : null,
    item.male_count    != null ? parseInt(item.male_count)     : null,
    item.female_count  != null ? parseInt(item.female_count)   : null,
    item.quantity      != null ? parseFloat(item.quantity)     : null,
    item.opening_stock != null ? parseFloat(item.opening_stock): null,
    item.consumed_qty  != null ? parseFloat(item.consumed_qty) : null,
    item.entered_by    || null,
    item.sample_date_time    || null, item.sample_flock    || null,
    item.sample_age          || null, item.sample_shed_no  || null,
    item.sample_type         || null,
    item.no_of_samples != null ? parseInt(item.no_of_samples) : null,
    item.organ_name          || null, item.collected_by    || null,
    item.sample_sent_date    || null, item.sample_sent_through || null,
    item.pod_slip_no         || null, item.lab_name        || null,
  ];
}

// ── Mark schedule complete ─────────────────────────────────────────────────
async function markScheduleComplete(flock_no, plant_code, frequency, entry_date, supervisor_id, total, isLate) {
  if (!flock_no || !plant_code) return;
  const diffDays = Math.floor((new Date(new Date().toISOString().split('T')[0]) - new Date(entry_date)) / 86400000);
  try {
    await pool.query(`
      INSERT INTO biosecurity_completion_log
        (flock_no, plant_code, supervisor_id, frequency, entry_date,
         is_late, late_days, total_activities, completed_activities, is_fully_completed)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,TRUE)
      ON CONFLICT (flock_no, frequency, entry_date, supervisor_id)
      DO UPDATE SET
        completed_activities = EXCLUDED.completed_activities,
        is_fully_completed   = TRUE,
        is_late              = EXCLUDED.is_late,
        updated_at           = NOW()
    `, [flock_no, plant_code, supervisor_id||null, frequency, entry_date, isLate, diffDays, total, total]);

    await pool.query(`
      UPDATE flock_frequency_schedule
      SET status=$1, completed_at=NOW(), updated_at=NOW()
      WHERE flock_no=$2 AND frequency=$3 AND due_date=$4
        AND status IN ('pending','missed')
    `, [isLate ? 'late' : 'completed', flock_no, frequency, entry_date]);

    console.log(`[schedule] ${flock_no} ${frequency} ${entry_date} → ${isLate?'late':'completed'} ✅`);
  } catch(e) {
    console.error('[markScheduleComplete]', e.message);
  }
}

// ══════════════════════════════════════════════════════════════════════════
// CORE SAVE FUNCTION — used by both routes
// Steps:
//  1. Validate date (no future, max 2 days back, late_reason if late)
//  2. Get ALL required activities for this frequency from DB
//  3. Validate every activity is in submission — error if missing
//  4. Validate every field — error with field name if missing
//  5. Save ALL — if any field error → return error, don't clear notification
//  6. If ALL saved successfully → mark schedule complete → notification clears
// ══════════════════════════════════════════════════════════════════════════
async function saveTasks(req, res, frequency, entries, files) {
  const { farm_id, flock_id, flock_no, plant_code, task_date, late_reason } = req.body;

  if (!farm_id)          return res.status(400).json({ error: 'farm_id required' });
  if (!entries?.length)  return res.status(400).json({ error: 'entries required' });

  const today    = new Date().toISOString().split('T')[0];
  const date     = task_date || today;
  const diffDays = Math.floor((new Date(today) - new Date(date)) / 86400000);
  const isLate   = diffDays > 0;

  if (date > today) return res.status(400).json({ error: 'Cannot submit data for future dates' });
  if (diffDays > 2) return res.status(400).json({ error: 'Cannot enter data more than 2 days back' });
  if (isLate && !late_reason) return res.status(400).json({ error: 'late_reason is required for previous day entry' });

  // ── Step 1: Get ALL required activities for this frequency ──────────────
  const { rows: requiredActs } = await pool.query(`
    SELECT a.id, a.code, a.label, c.code AS cat_code, c.label AS cat_label,
           afa.image_required
    FROM activities a
    JOIN activity_categories c ON c.id = a.category_id
    JOIN activity_frequency_assignments afa ON afa.activity_id = a.id AND afa.frequency = $1
    WHERE afa.is_active = TRUE
    ORDER BY c.sort_order, a.sort_order
  `, [frequency]);

  const requiredMap  = {};
  for (const a of requiredActs) requiredMap[a.id] = a;

  // ── Step 2: Build submitted map ─────────────────────────────────────────
  const submittedMap = {};
  for (const e of entries) {
    if (e.activity_id) submittedMap[parseInt(e.activity_id)] = e;
  }

  // ── Step 3: Attach images sequentially ──────────────────────────────────
  // image_1 = entries[0], image_2 = entries[1] etc.
  entries.forEach((entry, i) => {
    const key = `image_${i + 1}`;
    if (files?.[key]?.[0]) {
      entry.image_path = `/uploads/${files[key][0].filename}`;
      submittedMap[parseInt(entry.activity_id)] = entry;
    }
  });

  // ── Step 4: Validate ALL required activities ─────────────────────────────
  const fieldErrors = [];

  for (const act of requiredActs) {
    const item = submittedMap[act.id];

    // Activity not submitted at all
    if (!item) {
      fieldErrors.push({
        activity_id:    act.id,
        activity_code:  act.code,
        activity_label: act.label,
        category:       act.cat_label,
        error:          'Activity not submitted',
      });
      continue;
    }

    // remarks required for every activity
    if (!item.remarks || String(item.remarks).trim() === '') {
      fieldErrors.push({
        activity_id:    act.id,
        activity_code:  act.code,
        activity_label: act.label,
        category:       act.cat_label,
        error:          'remarks is required',
        field:          'remarks',
      });
    }

    // image required if admin enabled it
    if (act.image_required && !item.image_path) {
      fieldErrors.push({
        activity_id:    act.id,
        activity_code:  act.code,
        activity_label: act.label,
        category:       act.cat_label,
        error:          'Photo is required for this activity',
        field:          'image',
      });
    }

    // Only water_ph_tds requires ph_level and tds_level
    // ALL other fields (quantity, male_count, female_count etc) are OPTIONAL
    // Supervisor fills what they have — only remarks is mandatory for every activity
    if (act.code === 'water_ph_tds') {
      if (!item.ph_level  || item.ph_level  === '') fieldErrors.push({ activity_id: act.id, activity_label: act.label, error: 'ph_level is required',  field: 'ph_level' });
      if (!item.tds_level || item.tds_level === '') fieldErrors.push({ activity_id: act.id, activity_label: act.label, error: 'tds_level is required', field: 'tds_level' });
    }
  }

  // ── Step 5: If ANY field error → return error, save nothing ─────────────
  if (fieldErrors.length > 0) {
    return res.status(400).json({
      error:        'Validation failed — fix the following fields and resubmit',
      message:      `${fieldErrors.length} field error(s) found. Fix all errors and resubmit to clear notification.`,
      error_count:  fieldErrors.length,
      field_errors: fieldErrors,
    });
  }

  // ── Step 6: All valid — save everything ──────────────────────────────────
  const saved  = [];
  const errors = [];

  for (const act of requiredActs) {
    const item = submittedMap[act.id];
    try {
      const params = buildParams(item, farm_id, flock_id, frequency, date);
      const { rows } = await pool.query(UPSERT_SQL, params);
      saved.push({
        activity_id:    act.id,
        activity_code:  act.code,
        activity_label: act.label,
        category:       act.cat_label,
        ...rows[0],
      });
    } catch(e) {
      errors.push({ activity_id: act.id, activity_label: act.label, error: e.message });
    }
  }

  // ── Step 7: If all saved → clear notification ────────────────────────────
  if (errors.length === 0 && saved.length === requiredActs.length) {
    await markScheduleComplete(flock_no, plant_code, frequency, date, req.user?.id, saved.length, isLate);
    return res.status(201).json({
      success:     true,
      message:     `✅ All ${saved.length} ${frequency} activities saved. Notification cleared.`,
      frequency,
      task_date:   date,
      is_late:     isLate,
      late_reason: late_reason || null,
      flock_no:    flock_no    || null,
      plant_code:  plant_code  || null,
      total_saved: saved.length,
      saved,
    });
  }

  // Some DB errors — partial save
  return res.status(207).json({
    success:     false,
    message:     `⚠️ ${saved.length} saved, ${errors.length} failed. Notification NOT cleared.`,
    frequency,   task_date: date,
    saved,       errors,
  });
}

// ══════════════════════════════════════════════════════════════════════════
// POST /api/mobile/tasks/:frequency/with-images  (form-data + images)
// ══════════════════════════════════════════════════════════════════════════
router.post('/:frequency/with-images',
  upload.fields(Array.from({length:20},(_,i)=>({ name:`image_${i+1}`, maxCount:1 }))),
  async (req, res) => {
    try {
      const { frequency } = req.params;
      let entries;
      try { entries = JSON.parse(req.body.entries); }
      catch(e) { return res.status(400).json({ error: 'Invalid entries JSON' }); }
      await saveTasks(req, res, frequency, entries, req.files);
    } catch(err) {
      console.error('[with-images]', err.message);
      res.status(500).json({ error: 'Server error', detail: err.message });
    }
  }
);

// ══════════════════════════════════════════════════════════════════════════
// POST /api/mobile/tasks/:frequency  (JSON body)
// ══════════════════════════════════════════════════════════════════════════
router.post('/:frequency', async (req, res) => {
  try {
    const { frequency } = req.params;
    const { entries }   = req.body;
    await saveTasks(req, res, frequency, entries, null);
  } catch(err) {
    console.error('[tasks POST]', err.message);
    res.status(500).json({ error: 'Server error', detail: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// GET /api/mobile/tasks/:frequency
// ══════════════════════════════════════════════════════════════════════════
router.get('/:frequency', async (req, res) => {
  try {
    const { frequency }                          = req.params;
    const { farm_id, flock_id, target_date }     = req.query;
    if (!farm_id) return res.status(400).json({ error: 'farm_id required' });
    const date = target_date || new Date().toISOString().split('T')[0];
    let q = `
      SELECT m.*, a.code AS activity_code, a.label AS activity_label,
             c.code AS category_code, c.label AS category_label
      FROM farm_biosecurity_master m
      JOIN activities a ON a.id = m.activity_id
      JOIN activity_categories c ON c.id = a.category_id
      WHERE m.farm_id=$1 AND m.target_date=$2 AND m.frequency=$3
    `;
    const p = [parseInt(farm_id), date, frequency];
    if (flock_id) { q += ` AND m.flock_id=$4`; p.push(parseInt(flock_id)); }
    q += ` ORDER BY c.sort_order, a.sort_order`;
    const { rows } = await pool.query(q, p);
    const grouped  = {};
    for (const r of rows) {
      const k = r.category_code || 'other';
      if (!grouped[k]) grouped[k] = { category_label: r.category_label, entries: [] };
      grouped[k].entries.push(r);
    }
    return res.json({ farm_id, frequency, task_date: date, tasks: grouped });
  } catch(err) {
    return res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// GET /api/mobile/tasks/:frequency/history
// ══════════════════════════════════════════════════════════════════════════
router.get('/:frequency/history', async (req, res) => {
  try {
    const { frequency }            = req.params;
    const { farm_id, flock_id, days } = req.query;
    if (!farm_id) return res.status(400).json({ error: 'farm_id required' });
    const numDays = parseInt(days) || 14;
    let q = `
      SELECT m.*, a.code AS activity_code, a.label AS activity_label,
             c.code AS category_code, c.label AS category_label
      FROM farm_biosecurity_master m
      JOIN activities a ON a.id = m.activity_id
      JOIN activity_categories c ON c.id = a.category_id
      WHERE m.farm_id=$1 AND m.frequency=$2
        AND m.target_date >= CURRENT_DATE - INTERVAL '1 day' * $3
    `;
    const p = [parseInt(farm_id), frequency, numDays];
    if (flock_id) { q += ` AND m.flock_id=$4`; p.push(parseInt(flock_id)); }
    q += ` ORDER BY m.target_date DESC, a.sort_order`;
    const { rows } = await pool.query(q, p);
    const byDate   = {};
    for (const r of rows) {
      const d   = r.target_date instanceof Date ? r.target_date.toISOString().slice(0,10) : String(r.target_date).slice(0,10);
      const cat = r.category_code || 'other';
      if (!byDate[d]) byDate[d] = {};
      if (!byDate[d][cat]) byDate[d][cat] = { category_label: r.category_label, entries: [] };
      byDate[d][cat].entries.push(r);
    }
    return res.json({ farm_id, frequency, days: numDays, history: byDate });
  } catch(err) {
    return res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// GET /api/mobile/tasks/:frequency/date-info
// ══════════════════════════════════════════════════════════════════════════
router.get('/:frequency/date-info', (req, res) => {
  const { frequency }   = req.params;
  const { target_date } = req.query;
  const date = target_date ? new Date(target_date) : new Date();
  const fmt  = `${String(date.getDate()).padStart(2,'0')}-${String(date.getMonth()+1).padStart(2,'0')}-${date.getFullYear()}`;
  const labels = { daily:'Daily', weekly:'Weekly', fortnightly:'Fortnightly', monthly:'Monthly', quarterly:'Quarterly', bi_annually:'Bi-Annual' };
  return res.json({ frequency, target_date: target_date || new Date().toISOString().slice(0,10), formatted_date: fmt, label: labels[frequency] || frequency });
});

module.exports = router;
