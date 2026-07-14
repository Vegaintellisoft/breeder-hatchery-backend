const pool = require('../config/db');

// ═══════════════════════════════════════════════════════════════════════════
// BREEDER CONTROLLER CONFIG — Admin panel toggle configuration
// Manages Part/Row & Line toggles per plant+shed for 7 modules:
//   Feed, Water, Medicine, Others, Mortality, Cull Kill, Egg Collection
//
// KEY RULE: If Part = false → Line is forced to false (never Part=OFF, Line=ON)
// ═══════════════════════════════════════════════════════════════════════════

const MODULES = ['feed', 'water', 'medicine', 'others', 'mortality', 'cull_kill', 'egg_collection'];

// Helper: ensure table exists (auto-create on first call)
async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS breeder_controller_config (
      id                    SERIAL PRIMARY KEY,
      plant_code            VARCHAR(20)  NOT NULL,
      plant_name            VARCHAR(255),
      shed_id               INTEGER      NOT NULL,
      shed_no               VARCHAR(50),
      feed_part             BOOLEAN DEFAULT FALSE,
      feed_line             BOOLEAN DEFAULT FALSE,
      water_part            BOOLEAN DEFAULT FALSE,
      water_line            BOOLEAN DEFAULT FALSE,
      medicine_part         BOOLEAN DEFAULT FALSE,
      medicine_line         BOOLEAN DEFAULT FALSE,
      others_part           BOOLEAN DEFAULT FALSE,
      others_line           BOOLEAN DEFAULT FALSE,
      mortality_part        BOOLEAN DEFAULT FALSE,
      mortality_line        BOOLEAN DEFAULT FALSE,
      cull_kill_part        BOOLEAN DEFAULT FALSE,
      cull_kill_line        BOOLEAN DEFAULT FALSE,
      egg_collection_part   BOOLEAN DEFAULT FALSE,
      egg_collection_line   BOOLEAN DEFAULT FALSE,
      created_by            VARCHAR(100),
      created_at            TIMESTAMP DEFAULT NOW(),
      updated_at            TIMESTAMP DEFAULT NOW(),
      UNIQUE(plant_code, shed_id)
    )
  `);
}

// Helper: enforce Part→Line constraint on a data object
// If *_part is false, force *_line to false
function enforcePartLineRule(data) {
  for (const mod of MODULES) {
    const partKey = `${mod}_part`;
    const lineKey = `${mod}_line`;
    if (data[partKey] === false || data[partKey] === 'false') {
      data[lineKey] = false;
    }
  }
  return data;
}

// Helper: resolve plant_name from plant_master or farms
async function resolvePlantName(plant_code) {
  const pm = await pool.query(
    `SELECT plant_name FROM plant_master WHERE plant_id = $1 LIMIT 1`,
    [plant_code]
  ).catch(() => ({ rows: [] }));
  if (pm.rows.length > 0) return pm.rows[0].plant_name;

  const fm = await pool.query(
    `SELECT plant_name FROM farms WHERE plant_code = $1 LIMIT 1`,
    [plant_code]
  ).catch(() => ({ rows: [] }));
  if (fm.rows.length > 0) return fm.rows[0].plant_name;

  return plant_code;
}

// Helper: resolve shed_no from shed_master
async function resolveShedNo(shed_id) {
  const r = await pool.query(
    `SELECT shed_no FROM shed_master WHERE id = $1 LIMIT 1`,
    [shed_id]
  ).catch(() => ({ rows: [] }));
  return r.rows.length > 0 ? r.rows[0].shed_no : null;
}

// ── GET /api/controller-config ──────────────────────────────────────────
exports.getAll = async (req, res) => {
  try {
    await ensureTable();

    const { plant_code, search } = req.query;
    let where = 'WHERE 1=1';
    const params = [];
    let idx = 1;

    if (plant_code) {
      where += ` AND bcc.plant_code = $${idx++}`;
      params.push(plant_code);
    }
    if (search) {
      where += ` AND (bcc.plant_code ILIKE $${idx} OR bcc.plant_name ILIKE $${idx} OR bcc.shed_no ILIKE $${idx})`;
      params.push(`%${search}%`);
      idx++;
    }

    const result = await pool.query(`
      SELECT bcc.*,
             COALESCE(sm.shed_name, '') AS shed_name
      FROM breeder_controller_config bcc
      LEFT JOIN shed_master sm ON sm.id = bcc.shed_id
      ${where}
      ORDER BY bcc.plant_code, bcc.shed_no
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

// ── GET /api/controller-config/:id ──────────────────────────────────────
exports.getById = async (req, res) => {
  try {
    await ensureTable();

    const result = await pool.query(
      `SELECT bcc.*, COALESCE(sm.shed_name, '') AS shed_name
       FROM breeder_controller_config bcc
       LEFT JOIN shed_master sm ON sm.id = bcc.shed_id
       WHERE bcc.id = $1`,
      [req.params.id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Config not found' });
    }
    return res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST /api/controller-config ─────────────────────────────────────────
// Body: { plant_code, shed_id, feed_part, feed_line, water_part, water_line, ... }
exports.create = async (req, res) => {
  let {
    plant_code, shed_id,
    feed_part = false, feed_line = false,
    water_part = false, water_line = false,
    medicine_part = false, medicine_line = false,
    others_part = false, others_line = false,
    mortality_part = false, mortality_line = false,
    cull_kill_part = false, cull_kill_line = false,
    egg_collection_part = false, egg_collection_line = false,
  } = req.body;

  if (!plant_code || !shed_id) {
    return res.status(422).json({
      success: false,
      message: 'plant_code and shed_id are required',
    });
  }

  let data = {
    feed_part, feed_line,
    water_part, water_line,
    medicine_part, medicine_line,
    others_part, others_line,
    mortality_part, mortality_line,
    cull_kill_part, cull_kill_line,
    egg_collection_part, egg_collection_line,
  };
  data = enforcePartLineRule(data);

  try {
    await ensureTable();

    const plant_name = await resolvePlantName(plant_code);
    const shed_no = await resolveShedNo(shed_id);

    const result = await pool.query(`
      INSERT INTO breeder_controller_config
        (plant_code, plant_name, shed_id, shed_no,
         feed_part, feed_line, water_part, water_line,
         medicine_part, medicine_line, others_part, others_line,
         mortality_part, mortality_line, cull_kill_part, cull_kill_line,
         egg_collection_part, egg_collection_line,
         created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
      ON CONFLICT (plant_code, shed_id)
      DO UPDATE SET
        plant_name=$2, shed_no=$4,
        feed_part=$5, feed_line=$6,
        water_part=$7, water_line=$8,
        medicine_part=$9, medicine_line=$10,
        others_part=$11, others_line=$12,
        mortality_part=$13, mortality_line=$14,
        cull_kill_part=$15, cull_kill_line=$16,
        egg_collection_part=$17, egg_collection_line=$18,
        updated_at=NOW()
      RETURNING *
    `, [
      plant_code, plant_name, shed_id, shed_no,
      data.feed_part, data.feed_line,
      data.water_part, data.water_line,
      data.medicine_part, data.medicine_line,
      data.others_part, data.others_line,
      data.mortality_part, data.mortality_line,
      data.cull_kill_part, data.cull_kill_line,
      data.egg_collection_part, data.egg_collection_line,
      req.user?.username || 'admin',
    ]);

    return res.status(201).json({
      success: true,
      message: 'Controller config saved successfully',
      data: result.rows[0],
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── PUT /api/controller-config/:id ──────────────────────────────────────
exports.update = async (req, res) => {
  const body = { ...req.body };

  for (const mod of MODULES) {
    const partKey = `${mod}_part`;
    const lineKey = `${mod}_line`;
    if (body[partKey] === false || body[partKey] === 'false') {
      body[lineKey] = false;
    }
  }

  const toggleFields = [];
  for (const mod of MODULES) {
    toggleFields.push(`${mod}_part`, `${mod}_line`);
  }

  const sets = [];
  const vals = [];
  let idx = 1;

  for (const field of toggleFields) {
    if (body[field] !== undefined) {
      sets.push(`${field}=$${idx++}`);
      vals.push(body[field] === true || body[field] === 'true');
    }
  }

  if (body.plant_name !== undefined) { sets.push(`plant_name=$${idx++}`); vals.push(body.plant_name); }
  if (body.shed_no !== undefined)    { sets.push(`shed_no=$${idx++}`);    vals.push(body.shed_no); }

  if (!sets.length) {
    return res.status(400).json({ success: false, message: 'Nothing to update' });
  }

  sets.push(`updated_at=NOW()`);
  vals.push(req.params.id);

  try {
    const result = await pool.query(
      `UPDATE breeder_controller_config SET ${sets.join(',')} WHERE id=$${idx} RETURNING *`,
      vals
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Config not found' });
    }
    return res.json({
      success: true,
      message: 'Controller config updated successfully',
      data: result.rows[0],
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── PUT /api/controller-config/toggle ───────────────────────────────────
// Body: { id, module, field, value }
// module: "feed" | "water" | "medicine" | "others" | "mortality" | "cull_kill" | "egg_collection"
// field:  "part" | "line"
exports.toggle = async (req, res) => {
  const { id, module: mod, field, value } = req.body;

  if (!id || !mod || !field || value === undefined) {
    return res.status(422).json({
      success: false,
      message: 'id, module, field, and value are required',
    });
  }

  if (!MODULES.includes(mod)) {
    return res.status(422).json({
      success: false,
      message: `Invalid module. Must be one of: ${MODULES.join(', ')}`,
    });
  }

  if (!['part', 'line'].includes(field)) {
    return res.status(422).json({
      success: false,
      message: 'field must be "part" or "line"',
    });
  }

  const boolValue = value === true || value === 'true';

  try {
    // If turning OFF part → also turn OFF line
    if (field === 'part' && !boolValue) {
      const result = await pool.query(
        `UPDATE breeder_controller_config
         SET ${mod}_part = FALSE, ${mod}_line = FALSE, updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [id]
      );
      if (result.rowCount === 0) {
        return res.status(404).json({ success: false, message: 'Config not found' });
      }
      return res.json({
        success: true,
        message: `${mod} part turned OFF → line also turned OFF`,
        data: result.rows[0],
      });
    }

    // If turning ON line → check that part is ON first
    if (field === 'line' && boolValue) {
      const existing = await pool.query(
        `SELECT ${mod}_part FROM breeder_controller_config WHERE id = $1`,
        [id]
      );
      if (existing.rowCount === 0) {
        return res.status(404).json({ success: false, message: 'Config not found' });
      }
      if (!existing.rows[0][`${mod}_part`]) {
        return res.status(400).json({
          success: false,
          message: `Cannot enable line when part is OFF for ${mod}. Enable part first.`,
        });
      }
    }

    const column = `${mod}_${field}`;
    const result = await pool.query(
      `UPDATE breeder_controller_config
       SET ${column} = $1, updated_at = NOW()
       WHERE id = $2 RETURNING *`,
      [boolValue, id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Config not found' });
    }
    return res.json({
      success: true,
      message: `${mod} ${field} set to ${boolValue}`,
      data: result.rows[0],
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST /api/controller-config/bulk ────────────────────────────────────
// Body: { configs: [{ plant_code, shed_id, feed_part, feed_line, water_part, ... }, ...] }
exports.bulkUpsert = async (req, res) => {
  const { configs } = req.body;

  if (!Array.isArray(configs) || configs.length === 0) {
    return res.status(422).json({
      success: false,
      message: 'configs array is required and must not be empty',
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await ensureTable();

    const saved = [];

    for (const cfg of configs) {
      if (!cfg.plant_code || !cfg.shed_id) continue;

      const data = enforcePartLineRule({
        feed_part:           cfg.feed_part           ?? false,
        feed_line:           cfg.feed_line           ?? false,
        water_part:          cfg.water_part          ?? false,
        water_line:          cfg.water_line          ?? false,
        medicine_part:       cfg.medicine_part       ?? false,
        medicine_line:       cfg.medicine_line       ?? false,
        others_part:         cfg.others_part         ?? false,
        others_line:         cfg.others_line         ?? false,
        mortality_part:      cfg.mortality_part      ?? false,
        mortality_line:      cfg.mortality_line      ?? false,
        cull_kill_part:      cfg.cull_kill_part      ?? false,
        cull_kill_line:      cfg.cull_kill_line      ?? false,
        egg_collection_part: cfg.egg_collection_part ?? false,
        egg_collection_line: cfg.egg_collection_line ?? false,
      });

      const plant_name = cfg.plant_name || await resolvePlantName(cfg.plant_code);
      const shed_no = cfg.shed_no || await resolveShedNo(cfg.shed_id);

      const result = await client.query(`
        INSERT INTO breeder_controller_config
          (plant_code, plant_name, shed_id, shed_no,
           feed_part, feed_line, water_part, water_line,
           medicine_part, medicine_line, others_part, others_line,
           mortality_part, mortality_line, cull_kill_part, cull_kill_line,
           egg_collection_part, egg_collection_line,
           created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
        ON CONFLICT (plant_code, shed_id)
        DO UPDATE SET
          plant_name=$2, shed_no=$4,
          feed_part=$5, feed_line=$6,
          water_part=$7, water_line=$8,
          medicine_part=$9, medicine_line=$10,
          others_part=$11, others_line=$12,
          mortality_part=$13, mortality_line=$14,
          cull_kill_part=$15, cull_kill_line=$16,
          egg_collection_part=$17, egg_collection_line=$18,
          updated_at=NOW()
        RETURNING *
      `, [
        cfg.plant_code, plant_name, cfg.shed_id, shed_no,
        data.feed_part, data.feed_line,
        data.water_part, data.water_line,
        data.medicine_part, data.medicine_line,
        data.others_part, data.others_line,
        data.mortality_part, data.mortality_line,
        data.cull_kill_part, data.cull_kill_line,
        data.egg_collection_part, data.egg_collection_line,
        req.user?.username || 'admin',
      ]);

      saved.push(result.rows[0]);
    }

    await client.query('COMMIT');
    return res.status(200).json({
      success: true,
      message: `${saved.length} controller config(s) saved`,
      total: saved.length,
      data: saved,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    return res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
};

// ── DELETE /api/controller-config/:id ───────────────────────────────────
exports.resetConfig = async (req, res) => {
  try {
    const sets = MODULES.map(m => `${m}_part=FALSE, ${m}_line=FALSE`).join(', ');
    const result = await pool.query(
      `UPDATE breeder_controller_config SET ${sets}, updated_at=NOW() WHERE id=$1 RETURNING *`,
      [req.params.id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Config not found' });
    }
    return res.json({
      success: true,
      message: 'All toggles reset to OFF',
      data: result.rows[0],
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};
