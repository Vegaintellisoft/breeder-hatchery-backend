const pool = require('../config/db');

const TABLE = 'breeder_supply';

// ─── Helper: build column list from body ──────────────────────────────────
function getCols(body) {
  return Object.keys(body).filter(k =>
    !['id','created_at','updated_at'].includes(k)
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/breeder-supply/create
// ═══════════════════════════════════════════════════════════════════════════
exports.create = async (req, res) => {
  try {
    const data = req.body;
    if (req.user?.username) data.created_by = req.user.username;

    const cols   = getCols(data);
    const vals   = cols.map(c => data[c]);
    const phs    = cols.map((_,i) => `$${i+1}`).join(', ');
    const colStr = cols.map(c => `"${c}"`).join(', ');

    const result = await pool.query(
      `INSERT INTO "${TABLE}" (${colStr}) VALUES (${phs}) RETURNING *`,
      vals
    );

    return res.status(201).json({
      status:  true,
      message: 'Breeder supply record created successfully',
      data:    result.rows[0]
    });
  } catch (err) {
    console.error('[breederSupply.create]', err.message);
    return res.status(500).json({ status:false, message:err.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/breeder-supply/getAll
// Optional: ?plant_code=1902&flock_no=LY000001&date=2026-04-15&status=pending
// ═══════════════════════════════════════════════════════════════════════════
exports.getAll = async (req, res) => {
  try {
    const { plant_code, flock_no, date, status, from_date, to_date } = req.query;
    let where = [];
    let params = [];
    let idx = 1;

    if (plant_code) { where.push(`plant_code=$${idx++}`); params.push(plant_code); }
    if (flock_no)   { where.push(`flock_no=$${idx++}`);   params.push(flock_no); }
    if (date)       { where.push(`date=$${idx++}`);        params.push(date); }
    if (status)     { where.push(`status=$${idx++}`);      params.push(status); }
    if (from_date)  { where.push(`date>=$${idx++}`);       params.push(from_date); }
    if (to_date)    { where.push(`date<=$${idx++}`);        params.push(to_date); }

    const sql = `SELECT * FROM "${TABLE}"
      ${where.length ? 'WHERE '+where.join(' AND ') : ''}
      ORDER BY created_at DESC`;

    const result = await pool.query(sql, params);

    return res.status(200).json({
      status: true,
      total:  result.rowCount,
      data:   result.rows
    });
  } catch (err) {
    console.error('[breederSupply.getAll]', err.message);
    return res.status(500).json({ status:false, message:err.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/breeder-supply/getOne/:id
// ═══════════════════════════════════════════════════════════════════════════
exports.getOne = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM "${TABLE}" WHERE id=$1`, [req.params.id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ status:false, message:`Record ID ${req.params.id} not found` });
    }
    return res.status(200).json({ status:true, data:result.rows[0] });
  } catch (err) {
    return res.status(500).json({ status:false, message:err.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// PUT /api/breeder-supply/update/:id
// ═══════════════════════════════════════════════════════════════════════════
exports.update = async (req, res) => {
  try {
    const { id } = req.params;
    const data   = req.body;

    const cols      = getCols(data);
    const setClauses= cols.map((c,i) => `"${c}"=$${i+1}`).join(', ');
    const vals      = cols.map(c => data[c]);
    vals.push(id);

    const result = await pool.query(
      `UPDATE "${TABLE}" SET ${setClauses}, "updated_at"=NOW()
       WHERE id=$${vals.length} RETURNING *`,
      vals
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ status:false, message:`Record ID ${id} not found` });
    }

    return res.status(200).json({
      status:  true,
      message: 'Breeder supply record updated successfully',
      data:    result.rows[0]
    });
  } catch (err) {
    console.error('[breederSupply.update]', err.message);
    return res.status(500).json({ status:false, message:err.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// DELETE /api/breeder-supply/remove/:id
// ═══════════════════════════════════════════════════════════════════════════
exports.remove = async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM "${TABLE}" WHERE id=$1 RETURNING id`, [req.params.id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ status:false, message:`Record ID ${req.params.id} not found` });
    }
    return res.status(200).json({
      status:  true,
      message: `Breeder supply record ID ${req.params.id} deleted successfully`
    });
  } catch (err) {
    return res.status(500).json({ status:false, message:err.message });
  }
};
