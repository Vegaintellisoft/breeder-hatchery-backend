const pool = require('../config/db');

// ── GET /api/farmer-master ─────────────────────────────────────────────────
// Filters: plant, status, line_code, farm_type, search, shed_no
exports.getFarmerMaster = async (req, res) => {
  try {
    const { plant, status, line_code, farm_type, search, shed_no, page, limit } = req.query;

    let where = [];
    let params = [];
    let idx = 1;

    if (plant)     { where.push(`plant = $${idx++}`);              params.push(plant); }
    if (status)    { where.push(`status = $${idx++}`);             params.push(status); }
    if (line_code) { where.push(`line_code = $${idx++}`);          params.push(line_code); }
    if (farm_type) { where.push(`farm_type = $${idx++}`);          params.push(farm_type); }
    if (shed_no)   { where.push(`shed_no = $${idx++}`);            params.push(shed_no); }
    if (search) {
      where.push(`(farmer_name ILIKE $${idx} OR supplier_code ILIKE $${idx} OR farm_number::text ILIKE $${idx})`);
      params.push(`%${search}%`); idx++;
    }

    // Default: exclude deleted
    where.push(`deletion_indicator IS DISTINCT FROM 'X'`);

    const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';

    // Pagination
    const pageNum  = parseInt(page)  || 1;
    const pageSize = parseInt(limit) || 100;
    const offset   = (pageNum - 1) * pageSize;

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM farmer_master ${whereClause}`, params
    );
    const total = parseInt(countResult.rows[0].count);

    const dataResult = await pool.query(
      `SELECT * FROM farmer_master ${whereClause}
       ORDER BY plant, farm_number, shed_no
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, pageSize, offset]
    );

    res.json({
      success: true,
      total,
      page: pageNum,
      limit: pageSize,
      pages: Math.ceil(total / pageSize),
      data: dataResult.rows
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/farmer-master/dropdown ───────────────────────────────────────
exports.getFarmerDropdown = async (req, res) => {
  try {
    const { plant, line_code } = req.query;
    let where = [`status = 'A'`, `deletion_indicator IS DISTINCT FROM 'X'`];
    let params = [];
    let idx = 1;

    if (plant)     { where.push(`plant = $${idx++}`);     params.push(plant); }
    if (line_code) { where.push(`line_code = $${idx++}`); params.push(line_code); }

    const result = await pool.query(
      `SELECT farm_number, shed_no, supplier_code, farmer_name, plant, line_code, line_name, capacity
       FROM farmer_master
       WHERE ${where.join(' AND ')}
       ORDER BY farmer_name`,
      params
    );
    res.json({ success: true, total: result.rows.length, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/farmer-master/lines ──────────────────────────────────────────
exports.getLines = async (req, res) => {
  try {
    const { plant } = req.query;
    let sql = `SELECT DISTINCT line_code, line_name FROM farmer_master
               WHERE deletion_indicator IS DISTINCT FROM 'X'`;
    const params = [];
    if (plant) { sql += ` AND plant = $1`; params.push(plant); }
    sql += ' ORDER BY line_name';
    const result = await pool.query(sql, params);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/farmer-master/:farm_number ───────────────────────────────────
exports.getFarmerByNumber = async (req, res) => {
  try {
    const { farm_number } = req.params;
    const result = await pool.query(
      `SELECT * FROM farmer_master WHERE farm_number = $1 ORDER BY shed_no`,
      [farm_number]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Farmer not found' });
    }
    res.json({ success: true, sheds: result.rows.length, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
