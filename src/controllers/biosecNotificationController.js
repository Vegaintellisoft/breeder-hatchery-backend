const pool = require('../config/db');

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/biosec-notifications?plant_code=1902
// Returns pending notifications for supervisor
// Called on: login, app open, after any submit
// ═══════════════════════════════════════════════════════════════════════════
exports.getPendingNotifications = async (req, res) => {
  const plant_code = req.query.plant_code || req.user?.plant_code;
  if (!plant_code) {
    return res.status(422).json({ success: false, message: 'plant_code required' });
  }

  try {
    const today     = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString().split('T')[0];

    // ── TODAY pending ─────────────────────────────────────────────────────
    const todayRes = await pool.query(`
      SELECT
        ffs.flock_no, ffs.frequency, ffs.due_date, ffs.day_number,
        fm.flock_name,
        'today' AS entry_type,
        0 AS days_late
      FROM flock_frequency_schedule ffs
      LEFT JOIN flock_master fm ON fm.flock_no = ffs.flock_no
      WHERE ffs.plant_code = $1
        AND ffs.due_date = CURRENT_DATE
        AND ffs.status = 'pending'
      ORDER BY ffs.flock_no, ffs.frequency
    `, [plant_code]);

    // ── OVERDUE pending (yesterday + day before — strictly max 2 days back) ──
    const overdueRes = await pool.query(`
      SELECT
        ffs.flock_no, ffs.frequency, ffs.due_date, ffs.day_number,
        fm.flock_name,
        'overdue' AS entry_type,
        (CURRENT_DATE - ffs.due_date::date) AS days_late
      FROM flock_frequency_schedule ffs
      LEFT JOIN flock_master fm ON fm.flock_no = ffs.flock_no
      WHERE ffs.plant_code = $1
        AND ffs.due_date >= CURRENT_DATE - 2
        AND ffs.due_date < CURRENT_DATE
        AND ffs.status IN ('pending','missed')
      ORDER BY ffs.due_date DESC, ffs.flock_no, ffs.frequency
    `, [plant_code]);

    // ── Group by due_date → flock_no → frequencies ───────────────────────
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
          flock_no:         row.flock_no,
          flock_name:       row.flock_name || row.flock_no,
          pending_frequencies: []
        };
      }
      grouped[d].flocks[row.flock_no].pending_frequencies.push({
        frequency:  row.frequency,
        day_number: row.day_number,
      });
    };

    overdueRes.rows.forEach(addRow);
    todayRes.rows.forEach(addRow);

    // Convert to array sorted by date ascending (oldest first)
    const notifications = Object.values(grouped)
      .map(g => ({
        ...g,
        flocks: Object.values(g.flocks)
      }))
      .sort((a, b) => a.due_date.localeCompare(b.due_date));

    const totalPending = overdueRes.rowCount + todayRes.rowCount;
    const hasOverdue   = overdueRes.rowCount > 0;

    return res.status(200).json({
      success:       true,
      plant_code,
      total_pending: totalPending,
      overdue_count: overdueRes.rowCount,
      today_count:   todayRes.rowCount,
      has_pending:   totalPending > 0,
      has_overdue:   hasOverdue,
      // Red badge count — show on notification bell
      badge_count:   totalPending,
      // Message shown on notification tap
      summary_message: hasOverdue
        ? `🔴 ${overdueRes.rowCount} overdue + ${todayRes.rowCount} today pending`
        : totalPending > 0
          ? `📋 ${totalPending} entries pending for today`
          : '✅ All entries up to date',
      notifications,  // grouped by date
    });

  } catch (err) {
    console.error('[getPendingNotifications]', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/biosec-notifications/entry-screen
// Returns data needed to load the entry screen
// ?plant_code=1902&due_date=2026-04-01&flock_no=LY000001&frequency=daily
// ═══════════════════════════════════════════════════════════════════════════
exports.getEntryScreenData = async (req, res) => {
  const { plant_code, due_date, flock_no, frequency } = req.query;

  if (!plant_code) {
    return res.status(422).json({ success: false, message: 'plant_code required' });
  }

  try {
    const today = new Date().toISOString().split('T')[0];

    // ── Get all flocks for this plant ─────────────────────────────────────
    const flocksRes = await pool.query(`
      SELECT DISTINCT
        ffs.flock_no, fm.flock_name, ffs.chick_start_date,
        fm.farm_name, fm.batch
      FROM flock_frequency_schedule ffs
      LEFT JOIN flock_master fm ON fm.flock_no = ffs.flock_no
      WHERE ffs.plant_code = $1
        AND ffs.chick_start_date IS NOT NULL
      ORDER BY ffs.flock_no
    `, [plant_code]);

    // ── Get late reasons ──────────────────────────────────────────────────
    const reasonsRes = await pool.query(`
      SELECT code, label FROM late_entry_reasons WHERE is_active = TRUE ORDER BY code
    `);

    // ── If specific flock + date given, get pending frequencies ───────────
    let pendingFrequencies = [];
    if (flock_no && due_date) {
      const pendingRes = await pool.query(`
        SELECT frequency, day_number, status
        FROM flock_frequency_schedule
        WHERE flock_no = $1 AND due_date = $2 AND status IN ('pending','missed')
        ORDER BY frequency
      `, [flock_no, due_date]);
      pendingFrequencies = pendingRes.rows;
    }

    return res.status(200).json({
      success: true,
      plant_code,
      // Plant info (read only for supervisor)
      plant: {
        plant_code,
        is_editable: false   // supervisor cannot change plant
      },
      // Flock dropdown
      flocks: flocksRes.rows.map(f => ({
        flock_no:         f.flock_no,
        flock_name:       f.flock_name || f.flock_no,
        chick_start_date: f.chick_start_date,
        label:            `${f.flock_no} — ${f.flock_name || f.flock_no}`
      })),
      // Date (auto-filled)
      selected_date:       due_date || today,
      is_late:             due_date ? due_date < today : false,
      // Late reasons dropdown
      late_reasons:        reasonsRes.rows,
      // Pending frequencies for selected flock+date
      pending_frequencies: pendingFrequencies,
      // Pre-selected values (if coming from notification tap)
      preselected: {
        flock_no:  flock_no  || null,
        frequency: frequency || null,
        due_date:  due_date  || today,
      }
    });

  } catch (err) {
    console.error('[getEntryScreenData]', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
};
