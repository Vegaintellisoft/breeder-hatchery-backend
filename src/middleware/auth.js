const jwt  = require('jsonwebtoken');
const pool = require('../config/db');

// Same secret as adminController — must match
const JWT_SECRET = process.env.JWT_SECRET || 'jdf_6bhfn8+_aj&8Pyjhbf';
const ALLOWED_CATEGORIES = ['Breeder', 'Hatchery'];

// ── Verify JWT token ──────────────────────────────────────────────────────
const authenticate = async (req, res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }

    const token   = header.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    const userCategory = (decoded.category || '').toString().trim();
    if (!ALLOWED_CATEGORIES.includes(userCategory)) {
      return res.status(401).json({ success: false, message: 'Invalid user category in token' });
    }

    // Look up from admin table (same table as login)
    const result = await pool.query(`
      SELECT a.id, a.username, a.first_name, a.last_name,
             a.role, a.category, a.status,
             ur.permissions
      FROM admin a
      LEFT JOIN user_roles ur
        ON ur.role_name = a.role AND ur.category = a.category
      WHERE a.id = $1 AND a.status = TRUE AND a.category = $2
    `, [decoded.id, userCategory]);

    if (result.rowCount === 0) {
      return res.status(401).json({ success: false, message: 'User not found or inactive' });
    }

    req.user = result.rows[0];
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
};

// ── Role guard ────────────────────────────────────────────────────────────
const requireRole = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({
      success: false,
      message: `Access denied. Required role: ${roles.join(' or ')}`
    });
  }
  next();
};

// ── Admin only ────────────────────────────────────────────────────────────
const adminOnly = requireRole('Super Admin', 'Farm Manager');

module.exports = { authenticate, requireRole, adminOnly };
