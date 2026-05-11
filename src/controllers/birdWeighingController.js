const pool = require('../config/db');

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/bird-weighing/save
// Save bird weighing entry per date + hen_type + gender
// sample_weight_pct auto-calculated by PostgreSQL
// ═══════════════════════════════════════════════════════════════════════════
const saveWeighing = async (req, res) => {
  const {
    entry_date,
    hen_type_id,
    gender,
    actual_weight_g   = 0,
    sample_weight_g   = 0,
    schedule,
    std_dev_pct       = 10.0,
    uniformity_pct    = 80.0,
  } = req.body;

  if (!entry_date) {
    return res.status(422).json({ success: false, message: 'entry_date is required' });
  }
  if (!gender || !['male', 'female'].includes(gender.toLowerCase())) {
    return res.status(422).json({ success: false, message: 'gender must be male or female' });
  }

  try {
    // Validate hen_type
    if (hen_type_id) {
      const ht = await pool.query(
        'SELECT id FROM hen_types WHERE id = $1 AND is_active = TRUE', [hen_type_id]
      );
      if (ht.rowCount === 0) {
        return res.status(404).json({ success: false, message: `Hen type ID ${hen_type_id} not found` });
      }
    }

    const result = await pool.query(`
      INSERT INTO bird_weighing
        (entry_date, hen_type_id, gender,
         actual_weight_g, sample_weight_g,
         schedule, std_dev_pct, uniformity_pct)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (entry_date, hen_type_id, gender)
      DO UPDATE SET
        actual_weight_g = EXCLUDED.actual_weight_g,
        sample_weight_g = EXCLUDED.sample_weight_g,
        schedule        = EXCLUDED.schedule,
        std_dev_pct     = EXCLUDED.std_dev_pct,
        uniformity_pct  = EXCLUDED.uniformity_pct,
        updated_at      = NOW()
      RETURNING *
    `, [
      entry_date, hen_type_id || null, gender.toLowerCase(),
      actual_weight_g, sample_weight_g,
      schedule || null, std_dev_pct, uniformity_pct,
    ]);

    const entry = result.rows[0];

    // Fetch hen type name
    let hen_type_name = null;
    if (entry.hen_type_id) {
      const ht = await pool.query('SELECT type_name FROM hen_types WHERE id = $1', [entry.hen_type_id]);
      if (ht.rowCount > 0) hen_type_name = ht.rows[0].type_name;
    }

    return res.status(200).json({
      success: true,
      message: 'Bird weighing saved successfully',
      data: { ...entry, hen_type_name },
    });

  } catch (err) {
    console.error('[saveWeighing]', err.message);
    return res.status(500).json({ success: false, message: 'Internal server error', error: err.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/bird-weighing/entry/:entry_date
// Get all entries for a date (male + female across hen types)
// ═══════════════════════════════════════════════════════════════════════════
const getEntry = async (req, res) => {
  const { entry_date } = req.params;
  try {
    const result = await pool.query(`
      SELECT bw.*, ht.type_name AS hen_type_name
      FROM bird_weighing bw
      LEFT JOIN hen_types ht ON ht.id = bw.hen_type_id
      WHERE bw.entry_date = $1
      ORDER BY ht.type_name, bw.gender
    `, [entry_date]);

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'No entries found for this date' });
    }
    return res.status(200).json({ success: true, data: result.rows });
  } catch (err) {
    console.error('[getEntry]', err.message);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/bird-weighing/list?from=&to=&hen_type_id=&gender=&limit=&offset=
// ═══════════════════════════════════════════════════════════════════════════
const listEntries = async (req, res) => {
  const { from, to, hen_type_id, gender, limit = 30, offset = 0 } = req.query;
  try {
    const conditions = [];
    const params     = [];
    let   idx        = 1;

    if (from)        { conditions.push(`bw.entry_date >= $${idx++}`);  params.push(from); }
    if (to)          { conditions.push(`bw.entry_date <= $${idx++}`);  params.push(to); }
    if (hen_type_id) { conditions.push(`bw.hen_type_id = $${idx++}`);  params.push(hen_type_id); }
    if (gender)      { conditions.push(`bw.gender = $${idx++}`);       params.push(gender.toLowerCase()); }

    params.push(Number(limit), Number(offset));
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await pool.query(`
      SELECT bw.*, ht.type_name AS hen_type_name
      FROM bird_weighing bw
      LEFT JOIN hen_types ht ON ht.id = bw.hen_type_id
      ${where}
      ORDER BY bw.entry_date DESC, ht.type_name, bw.gender
      LIMIT $${idx++} OFFSET $${idx}
    `, params);

    return res.status(200).json({ success: true, count: result.rowCount, data: result.rows });
  } catch (err) {
    console.error('[listEntries]', err.message);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

module.exports = { saveWeighing, getEntry, listEntries };
