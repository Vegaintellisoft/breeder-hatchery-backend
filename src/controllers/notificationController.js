const pool               = require('../config/db');
const { checkAndNotify } = require('../jobs/vaccinationCron');

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/notifications?unread_only=true&limit=20&offset=0
// App polls this to show notification bell / list
// ═══════════════════════════════════════════════════════════════════════════
const getNotifications = async (req, res) => {
  const { unread_only = 'false', limit = 20, offset = 0 } = req.query;
  try {
    const conditions = [];
    const params     = [];
    let   idx        = 1;

    if (unread_only === 'true') {
      conditions.push(`is_read = FALSE`);
    }

    params.push(Number(limit), Number(offset));
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await pool.query(`
      SELECT id, type, title, message, vaccine_name, day_number,
             status, notif_date, is_read, created_at
      FROM notifications
      ${where}
      ORDER BY notif_date DESC, id DESC
      LIMIT $${idx++} OFFSET $${idx}
    `, params);

    // Count unread
    const unreadRes = await pool.query(
      `SELECT COUNT(*) AS unread_count FROM notifications WHERE is_read = FALSE`
    );

    return res.status(200).json({
      success:      true,
      unread_count: parseInt(unreadRes.rows[0].unread_count),
      count:        result.rowCount,
      data:         result.rows,
    });
  } catch (err) {
    console.error('[getNotifications]', err.message);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// PUT /api/notifications/:id/read
// Mark single notification as read
// ═══════════════════════════════════════════════════════════════════════════
const markRead = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      `UPDATE notifications SET is_read = TRUE WHERE id = $1 RETURNING id, title, is_read`,
      [id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Notification not found' });
    }
    return res.status(200).json({ success: true, message: 'Marked as read', data: result.rows[0] });
  } catch (err) {
    console.error('[markRead]', err.message);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// PUT /api/notifications/mark-all-read
// Mark all notifications as read
// ═══════════════════════════════════════════════════════════════════════════
const markAllRead = async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE notifications SET is_read = TRUE WHERE is_read = FALSE`
    );
    return res.status(200).json({
      success: true,
      message: `${result.rowCount} notification(s) marked as read`,
    });
  } catch (err) {
    console.error('[markAllRead]', err.message);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/notifications/trigger-check
// Manually trigger the cron check (for testing without waiting for 8 AM)
// ═══════════════════════════════════════════════════════════════════════════
const triggerCheck = async (req, res) => {
  try {
    const result = await checkAndNotify();
    return res.status(200).json(result);
  } catch (err) {
    console.error('[triggerCheck]', err.message);
    return res.status(500).json({ success: false, message: 'Check failed', error: err.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/notifications/farm-config
// GET + UPDATE flock start date
// ═══════════════════════════════════════════════════════════════════════════
const getFarmConfig = async (req, res) => {
  try {
    const result = await pool.query(`SELECT config_key, config_value, updated_at FROM farm_config`);
    return res.status(200).json({ success: true, data: result.rows });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

const updateFlockStartDate = async (req, res) => {
  const { flock_start_date } = req.body;
  if (!flock_start_date) {
    return res.status(422).json({ success: false, message: 'flock_start_date is required (YYYY-MM-DD)' });
  }
  try {
    await pool.query(`
      INSERT INTO farm_config (config_key, config_value, updated_at)
      VALUES ('flock_start_date', $1, NOW())
      ON CONFLICT (config_key)
      DO UPDATE SET config_value = EXCLUDED.config_value, updated_at = NOW()
    `, [flock_start_date]);

    return res.status(200).json({
      success: true,
      message: `Flock start date updated to ${flock_start_date}. Cron will use this for day calculations.`,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

module.exports = {
  getNotifications,
  markRead,
  markAllRead,
  triggerCheck,
  getFarmConfig,
  updateFlockStartDate,
};
