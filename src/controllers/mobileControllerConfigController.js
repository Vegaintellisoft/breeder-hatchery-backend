const pool = require('../config/db');

// ═══════════════════════════════════════════════════════════════════════════
// MOBILE CONTROLLER CONFIG — Read-only APIs for mobile app
// Used by Feeding (Feed/Water/Medicine/Others), Mortality, Cull Kill,
// Egg Collection screens to determine if Part/Row and Line fields
// should be shown/required
// ═══════════════════════════════════════════════════════════════════════════

const MODULES = ['feed', 'water', 'medicine', 'others', 'mortality', 'cull_kill', 'egg_collection'];

// ── GET /api/mobile/controller-config ───────────────────────────────────
// Query: ?plant_code=0001&shed_id=5&module=mortality
// Returns field visibility config for the given plant+shed+module
exports.getConfig = async (req, res) => {
  const { plant_code, shed_id, module: mod } = req.query;

  if (!plant_code || !shed_id) {
    return res.status(422).json({
      success: false,
      message: 'plant_code and shed_id are required',
    });
  }

  if (mod && !MODULES.includes(mod)) {
    return res.status(422).json({
      success: false,
      message: `Invalid module. Must be one of: ${MODULES.join(', ')}`,
    });
  }

  try {
    const result = await pool.query(
      `SELECT * FROM breeder_controller_config
       WHERE plant_code = $1 AND shed_id = $2
       LIMIT 1`,
      [plant_code, shed_id]
    );

    // If no config exists, all fields are optional (both false)
    if (result.rowCount === 0) {
      if (mod) {
        return res.json({
          success: true,
          data: {
            plant_code,
            shed_id: parseInt(shed_id),
            module: mod,
            part_enabled: false,
            line_enabled: false,
            fields: {
              part_row: { visible: false, required: false },
              line:     { visible: false, required: false },
            },
          },
        });
      }

      const allModules = {};
      for (const m of MODULES) {
        allModules[m] = {
          part_enabled: false,
          line_enabled: false,
          fields: {
            part_row: { visible: false, required: false },
            line:     { visible: false, required: false },
          },
        };
      }
      return res.json({
        success: true,
        data: { plant_code, shed_id: parseInt(shed_id), modules: allModules },
      });
    }

    const config = result.rows[0];

    // Single module requested
    if (mod) {
      const partEnabled = config[`${mod}_part`] === true;
      const lineEnabled = config[`${mod}_line`] === true;

      return res.json({
        success: true,
        data: {
          config_id: config.id,
          plant_code: config.plant_code,
          plant_name: config.plant_name,
          shed_id: config.shed_id,
          shed_no: config.shed_no,
          module: mod,
          part_enabled: partEnabled,
          line_enabled: lineEnabled,
          fields: {
            part_row: {
              visible: partEnabled,
              required: partEnabled,
            },
            line: {
              visible: lineEnabled,
              required: lineEnabled,
            },
          },
        },
      });
    }

    // All modules requested
    const allModules = {};
    for (const m of MODULES) {
      const partEnabled = config[`${m}_part`] === true;
      const lineEnabled = config[`${m}_line`] === true;
      allModules[m] = {
        part_enabled: partEnabled,
        line_enabled: lineEnabled,
        fields: {
          part_row: {
            visible: partEnabled,
            required: partEnabled,
          },
          line: {
            visible: lineEnabled,
            required: lineEnabled,
          },
        },
      };
    }

    return res.json({
      success: true,
      data: {
        config_id: config.id,
        plant_code: config.plant_code,
        plant_name: config.plant_name,
        shed_id: config.shed_id,
        shed_no: config.shed_no,
        modules: allModules,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST /api/mobile/controller-config/validate ─────────────────────────
// Validates mobile form submission against controller toggle rules
// Body: { plant_code, shed_id, module, part_id, line_id }
exports.validate = async (req, res) => {
  const { plant_code, shed_id, module: mod, part_id, line_id } = req.body;

  if (!plant_code || !shed_id || !mod) {
    return res.status(422).json({
      success: false,
      message: 'plant_code, shed_id, and module are required',
    });
  }

  if (!MODULES.includes(mod)) {
    return res.status(422).json({
      success: false,
      message: `Invalid module. Must be one of: ${MODULES.join(', ')}`,
    });
  }

  try {
    const result = await pool.query(
      `SELECT * FROM breeder_controller_config
       WHERE plant_code = $1 AND shed_id = $2
       LIMIT 1`,
      [plant_code, shed_id]
    );

    if (result.rowCount === 0) {
      return res.json({
        success: true,
        valid: true,
        message: 'No controller config found — all fields optional',
      });
    }

    const config = result.rows[0];
    const partEnabled = config[`${mod}_part`] === true;
    const lineEnabled = config[`${mod}_line`] === true;

    const errors = [];

    if (partEnabled && !part_id) {
      errors.push('Part/Row value is required for this module');
    }

    if (lineEnabled && !line_id) {
      errors.push('Line value is required for this module');
    }

    if (lineEnabled && line_id && !part_id && partEnabled) {
      errors.push('Part/Row must be selected before Line');
    }

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        valid: false,
        module: mod,
        part_enabled: partEnabled,
        line_enabled: lineEnabled,
        errors,
      });
    }

    return res.json({
      success: true,
      valid: true,
      module: mod,
      part_enabled: partEnabled,
      line_enabled: lineEnabled,
      message: 'Validation passed',
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/mobile/controller-config/all ───────────────────────────────
// Returns all configs for a plant_code (all sheds)
// Query: ?plant_code=0001
exports.getAllForPlant = async (req, res) => {
  const { plant_code } = req.query;

  if (!plant_code) {
    return res.status(422).json({
      success: false,
      message: 'plant_code is required',
    });
  }

  try {
    const result = await pool.query(
      `SELECT bcc.*,
              COALESCE(sm.shed_name, '') AS shed_name
       FROM breeder_controller_config bcc
       LEFT JOIN shed_master sm ON sm.id = bcc.shed_id
       WHERE bcc.plant_code = $1
       ORDER BY bcc.shed_no`,
      [plant_code]
    );

    const data = result.rows.map(config => {
      const modules = {};
      for (const m of MODULES) {
        const partEnabled = config[`${m}_part`] === true;
        const lineEnabled = config[`${m}_line`] === true;
        modules[m] = {
          part_enabled: partEnabled,
          line_enabled: lineEnabled,
          fields: {
            part_row: { visible: partEnabled, required: partEnabled },
            line:     { visible: lineEnabled, required: lineEnabled },
          },
        };
      }
      return {
        config_id: config.id,
        plant_code: config.plant_code,
        plant_name: config.plant_name,
        shed_id: config.shed_id,
        shed_no: config.shed_no,
        shed_name: config.shed_name,
        modules,
      };
    });

    return res.json({
      success: true,
      total: data.length,
      data,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};
