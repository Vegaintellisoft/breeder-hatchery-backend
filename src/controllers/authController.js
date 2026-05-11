const pool = require('../config/db');
const jwt  = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'jdf_6bhfn8+_aj&8Pyjhbf';

// ── Helper: get unread notifications ─────────────────────────────────────
async function getUnreadNotifications(user_id) {
  const result = await pool.query(`
    SELECT id, type, title, message, plant_code, flock_no,
           frequency, due_date, priority, created_at
    FROM in_app_notifications
    WHERE user_id = $1 AND is_read = FALSE
    ORDER BY priority DESC, created_at DESC
    LIMIT 20
  `, [user_id]);
  return result.rows;
}

// ── Helper: today's due frequencies ──────────────────────────────────────
async function getTodayDue(plant_code, today) {
  const result = await pool.query(`
    SELECT flock_no, frequency, due_date, day_number, status
    FROM flock_frequency_schedule
    WHERE plant_code = $1 AND due_date = $2 AND status = 'pending'
    ORDER BY flock_no, frequency
  `, [plant_code, today]);
  return result.rows;
}

// ── Helper: overdue entries ───────────────────────────────────────────────
async function getOverdue(plant_code, today) {
  const result = await pool.query(`
    SELECT flock_no, frequency, due_date, day_number
    FROM flock_frequency_schedule
    WHERE plant_code = $1 AND due_date < $2 AND status = 'pending'
    ORDER BY due_date DESC
  `, [plant_code, today]);
  return result.rows;
}

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/auth/me
// ═══════════════════════════════════════════════════════════════════════════
exports.getMe = async (req, res) => {
  try {
    const today         = new Date().toISOString().split('T')[0];
    const user          = req.user;
    const notifications = await getUnreadNotifications(user.id);

    const data = {
      success: true,
      user: {
        id:        user.id,
        username:  user.username,
        full_name: `${user.first_name} ${user.last_name}`,
        role:      user.role,
        category:  user.category,
      },
      permissions: user.permissions,
      notifications: { unread_count: notifications.length, items: notifications },
    };

    // If supervisor — also get today's schedule
    if (user.role === 'Supervisor') {
      // Get plant from supervisor_plant_shifts
      const shiftRes = await pool.query(`
        SELECT plant_code FROM supervisor_plant_shifts
        WHERE user_id = $1 AND shift_date = $2 AND is_active = TRUE
        LIMIT 1
      `, [user.id, today]);

      const plant = shiftRes.rows[0]?.plant_code;
      if (plant) {
        const [due, overdue] = await Promise.all([
          getTodayDue(plant, today),
          getOverdue(plant, today),
        ]);
        data.today_due = due;
        data.overdue   = overdue;
        data.plant_code = plant;
      }
    }

    return res.status(200).json(data);
  } catch (err) {
    console.error('[getMe]', err.message);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/auth/notifications
// ═══════════════════════════════════════════════════════════════════════════
exports.getNotifications = async (req, res) => {
  try {
    const { mark_read } = req.query;
    const notifications  = await getUnreadNotifications(req.user.id);

    if (mark_read === 'true' && notifications.length > 0) {
      const ids = notifications.map(n => n.id);
      await pool.query(`
        UPDATE in_app_notifications
        SET is_read = TRUE, read_at = NOW()
        WHERE id = ANY($1)
      `, [ids]);
    }

    return res.status(200).json({
      success: true,
      unread_count: notifications.length,
      data: notifications,
    });
  } catch (err) {
    console.error('[getNotifications]', err.message);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/auth/change-password
// ═══════════════════════════════════════════════════════════════════════════
exports.changePassword = async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) {
    return res.status(422).json({ success: false, message: 'current_password and new_password required' });
  }
  try {
    const bcrypt  = require('bcryptjs');
    const userRes = await pool.query(`SELECT password FROM admin WHERE id=$1`, [req.user.id]);
    const match   = await bcrypt.compare(current_password, userRes.rows[0].password);
    if (!match) {
      return res.status(401).json({ success: false, message: 'Current password is incorrect' });
    }
    const newHash = await bcrypt.hash(new_password, 10);
    await pool.query(`UPDATE admin SET password=$1, updated_at=NOW() WHERE id=$2`, [newHash, req.user.id]);
    return res.status(200).json({ success: true, message: 'Password changed successfully' });
  } catch (err) {
    console.error('[changePassword]', err.message);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
