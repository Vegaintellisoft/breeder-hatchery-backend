const pool = require('../config/db');

// ═══════════════════════════════════════════════════════════════════════════
// PLANT MASTER — Admin panel master table CRUD
// Fields: Plant Id | Name | Status | Address | GST | Module
// ═══════════════════════════════════════════════════════════════════════════

// Helper: ensure table exists (auto-create on first call)
async function ensurePlantMasterTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS plant_master (
      id            SERIAL PRIMARY KEY,
      plant_id      VARCHAR(20)  NOT NULL UNIQUE,
      plant_name    VARCHAR(255) NOT NULL,
      status        BOOLEAN      DEFAULT TRUE,
      address       TEXT,
      gst           VARCHAR(50),
      module        VARCHAR(50)  DEFAULT 'Breeder',
      created_by    VARCHAR(100),
      created_at    TIMESTAMP    DEFAULT NOW(),
      updated_at    TIMESTAMP    DEFAULT NOW()
    )
  `);
}

// Helper: pull plants from SAP cache & farms tables into plant_master
// This ensures any plant that SAP returns is visible in the admin grid
async function syncSapPlantsToMaster() {
  try {
    // 1. Pull from sap_plant_cache (synced by /api/sap-live/plants)
    const cacheResult = await pool.query(`
      SELECT DISTINCT plant_code, plant_name
      FROM sap_plant_cache
      WHERE plant_code IS NOT NULL AND TRIM(plant_code) <> ''
    `).catch(() => ({ rows: [] }));

    // 2. Pull from farms table
    const farmResult = await pool.query(`
      SELECT plant_code, plant_name
      FROM farms
      WHERE plant_code IS NOT NULL AND TRIM(plant_code) <> ''
    `).catch(() => ({ rows: [] }));

    // Merge — SAP cache takes priority, then farms
    const plantMap = new Map();
    for (const row of farmResult.rows) {
      if (row.plant_code) plantMap.set(row.plant_code.trim(), row.plant_name || '');
    }
    for (const row of cacheResult.rows) {
      if (row.plant_code) plantMap.set(row.plant_code.trim(), row.plant_name || '');
    }

    // Upsert into plant_master (only INSERT if not exists — don't overwrite user edits)
    for (const [plantCode, plantName] of plantMap) {
      await pool.query(`
        INSERT INTO plant_master (plant_id, plant_name, status, module, created_by)
        VALUES ($1, $2, TRUE, 'Breeder', 'sap_sync')
        ON CONFLICT (plant_id) DO NOTHING
      `, [plantCode, plantName || plantCode]);
    }
  } catch (err) {
    // Non-fatal — if sync fails, still return whatever is in plant_master
    console.error('Plant master SAP sync warning:', err.message);
  }
}

// ── GET /api/masters/plant  ─────────────────────────────────────────────
// Query params: ?module=Breeder  &search=  &status=true/false
// Returns the admin grid list (auto-syncs SAP plants first)
exports.getPlantMaster = async (req, res) => {
  try {
    await ensurePlantMasterTable();
    await syncSapPlantsToMaster();

    const { module, search, status } = req.query;
    let where = 'WHERE 1=1';
    const params = [];
    let idx = 1;

    if (module) {
      where += ` AND module = $${idx++}`;
      params.push(module);
    }
    if (status !== undefined) {
      where += ` AND status = $${idx++}`;
      params.push(status === 'true' || status === '1');
    }
    if (search) {
      where += ` AND (plant_id ILIKE $${idx} OR plant_name ILIKE $${idx} OR address ILIKE $${idx} OR gst ILIKE $${idx})`;
      params.push(`%${search}%`);
      idx++;
    }

    const result = await pool.query(`
      SELECT id, plant_id, plant_name, status, address, gst, module,
             created_by, created_at, updated_at
      FROM plant_master
      ${where}
      ORDER BY plant_id
    `, params);

    return res.json({
      success: true,
      total: result.rowCount,
      data: result.rows,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/masters/plant/:id  ─────────────────────────────────────────
exports.getPlantById = async (req, res) => {
  try {
    await ensurePlantMasterTable();

    const result = await pool.query(
      `SELECT * FROM plant_master WHERE id = $1`,
      [req.params.id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Plant not found' });
    }
    return res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST /api/masters/plant  ────────────────────────────────────────────
// Body: { plant_id, plant_name, status, address, gst, module }
exports.addPlant = async (req, res) => {
  const { plant_id, plant_name, status, address, gst, module } = req.body;

  if (!plant_id || !plant_name) {
    return res.status(422).json({
      success: false,
      message: 'plant_id and plant_name are required',
    });
  }

  try {
    await ensurePlantMasterTable();

    const result = await pool.query(
      `INSERT INTO plant_master (plant_id, plant_name, status, address, gst, module, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        plant_id.trim(),
        plant_name.trim(),
        status !== undefined ? status : true,
        address || null,
        gst || null,
        module || 'Breeder',
        req.user?.username || 'admin',
      ]
    );

    return res.status(201).json({
      success: true,
      message: 'Plant added successfully',
      data: result.rows[0],
    });
  } catch (err) {
    // Duplicate plant_id
    if (err.code === '23505') {
      return res.status(409).json({
        success: false,
        message: `Plant with ID "${plant_id}" already exists`,
      });
    }
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── PUT /api/masters/plant/:id  ─────────────────────────────────────────
// Body: any subset of { plant_id, plant_name, status, address, gst, module }
exports.updatePlant = async (req, res) => {
  const { plant_id, plant_name, status, address, gst, module } = req.body;

  const sets = [];
  const vals = [];
  let idx = 1;

  if (plant_id   !== undefined) { sets.push(`plant_id=$${idx++}`);   vals.push(plant_id); }
  if (plant_name !== undefined) { sets.push(`plant_name=$${idx++}`); vals.push(plant_name); }
  if (status     !== undefined) { sets.push(`status=$${idx++}`);     vals.push(status); }
  if (address    !== undefined) { sets.push(`address=$${idx++}`);    vals.push(address); }
  if (gst        !== undefined) { sets.push(`gst=$${idx++}`);        vals.push(gst); }
  if (module     !== undefined) { sets.push(`module=$${idx++}`);     vals.push(module); }

  if (!sets.length) {
    return res.status(400).json({ success: false, message: 'Nothing to update' });
  }

  sets.push(`updated_at=NOW()`);
  vals.push(req.params.id);

  try {
    const result = await pool.query(
      `UPDATE plant_master SET ${sets.join(',')} WHERE id=$${idx} RETURNING *`,
      vals
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Plant not found' });
    }
    return res.json({
      success: true,
      message: 'Plant updated successfully',
      data: result.rows[0],
    });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({
        success: false,
        message: `Plant with that ID already exists`,
      });
    }
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── DELETE /api/masters/plant/:id  ──────────────────────────────────────
// Soft delete — sets status to false
exports.deletePlant = async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE plant_master SET status = FALSE, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [req.params.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Plant not found' });
    }
    return res.json({ success: true, message: 'Plant deleted successfully' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};
