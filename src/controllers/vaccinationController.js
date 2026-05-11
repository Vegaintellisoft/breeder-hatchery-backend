const pool = require('../config/db');

// Status logic based on current day vs flock start
// Passed day_number relative to today:
//   category = activity  → 'Activity'
//   category = grading   → 'Grading'
//   days_since > day_number + 2 → 'Done'      (well past)
//   days_since > day_number     → 'Overdue'   (past but not marked)
//   days_since = day_number     → 'Due Today'
//   days_since < day_number     → 'Upcoming'
function computeStatus(category, dayNumber, currentDay) {
  if (category === 'activity') return 'Activity';
  if (category === 'grading')  return 'Grading';
  if (currentDay > dayNumber + 2) return 'Done';
  if (currentDay > dayNumber)     return 'Overdue';
  if (currentDay === dayNumber)   return 'Due Today';
  return 'Upcoming';
}

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/vaccination/schedule?search=&current_day=&category=
// Get all vaccination schedule with auto-calculated status
// current_day = days since flock started (default = 1 if not passed)
// ═══════════════════════════════════════════════════════════════════════════
const getSchedule = async (req, res) => {
  const { search, current_day = 1, category } = req.query;

  try {
    const conditions = ['vs.is_active = TRUE'];
    const params     = [];
    let   idx        = 1;

    if (search) {
      conditions.push(`(vs.vaccine_name ILIKE $${idx} OR vs.sub_label ILIKE $${idx})`);
      params.push(`%${search}%`);
      idx++;
    }
    if (category) {
      conditions.push(`vs.category = $${idx++}`);
      params.push(category);
    }

    const result = await pool.query(`
      SELECT id, day_number, vaccine_name, sub_label, category, created_at
      FROM vaccination_schedule vs
      WHERE ${conditions.join(' AND ')}
      ORDER BY day_number ASC
    `, params);

    const currentDay = parseInt(current_day) || 1;

    const data = result.rows.map(row => ({
      ...row,
      status: computeStatus(row.category, row.day_number, currentDay),
    }));

    return res.status(200).json({ success: true, current_day: currentDay, count: data.length, data });
  } catch (err) {
    console.error('[getSchedule]', err.message);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/vaccination/schedule
// Admin adds a new vaccination schedule item
// ═══════════════════════════════════════════════════════════════════════════
const addScheduleItem = async (req, res) => {
  const { day_number, vaccine_name, sub_label, category = 'vaccine' } = req.body;

  if (!day_number || !vaccine_name) {
    return res.status(422).json({ success: false, message: 'day_number and vaccine_name are required' });
  }

  const validCategories = ['vaccine', 'antibiotic', 'activity', 'grading', 'other'];
  if (!validCategories.includes(category)) {
    return res.status(422).json({
      success: false,
      message: `category must be one of: ${validCategories.join(', ')}`,
    });
  }

  try {
    const result = await pool.query(`
      INSERT INTO vaccination_schedule (day_number, vaccine_name, sub_label, category)
      VALUES ($1,$2,$3,$4)
      RETURNING *
    `, [day_number, vaccine_name.trim(), sub_label || null, category]);

    return res.status(200).json({
      success: true,
      message: 'Vaccination schedule item added',
      data: result.rows[0],
    });
  } catch (err) {
    console.error('[addScheduleItem]', err.message);
    return res.status(500).json({ success: false, message: 'Internal server error', error: err.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// PUT /api/vaccination/schedule/:id
// Admin updates a schedule item
// ═══════════════════════════════════════════════════════════════════════════
const updateScheduleItem = async (req, res) => {
  const { id } = req.params;
  const { day_number, vaccine_name, sub_label, category } = req.body;

  try {
    const check = await pool.query('SELECT id FROM vaccination_schedule WHERE id = $1', [id]);
    if (check.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Schedule item not found' });
    }

    const result = await pool.query(`
      UPDATE vaccination_schedule SET
        day_number   = COALESCE($1, day_number),
        vaccine_name = COALESCE($2, vaccine_name),
        sub_label    = COALESCE($3, sub_label),
        category     = COALESCE($4, category),
        updated_at   = NOW()
      WHERE id = $5
      RETURNING *
    `, [day_number || null, vaccine_name || null, sub_label || null, category || null, id]);

    return res.status(200).json({ success: true, message: 'Updated', data: result.rows[0] });
  } catch (err) {
    console.error('[updateScheduleItem]', err.message);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// DELETE /api/vaccination/schedule/:id
// Admin removes a schedule item (soft delete)
// ═══════════════════════════════════════════════════════════════════════════
const deleteScheduleItem = async (req, res) => {
  const { id } = req.params;
  try {
    const check = await pool.query('SELECT id, vaccine_name FROM vaccination_schedule WHERE id = $1', [id]);
    if (check.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Schedule item not found' });
    }
    await pool.query('UPDATE vaccination_schedule SET is_active = FALSE, updated_at = NOW() WHERE id = $1', [id]);
    return res.status(200).json({
      success: true,
      message: `"${check.rows[0].vaccine_name}" removed from schedule`,
    });
  } catch (err) {
    console.error('[deleteScheduleItem]', err.message);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

module.exports = { getSchedule, addScheduleItem, updateScheduleItem, deleteScheduleItem };
