const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const pool   = require('../config/db');

const JWT_SECRET = process.env.JWT_SECRET || 'jdf_6bhfn8+_aj&8Pyjhbf';
const DEFAULT_CATEGORY = 'Breeder';
const ALLOWED_CATEGORIES = ['Breeder', 'Hatchery'];

function normalizeCategory(input, fallback = DEFAULT_CATEGORY) {
  const category = (input || fallback || '').toString().trim();
  return ALLOWED_CATEGORIES.includes(category) ? category : null;
}

// ── Helper: get today's due + overdue (missed) for supervisor ─────────────
async function getSupervisorDashboard(plant_code) {
  const today = new Date().toISOString().split('T')[0];

  // Today's pending frequencies per flock
  const todayRes = await pool.query(`
    SELECT ffs.flock_no, ffs.frequency, ffs.due_date, ffs.day_number,
           fm.flock_name
    FROM flock_frequency_schedule ffs
    LEFT JOIN flock_master fm ON fm.flock_no = ffs.flock_no
    WHERE ffs.plant_code = $1
      AND ffs.due_date = $2
      AND ffs.status = 'pending'
    ORDER BY ffs.flock_no, ffs.frequency
  `, [plant_code, today]);

  // Overdue — missed entries from last 2 days (can still be entered late)
  const overdueRes = await pool.query(`
    SELECT ffs.flock_no, ffs.frequency, ffs.due_date, ffs.day_number,
           fm.flock_name,
           (CURRENT_DATE - ffs.due_date::date) AS days_late
    FROM flock_frequency_schedule ffs
    LEFT JOIN flock_master fm ON fm.flock_no = ffs.flock_no
    WHERE ffs.plant_code = $1
      AND ffs.due_date >= CURRENT_DATE - 2
      AND ffs.due_date < CURRENT_DATE
      AND ffs.status IN ('pending','missed')
    ORDER BY ffs.due_date DESC, ffs.flock_no
  `, [plant_code]);

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
        missed: []
      };
    }
    overdueByFlock[row.flock_no].missed.push({
      frequency:  row.frequency,
      due_date:   d,
      day_number: row.day_number,
      days_late:  parseInt(row.days_late),
    });
  }

  return {
    today,
    today_pending:   todayRes.rows,
    today_count:     todayRes.rowCount,
    overdue_flocks:  Object.values(overdueByFlock),
    overdue_count:   overdueRes.rowCount,
    has_overdue:     overdueRes.rowCount > 0,
    // Clear message shown to supervisor on login
    login_message:   overdueRes.rowCount > 0
      ? `⚠️ You have ${overdueRes.rowCount} missed entr${overdueRes.rowCount > 1 ? 'ies' : 'y'} from the last 2 days. Please enter them now.`
      : todayRes.rowCount > 0
        ? `📋 You have ${todayRes.rowCount} entr${todayRes.rowCount > 1 ? 'ies' : 'y'} to complete today.`
        : '✅ All entries are up to date.',
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/admin/login
// Body: { username, password, category }  (category: Breeder/Hatchery)
// ═══════════════════════════════════════════════════════════════════════════
exports.login = async (req, res) => {
  try {
    const { username, password, category } = req.body;

    if (!username || !password || !category) {
      return res.status(400).json({
        status: false,
        message: 'username, password, and category are required'
      });
    }

    const normalizedCategory = normalizeCategory(category);
    if (!normalizedCategory) {
      return res.status(400).json({
        status: false,
        message: `Invalid category. Allowed: ${ALLOWED_CATEGORIES.join(', ')}`
      });
    }

    // Get user
    const result = await pool.query(
      `SELECT * FROM admin WHERE username = $1 AND category = $2`,
      [username, normalizedCategory]
    );

    if (result.rows.length === 0) {
      const hint = normalizedCategory === 'Hatchery'
        ? ' No Hatchery user for this username. Run: npm run migrate:hatchery:login (or npm run migrate:breeder:auth). Use superadmin or hatchery_admin with password Krishi@123 after seed.'
        : '';
      return res.status(401).json({
        status: false,
        message: `Invalid credentials for category: ${normalizedCategory}.${hint}`
      });
    }

    const user = result.rows[0];

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ status: false, message: 'Invalid username or password' });
    }

    if (!user.status) {
      return res.status(403).json({ status: false, message: 'Inactive user. Contact admin' });
    }

    // Fetch role permissions
    const roleResult = await pool.query(
      `SELECT permissions FROM user_roles WHERE role_name = $1 AND category = $2`,
      [user.role, normalizedCategory]
    );

    if (roleResult.rows.length === 0) {
      return res.status(404).json({ status: false, message: 'Role not found' });
    }

    const permissions = roleResult.rows[0].permissions;

    // Update last login
    await pool.query(
      `UPDATE admin SET last_login = NOW() WHERE id = $1`,
      [user.id]
    );

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role, category: user.category },
      JWT_SECRET,
      { expiresIn: '12h' }
    );

    delete user.password;

    // ── Get plant_code from supervisor_plant_shifts (today's shift) ────────
    let plant_code = user.plant_code || null;

    // Always get today's shift plant for supervisor
    if (user.role === 'Supervisor') {
      const shiftRes = await pool.query(`
        SELECT plant_code FROM supervisor_plant_shifts
        WHERE user_id = $1 AND shift_date = CURRENT_DATE AND is_active = TRUE
        LIMIT 1
      `, [user.id]);

      if (shiftRes.rowCount > 0) {
        plant_code = shiftRes.rows[0].plant_code;
      }
    }

    // ── For Supervisor: get overdue + today pending ────────────────────────
    let supervisorData = {};
    let vaccinationBadge = 0;
    if (user.role === 'Supervisor' && plant_code) {
      try {
        supervisorData = await getSupervisorDashboard(plant_code);
      } catch(e) {
        console.error('[login] supervisor dashboard error:', e.message);
      }
      // Vaccination badge count
      try {
        const vacRes = await pool.query(`
          SELECT COUNT(*) FROM flock_vaccination_schedule
          WHERE plant_code=$1
            AND due_date >= CURRENT_DATE - 2
            AND due_date <= CURRENT_DATE
            AND status = 'pending'
        `, [plant_code]);
        vaccinationBadge = parseInt(vacRes.rows[0].count) || 0;
      } catch(e) {
        console.error('[login] vaccination badge error:', e.message);
      }
    }

    // ── Build response ─────────────────────────────────────────────────────
    const response = {
      status:      true,
      message:     'Login successful',
      token,
      user: {
        ...user,
        plant_code,          // ← always included now
      },
      permissions,
    };

    // Add supervisor-specific data
    if (user.role === 'Supervisor') {
      response.plant_code    = plant_code;   // top level for easy access
      response.today_count   = supervisorData.today_count   || 0;
      response.overdue_count = supervisorData.overdue_count || 0;
      response.has_overdue   = supervisorData.has_overdue   || false;
      response.login_message = supervisorData.login_message || '✅ All entries up to date';
      response.today_pending       = supervisorData.today_pending || [];
      response.overdue_flocks      = supervisorData.overdue_flocks|| [];
      response.vaccination_badge   = vaccinationBadge;
      response.total_badge_count   = (supervisorData.today_count||0) + (supervisorData.overdue_count||0) + vaccinationBadge;
    }

    return res.status(200).json(response);

  } catch (error) {
    console.error('[login]', error);
    res.status(500).json({ status: false, message: 'Error during login', error: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/admin/register
// Body: { first_name, last_name, username, password, email, role, status }
// ═══════════════════════════════════════════════════════════════════════════
exports.register = async (req, res) => {
  try {
    const {
      first_name,
      last_name,
      username,
      password,
      email,
      phone,
      role,
      status,
      category
    } = req.body;

    if (!first_name || !username || !password || !role) {
      return res.status(400).json({
        status: false,
        message: 'first_name, username, password, role are required'
      });
    }

    const normalizedCategory = normalizeCategory(category);
    if (!normalizedCategory) {
      return res.status(400).json({
        status: false,
        message: `Invalid category. Allowed: ${ALLOWED_CATEGORIES.join(', ')}`
      });
    }

    // Check if role exists for selected category
    const roleCheck = await pool.query(
      `SELECT id FROM user_roles WHERE role_name = $1 AND category = $2`,
      [role, normalizedCategory]
    );
    if (roleCheck.rows.length === 0) {
      return res.status(400).json({
        status: false,
        message: `Role "${role}" not found for ${normalizedCategory} category`
      });
    }

    // Check duplicate username in same category
    const existing = await pool.query(
      `SELECT id FROM admin WHERE username = $1 AND category = $2`,
      [username, normalizedCategory]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({
        status: false,
        message: `Username already exists in ${normalizedCategory} category`
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(`
      INSERT INTO admin
        (first_name, last_name, username, password, email, phone, role, category, status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING id, first_name, last_name, username, email, phone, role, category, status, created_at
    `, [
      first_name,
      last_name || '',
      username,
      hashedPassword,
      email || null,
      phone || null,
      role,
      normalizedCategory,
      status !== undefined ? status : true
    ]);

    const user = result.rows[0];
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role, category: normalizedCategory },
      JWT_SECRET,
      { expiresIn: '12h' }
    );

    return res.status(201).json({
      status: true,
      message: 'User registered successfully',
      user,
      token
    });

  } catch (error) {
    console.error('[register]', error);
    res.status(500).json({ status: false, message: 'Error while registering user', error: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/admin/getAll  or  /api/admin/getAll/:category
// ═══════════════════════════════════════════════════════════════════════════
exports.getAll = async (req, res) => {
  try {
    const category = normalizeCategory(req.params.category || DEFAULT_CATEGORY);
    if (!category) {
      return res.status(400).json({
        status: false,
        message: `Invalid category. Allowed: ${ALLOWED_CATEGORIES.join(', ')}`
      });
    }
    const result = await pool.query(
      `SELECT id, first_name, last_name, username, email, phone, role, category, status, last_login, created_at
       FROM admin WHERE category = $1 ORDER BY created_at DESC`,
      [category]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ status: false, message: `No users found for category: ${category}` });
    }
    res.status(200).json({ status: true, category, count: result.rows.length, data: result.rows });
  } catch (error) {
    console.error('[getAll]', error);
    res.status(500).json({ status: false, message: 'Error fetching users', error: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// PUT /api/admin/update/:id
// ═══════════════════════════════════════════════════════════════════════════
exports.updateAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const { first_name, last_name, username, password, email, phone, role, status } = req.body;

    if (!id) return res.status(400).json({ status: false, message: 'Admin ID required' });

    const existing = await pool.query(`SELECT * FROM admin WHERE id=$1`, [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ status: false, message: 'User not found' });
    }

    const admin = existing.rows[0];

    // Check duplicate username
    if (username && username !== admin.username) {
      const dupCheck = await pool.query(
        `SELECT id FROM admin WHERE username=$1 AND category=$2 AND id!=$3`,
        [username, admin.category, id]
      );
      if (dupCheck.rows.length > 0) {
        return res.status(409).json({ status: false, message: 'Username already in use' });
      }
    }

    let hashedPassword = admin.password;
    if (password) hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(`
      UPDATE admin SET
        first_name = COALESCE($1, first_name),
        last_name  = COALESCE($2, last_name),
        username   = COALESCE($3, username),
        password   = COALESCE($4, password),
        email      = COALESCE($5, email),
        phone      = COALESCE($6, phone),
        role       = COALESCE($7, role),
        status     = COALESCE($8, status),
        updated_at = NOW()
      WHERE id = $9
      RETURNING id, first_name, last_name, username, email, phone, role, category, status, updated_at
    `, [
      first_name || null, last_name || null, username || null,
      hashedPassword || null, email || null, phone || null,
      role || null, status !== undefined ? status : null, id
    ]);

    res.status(200).json({ status: true, message: 'Updated successfully', data: result.rows[0] });
  } catch (error) {
    console.error('[updateAdmin]', error);
    res.status(500).json({ status: false, message: 'Error updating user', error: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// DELETE /api/admin/delete/:id  (soft delete — sets status=false)
// ═══════════════════════════════════════════════════════════════════════════
exports.deleteAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `UPDATE admin SET status=FALSE, updated_at=NOW() WHERE id=$1 RETURNING id, username, status`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ status: false, message: 'User not found' });
    }
    res.status(200).json({ status: true, message: 'User deactivated', data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ status: false, message: 'Error deleting user', error: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/admin/screens  — List all screen names for role setup
// ═══════════════════════════════════════════════════════════════════════════
exports.getScreens = async (req, res) => {
  const category = normalizeCategory(req.query.category || DEFAULT_CATEGORY);
  if (!category) {
    return res.status(400).json({
      status: false,
      message: `Invalid category. Allowed: ${ALLOWED_CATEGORIES.join(', ')}`
    });
  }

  const breederScreens = [
    { key: 'egg_collection',  label: 'Egg Collection'       },
    { key: 'feeding',         label: 'Feeding'              },
    { key: 'mortality',       label: 'Mortality'            },
    { key: 'bird_weighing',   label: 'Bird Weighing'        },
    { key: 'vaccination',     label: 'Vaccination'          },
    { key: 'biosecurity',     label: 'Biosecurity'          },
    { key: 'flock_master',    label: 'Flock Master'         },
    { key: 'farmer_master',   label: 'Farmer Master'        },
    { key: 'sap_sync',        label: 'SAP Sync'             },
    { key: 'notifications',   label: 'Notifications'        },
    { key: 'supervisor_mgmt', label: 'Supervisor Management'},
    { key: 'schedule',        label: 'Schedule'             },
    { key: 'reports',         label: 'Reports'              },
    { key: 'admin_panel',     label: 'Admin Panel'          },
  ];

  const hatcheryScreens = [
    { key: 'egg_receipt',      label: 'Egg Receipt'          },
    { key: 'grade_setting',    label: 'Grade Setting'        },
    { key: 'transfer_pullout', label: 'Transfer Pullout'     },
    { key: 'medicine_issue',   label: 'Medicine Issue'       },
    { key: 'sap_sync',         label: 'SAP Sync'             },
    { key: 'notifications',    label: 'Notifications'        },
    { key: 'supervisor_mgmt',  label: 'Supervisor Management'},
    { key: 'schedule',         label: 'Schedule'             },
    { key: 'reports',          label: 'Reports'              },
    { key: 'admin_panel',      label: 'Admin Panel'          },
  ];

  const screens = category === 'Hatchery' ? hatcheryScreens : breederScreens;
  res.status(200).json({ status: true, category, data: screens });
};
