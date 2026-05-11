const pool = require('../config/db');
const fs   = require('fs');
const path = require('path');

const VALID_FIELD_TYPES = [
  'collection_photo',
  'dead_bird_collection_bin',
  'hygiene_dead_bird_disposal',
  'mortality_dip_ms_solution',
  'mortality_pit_fly_control',
  'mortality_pit_odour_control',
];

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/mortality/hen-types
// ═══════════════════════════════════════════════════════════════════════════
const getHenTypes = async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, type_name FROM hen_types WHERE is_active = TRUE ORDER BY type_name'
    );
    return res.status(200).json({ success: true, data: result.rows });
  } catch (err) {
    console.error('[getHenTypes]', err.message);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/mortality/save  (multipart/form-data)
// ONE single API — saves all fields + reporting schedule + all 6 image fields
//
// Form fields (text):
//   entry_date, hen_type_id, shed_no, part_row_no, line_no,
//   no_of_birds, reason, morning, afternoon, evening
//
// Image fields (file, multiple each):
//   collection_photo
//   dead_bird_collection_bin
//   hygiene_dead_bird_disposal
//   mortality_dip_ms_solution
//   mortality_pit_fly_control
//   mortality_pit_odour_control
// ═══════════════════════════════════════════════════════════════════════════
const saveFull = async (req, res) => {
  const {
    entry_date,
    hen_type_id,
    shed_no,
    part_row_no,
    line_no,
    no_of_birds   = 0,
    male_count    = 0,
    female_count  = 0,
    reason,
    morning   = 0,
    afternoon = 0,
    evening   = 0,
  } = req.body;

  if (!entry_date) {
    // Cleanup any uploaded files
    cleanupFiles(req.files);
    return res.status(422).json({ success: false, message: 'entry_date is required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Validate hen_type if provided
    if (hen_type_id) {
      const henCheck = await client.query(
        'SELECT id FROM hen_types WHERE id = $1 AND is_active = TRUE', [hen_type_id]
      );
      if (henCheck.rowCount === 0) {
        cleanupFiles(req.files);
        await client.query('ROLLBACK');
        return res.status(404).json({ success: false, message: `Hen type ID ${hen_type_id} not found` });
      }
    }

    // ── Upsert entry ─────────────────────────────────────────────────────
    const entryResult = await client.query(`
      INSERT INTO mortality_entries
        (entry_date, hen_type_id, shed_no, part_row_no, line_no,
         no_of_birds, male_count, female_count, reason, morning, afternoon, evening)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT (entry_date, shed_no, hen_type_id)
      DO UPDATE SET
        part_row_no  = EXCLUDED.part_row_no,
        line_no      = EXCLUDED.line_no,
        no_of_birds  = EXCLUDED.no_of_birds,
        male_count   = EXCLUDED.male_count,
        female_count = EXCLUDED.female_count,
        reason       = EXCLUDED.reason,
        morning      = EXCLUDED.morning,
        afternoon    = EXCLUDED.afternoon,
        evening      = EXCLUDED.evening,
        updated_at   = NOW()
      RETURNING *
    `, [
      entry_date,
      hen_type_id  || null,
      shed_no      || null,
      part_row_no  || null,
      line_no      || null,
      no_of_birds,
      male_count,
      female_count,
      reason       || null,
      morning, afternoon, evening,
    ]);

    const entry       = entryResult.rows[0];
    const mortality_id = entry.id;

    // ── Save images per field_type ────────────────────────────────────────
    const savedImages = {};
    for (const ft of VALID_FIELD_TYPES) savedImages[ft] = [];

    if (req.files) {
      for (const [fieldName, files] of Object.entries(req.files)) {
        if (!VALID_FIELD_TYPES.includes(fieldName)) continue;

        for (const file of files) {
          const result = await client.query(`
            INSERT INTO mortality_images
              (mortality_id, field_type, file_name, file_path, file_size, mime_type)
            VALUES ($1,$2,$3,$4,$5,$6)
            RETURNING *
          `, [mortality_id, fieldName, file.originalname, file.path, file.size, file.mimetype]);

          savedImages[fieldName].push(result.rows[0]);
        }
      }
    }

    await client.query('COMMIT');

    // Fetch hen type name
    let hen_type_name = null;
    if (hen_type_id) {
      const htRes = await pool.query('SELECT type_name FROM hen_types WHERE id = $1', [hen_type_id]);
      if (htRes.rowCount > 0) hen_type_name = htRes.rows[0].type_name;
    }

    return res.status(200).json({
      success: true,
      message: 'Mortality entry saved successfully',
      data: {
        ...entry,
        hen_type_name,
        images: savedImages,
      },
    });

  } catch (err) {
    await client.query('ROLLBACK');
    cleanupFiles(req.files);
    console.error('[saveFull]', err.message);
    return res.status(500).json({ success: false, message: 'Internal server error', error: err.message });
  } finally {
    client.release();
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// DELETE /api/mortality/image/:image_id
// ═══════════════════════════════════════════════════════════════════════════
const deleteImage = async (req, res) => {
  const { image_id } = req.params;
  try {
    const imgCheck = await pool.query(
      'SELECT id, file_path, file_name FROM mortality_images WHERE id = $1', [image_id]
    );
    if (imgCheck.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Image not found' });
    }
    const img = imgCheck.rows[0];
    if (fs.existsSync(img.file_path)) fs.unlinkSync(img.file_path);
    await pool.query('DELETE FROM mortality_images WHERE id = $1', [image_id]);
    return res.status(200).json({ success: true, message: `Image "${img.file_name}" deleted` });
  } catch (err) {
    console.error('[deleteImage]', err.message);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/mortality/entry/:entry_date
// ═══════════════════════════════════════════════════════════════════════════
const getEntry = async (req, res) => {
  const { entry_date } = req.params;
  try {
    const result = await pool.query(`
      SELECT me.*, ht.type_name AS hen_type_name
      FROM mortality_entries me
      LEFT JOIN hen_types ht ON ht.id = me.hen_type_id
      WHERE me.entry_date = $1
      ORDER BY me.id
    `, [entry_date]);

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'No entry found for this date' });
    }

    const entries = [];
    for (const entry of result.rows) {
      const imgRes = await pool.query(
        `SELECT id, field_type, file_name, file_path, file_size, mime_type, created_at
         FROM mortality_images WHERE mortality_id = $1 ORDER BY field_type, id`,
        [entry.id]
      );
      const images = {};
      for (const ft of VALID_FIELD_TYPES) images[ft] = [];
      for (const row of imgRes.rows) images[row.field_type].push(row);
      entries.push({ ...entry, images });
    }

    return res.status(200).json({ success: true, data: entries });
  } catch (err) {
    console.error('[getEntry]', err.message);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/mortality/list?from=&to=&limit=&offset=
// ═══════════════════════════════════════════════════════════════════════════
const listEntries = async (req, res) => {
  const { from, to, limit = 20, offset = 0 } = req.query;
  try {
    const conditions = [];
    const params     = [];
    let   idx        = 1;
    if (from) { conditions.push(`me.entry_date >= $${idx++}`); params.push(from); }
    if (to)   { conditions.push(`me.entry_date <= $${idx++}`); params.push(to); }
    params.push(Number(limit), Number(offset));
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await pool.query(`
      SELECT me.*, ht.type_name AS hen_type_name
      FROM mortality_entries me
      LEFT JOIN hen_types ht ON ht.id = me.hen_type_id
      ${where}
      ORDER BY me.entry_date DESC
      LIMIT $${idx++} OFFSET $${idx}
    `, params);
    return res.status(200).json({ success: true, count: result.rowCount, data: result.rows });
  } catch (err) {
    console.error('[listEntries]', err.message);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ── Helper: cleanup uploaded files on error ───────────────────────────────
function cleanupFiles(files) {
  if (!files) return;
  for (const fileArr of Object.values(files)) {
    for (const file of fileArr) {
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
    }
  }
}

module.exports = { getHenTypes, saveFull, deleteImage, getEntry, listEntries };
