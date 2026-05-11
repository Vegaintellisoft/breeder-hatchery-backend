const pool     = require('../config/db');
const CATEGORY = 'Breeder';

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/roles/getAll  or  /api/roles/getAll/:category
// ═══════════════════════════════════════════════════════════════════════════
exports.getAllRoles = async (req, res) => {
  try {
    const category = req.params.category || CATEGORY;
    const result = await pool.query(
      `SELECT * FROM user_roles WHERE category = $1 ORDER BY created_at DESC`,
      [category]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ status: false, message: 'No roles found' });
    }
    res.status(200).json({ status: true, data: result.rows });
  } catch (error) {
    console.error('[getAllRoles]', error);
    res.status(500).json({ status: false, message: 'Error fetching roles', error: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/roles/add
// Body: { role_name, status, permissions, category }
// permissions = { screen_key: { view, edit, delete }, ... }
// ═══════════════════════════════════════════════════════════════════════════
exports.addRole = async (req, res) => {
  const { role_name, status, permissions, category } = req.body;

  if (!role_name || !permissions) {
    return res.status(400).json({
      status: false,
      message: 'role_name and permissions are required'
    });
  }

  try {
    const result = await pool.query(`
      INSERT INTO user_roles (role_name, status, permissions, category)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [
      role_name,
      status !== undefined ? status : true,
      JSON.stringify(permissions),
      category || CATEGORY
    ]);

    res.status(201).json({
      status: true,
      message: 'Role added successfully',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('[addRole]', error);
    res.status(500).json({ status: false, message: 'Error adding role', error: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// PUT /api/roles/update/:id
// ═══════════════════════════════════════════════════════════════════════════
exports.updateRole = async (req, res) => {
  const { id } = req.params;
  const { role_name, status, permissions, category } = req.body;

  if (!role_name && status === undefined && !permissions && !category) {
    return res.status(400).json({ status: false, message: 'No data to update' });
  }

  try {
    const result = await pool.query(`
      UPDATE user_roles SET
        role_name   = COALESCE($1, role_name),
        status      = COALESCE($2, status),
        permissions = COALESCE($3, permissions),
        category    = COALESCE($4, category),
        updated_at  = NOW()
      WHERE id = $5
      RETURNING *
    `, [
      role_name   || null,
      status      !== undefined ? status : null,
      permissions ? JSON.stringify(permissions) : null,
      category    || null,
      id
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ status: false, message: `Role with ID ${id} not found` });
    }

    res.status(200).json({
      status: true,
      message: 'Role updated successfully',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('[updateRole]', error);
    res.status(500).json({ status: false, message: 'Error updating role', error: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// DELETE /api/roles/delete/:id
// ═══════════════════════════════════════════════════════════════════════════
exports.deleteRole = async (req, res) => {
  const { id } = req.params;
  try {
    // Check if any users are using this role
    const usersWithRole = await pool.query(
      `SELECT COUNT(*) FROM admin a
       JOIN user_roles ur ON ur.role_name = a.role AND ur.category = a.category
       WHERE ur.id = $1`,
      [id]
    );
    if (parseInt(usersWithRole.rows[0].count) > 0) {
      return res.status(409).json({
        status: false,
        message: 'Cannot delete role — users are assigned to this role'
      });
    }

    const result = await pool.query(
      `DELETE FROM user_roles WHERE id = $1 RETURNING *`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ status: false, message: `Role with ID ${id} not found` });
    }
    res.status(200).json({ status: true, message: 'Role deleted successfully', data: result.rows[0] });
  } catch (error) {
    console.error('[deleteRole]', error);
    res.status(500).json({ status: false, message: 'Error deleting role', error: error.message });
  }
};
