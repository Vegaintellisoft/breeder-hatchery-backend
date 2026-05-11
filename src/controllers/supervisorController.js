const pool   = require('../config/db');
const bcrypt = require('bcryptjs');
const DEFAULT_CATEGORY = 'Breeder';
const ALLOWED_CATEGORIES = ['Breeder', 'Hatchery'];

function normalizeCategory(input, fallback = DEFAULT_CATEGORY) {
  const category = (input || fallback || '').toString().trim();
  return ALLOWED_CATEGORIES.includes(category) ? category : null;
}

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/supervisor — List all supervisors
// ═══════════════════════════════════════════════════════════════════════════
exports.getSupervisors = async (req, res) => {
  try {
    const { plant_code, is_active } = req.query;
    const category = normalizeCategory(req.query.category || req.user?.category || DEFAULT_CATEGORY);
    if (!category) {
      return res.status(400).json({
        success: false,
        message: `Invalid category. Allowed: ${ALLOWED_CATEGORIES.join(', ')}`
      });
    }
    let where = [];
    let params = [];
    let idx = 2;

    if (plant_code) { where.push(`a.plant_code = $${idx++}`); params.push(plant_code); }
    if (is_active !== undefined) { where.push(`a.status = $${idx++}`); params.push(is_active === 'true'); }

    const result = await pool.query(`
      SELECT a.id, a.username, a.first_name || ' ' || a.last_name AS full_name,
             a.email, a.phone, a.role, a.category, a.status, a.created_at
      FROM admin a
      WHERE a.role = 'Supervisor' AND a.category = $1
      AND a.status = TRUE
      ${params.length > 0 ? 'AND ' + where.join(' AND ') : ''}
      ORDER BY a.first_name
    `, [category, ...params]);

    return res.status(200).json({ success: true, total: result.rowCount, data: result.rows });
  } catch (err) {
    console.error('[getSupervisors]', err.message);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/supervisor — Create supervisor (admin only)
// ═══════════════════════════════════════════════════════════════════════════
exports.createSupervisor = async (req, res) => {
  const { username, password, full_name, email, phone, plant_code, category } = req.body;

  if (!username || !password || !full_name || !plant_code) {
    return res.status(422).json({ success: false, message: 'username, password, full_name, plant_code required' });
  }

  try {
    const normalizedCategory = normalizeCategory(category || req.user?.category || DEFAULT_CATEGORY);
    if (!normalizedCategory) {
      return res.status(400).json({
        success: false,
        message: `Invalid category. Allowed: ${ALLOWED_CATEGORIES.join(', ')}`
      });
    }

    const hash = await bcrypt.hash(password, 10);
    // Split full_name into first/last
    const nameParts = full_name.split(' ');
    const firstName = nameParts[0];
    const lastName  = nameParts.slice(1).join(' ') || '';

    const result = await pool.query(`
      INSERT INTO admin (first_name, last_name, username, password, email, phone, role, category, status)
      VALUES ($1,$2,$3,$4,$5,$6,'Supervisor',$7,TRUE)
      RETURNING id, username, first_name, last_name, email, phone, role, category, status, created_at
    `, [firstName, lastName, username, hash, email || null, phone || null, normalizedCategory]);

    return res.status(201).json({
      success: true,
      message: 'Supervisor created successfully',
      data: result.rows[0],
    });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ success: false, message: 'Username already exists' });
    }
    console.error('[createSupervisor]', err.message);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// PUT /api/supervisor/:id — Update supervisor (admin only)
// Plant code NOT editable by supervisor
// ═══════════════════════════════════════════════════════════════════════════
exports.updateSupervisor = async (req, res) => {
  const { id } = req.params;
  const { full_name, email, phone, plant_code, is_active, category } = req.body;

  try {
    const normalizedCategory = normalizeCategory(category || req.user?.category || DEFAULT_CATEGORY);
    if (!normalizedCategory) {
      return res.status(400).json({
        success: false,
        message: `Invalid category. Allowed: ${ALLOWED_CATEGORIES.join(', ')}`
      });
    }

    const sets  = [];
    const vals  = [];
    let   idx   = 1;

    if (full_name  !== undefined) { sets.push(`full_name=$${idx++}`);  vals.push(full_name); }
    if (email      !== undefined) { sets.push(`email=$${idx++}`);      vals.push(email); }
    if (phone      !== undefined) { sets.push(`phone=$${idx++}`);      vals.push(phone); }
    if (plant_code !== undefined) { sets.push(`plant_code=$${idx++}`); vals.push(plant_code); }
    if (is_active  !== undefined) { sets.push(`is_active=$${idx++}`);  vals.push(is_active); }

    if (!sets.length) {
      return res.status(400).json({ success: false, message: 'Nothing to update' });
    }

    sets.push(`updated_at=NOW()`);
    vals.push(id, normalizedCategory);

    const result = await pool.query(`
      UPDATE admin SET ${sets.join(', ')} WHERE id=$${idx} AND category=$${idx + 1}
      RETURNING id, username, first_name, last_name, email, phone, role, status
    `, vals);

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Supervisor not found' });
    }

    return res.status(200).json({ success: true, message: 'Updated successfully', data: result.rows[0] });
  } catch (err) {
    console.error('[updateSupervisor]', err.message);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/supervisor/shift — Assign supervisor to plant shift (admin only)
// ═══════════════════════════════════════════════════════════════════════════
exports.assignShift = async (req, res) => {
  const { user_id, plant_code, shift_date, shift_type, category } = req.body;

  if (!user_id || !plant_code || !shift_date) {
    return res.status(422).json({ success: false, message: 'user_id, plant_code, shift_date required' });
  }

  try {
    const normalizedCategory = normalizeCategory(category || req.user?.category || DEFAULT_CATEGORY);
    if (!normalizedCategory) {
      return res.status(400).json({
        success: false,
        message: `Invalid category. Allowed: ${ALLOWED_CATEGORIES.join(', ')}`
      });
    }

    // Verify user is a supervisor
    const userCheck = await pool.query(`
      SELECT id, first_name || ' ' || last_name AS full_name, role
      FROM admin
      WHERE id=$1 AND role='Supervisor' AND category=$2 AND status=TRUE
    `, [user_id, normalizedCategory]);

    if (userCheck.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Supervisor not found or inactive' });
    }

    const result = await pool.query(`
      INSERT INTO supervisor_plant_shifts
        (user_id, plant_code, shift_date, shift_type, assigned_by)
      VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (plant_code, shift_date, shift_type)
      DO UPDATE SET user_id=$1, assigned_by=$5, updated_at=NOW()
      RETURNING *
    `, [user_id, plant_code, shift_date, shift_type || 'day', req.user.id]);

    return res.status(200).json({
      success: true,
      message: `${userCheck.rows[0].full_name} assigned to plant ${plant_code} on ${shift_date}`,
      data: result.rows[0],
    });
  } catch (err) {
    console.error('[assignShift]', err.message);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/supervisor/shifts — Get shift schedule
// ═══════════════════════════════════════════════════════════════════════════
exports.getShifts = async (req, res) => {
  try {
    const { plant_code, from_date, to_date } = req.query;
    const category = normalizeCategory(req.query.category || req.user?.category || DEFAULT_CATEGORY);
    if (!category) {
      return res.status(400).json({
        success: false,
        message: `Invalid category. Allowed: ${ALLOWED_CATEGORIES.join(', ')}`
      });
    }
    const today = new Date().toISOString().split('T')[0];

    let where = ['sps.is_active = TRUE', 'a.category = $1'];
    let params = [];
    let idx = 2;

    if (plant_code) { where.push(`sps.plant_code = $${idx++}`); params.push(plant_code); }
    where.push(`sps.shift_date >= $${idx++}`); params.push(from_date || today);
    if (to_date) { where.push(`sps.shift_date <= $${idx++}`); params.push(to_date); }

    const result = await pool.query(`
      SELECT sps.*,
             a.first_name || ' ' || a.last_name AS supervisor_name, a.phone AS supervisor_phone,
             ab.first_name || ' ' || ab.last_name AS assigned_by_name
      FROM supervisor_plant_shifts sps
      JOIN admin a ON a.id = sps.user_id
      LEFT JOIN admin ab ON ab.id = sps.assigned_by
      WHERE ${where.join(' AND ')}
      ORDER BY sps.shift_date, sps.plant_code
    `, [category, ...params]);

    return res.status(200).json({ success: true, total: result.rowCount, data: result.rows });
  } catch (err) {
    console.error('[getShifts]', err.message);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/supervisor/:id/plant — Get supervisor's assigned plant (read-only)
// ═══════════════════════════════════════════════════════════════════════════
exports.getSupervisorPlant = async (req, res) => {
  try {
    const user_id = req.params.id || req.user.id;
    const category = normalizeCategory(req.query.category || req.user?.category || DEFAULT_CATEGORY);
    if (!category) {
      return res.status(400).json({
        success: false,
        message: `Invalid category. Allowed: ${ALLOWED_CATEGORIES.join(', ')}`
      });
    }

    const result = await pool.query(`
      SELECT a.id, a.first_name || ' ' || a.last_name AS full_name,
             a.role, sps.plant_code, sps.shift_date, sps.shift_type
      FROM admin a
      LEFT JOIN supervisor_plant_shifts sps
        ON sps.user_id = a.id AND sps.shift_date = CURRENT_DATE AND sps.is_active = TRUE
      WHERE a.id = $1 AND a.category = $2
    `, [user_id, category]);

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Supervisor not found' });
    }

    return res.status(200).json({
      success: true,
      data: {
        ...result.rows[0],
        plant_editable: false, // Always read-only for supervisor
      }
    });
  } catch (err) {
    console.error('[getSupervisorPlant]', err.message);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
