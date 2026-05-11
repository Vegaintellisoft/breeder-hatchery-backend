const pool = require('../config/db');

const VALID_GRADES = ['collection_1','collection_2','collection_3','collection_4','collection_5','collection_6'];

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/egg-collection/sheds
// ═══════════════════════════════════════════════════════════════════════════
const getSheds = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, shed_number, shed_name, is_active
      FROM sheds WHERE is_active = TRUE ORDER BY shed_number
    `);
    return res.status(200).json({ success: true, total: result.rowCount, data: result.rows });
  } catch (err) {
    console.error('[getSheds]', err.message);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/egg-collection/sheds/:shed_id/lines
// ═══════════════════════════════════════════════════════════════════════════
const getShedLines = async (req, res) => {
  const { shed_id } = req.params;
  try {
    const shedCheck = await pool.query(
      `SELECT id, shed_number, shed_name FROM sheds WHERE id = $1 AND is_active = TRUE`,
      [shed_id]
    );
    if (shedCheck.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Shed not found' });
    }
    const result = await pool.query(`
      SELECT id, shed_id, line_number, line_name, is_active
      FROM shed_lines WHERE shed_id = $1 AND is_active = TRUE ORDER BY line_number
    `, [shed_id]);
    return res.status(200).json({
      success: true,
      shed: shedCheck.rows[0],
      total: result.rowCount,
      data: result.rows,
    });
  } catch (err) {
    console.error('[getShedLines]', err.message);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/egg-collection/egg-types
// Global egg types — same for all lines/sheds
// ═══════════════════════════════════════════════════════════════════════════
const getEggTypes = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, egg_type, sort_order FROM egg_type_master
      WHERE is_active = TRUE ORDER BY sort_order
    `);
    return res.status(200).json({ success: true, total: result.rowCount, data: result.rows });
  } catch (err) {
    console.error('[getEggTypes]', err.message);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/egg-collection/summary?shed_id=&date=
// Auto calculated summary per shed from egg_collection_lines
// ═══════════════════════════════════════════════════════════════════════════
const getShedSummary = async (req, res) => {
  const { shed_id, date } = req.query;
  if (!shed_id || !date) {
    return res.status(422).json({ success: false, message: 'shed_id and date are required' });
  }
  try {
    const shedResult = await pool.query(
      `SELECT id, shed_number, shed_name FROM sheds WHERE id = $1`, [shed_id]
    );
    if (shedResult.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Shed not found' });
    }
    const shed = shedResult.rows[0];

    // Get all collection ids for this date
    const collections = await pool.query(
      `SELECT id FROM egg_collections WHERE collection_date = $1`, [date]
    );
    if (collections.rowCount === 0) {
      return res.status(200).json({
        success: true, shed, date,
        lines: [],
        summary: { hatching_egg: 0, table_egg: 0, jumbo_egg: 0, crack_egg: 0, waste_reject_egg: 0, grand_total: 0 }
      });
    }

    const collectionIds = collections.rows.map(r => r.id);

    // Get per-line totals for this shed
    const linesResult = await pool.query(`
      SELECT
        sl.id          AS line_id,
        sl.line_number,
        sl.line_name,
        COALESCE(SUM(ecl.broiler_egg),      0) AS broiler_egg,
        COALESCE(SUM(ecl.crack_egg),        0) AS crack_egg,
        COALESCE(SUM(ecl.jumbo_egg),        0) AS jumbo_egg,
        COALESCE(SUM(ecl.table_egg),        0) AS table_egg,
        COALESCE(SUM(ecl.waste_reject_egg), 0) AS waste_reject_egg,
        COALESCE(SUM(ecl.line_total),       0) AS line_total
      FROM shed_lines sl
      LEFT JOIN egg_collection_lines ecl
        ON ecl.line_id = sl.id AND ecl.collection_id = ANY($1)
      WHERE sl.shed_id = $2 AND sl.is_active = TRUE
      GROUP BY sl.id, sl.line_number, sl.line_name
      ORDER BY sl.line_number
    `, [collectionIds, shed_id]);

    // Auto calculate summary from lines
    const summary = linesResult.rows.reduce((acc, l) => ({
      hatching_egg:     acc.hatching_egg     + parseInt(l.broiler_egg),
      table_egg:        acc.table_egg        + parseInt(l.table_egg),
      jumbo_egg:        acc.jumbo_egg        + parseInt(l.jumbo_egg),
      crack_egg:        acc.crack_egg        + parseInt(l.crack_egg),
      waste_reject_egg: acc.waste_reject_egg + parseInt(l.waste_reject_egg),
      grand_total:      acc.grand_total      + parseInt(l.line_total),
    }), { hatching_egg: 0, table_egg: 0, jumbo_egg: 0, crack_egg: 0, waste_reject_egg: 0, grand_total: 0 });

    return res.status(200).json({
      success: true,
      shed,
      date,
      lines: linesResult.rows,
      summary,
    });
  } catch (err) {
    console.error('[getShedSummary]', err.message);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/egg-collection/save
// - shed_id only (no shed_number)
// - line_id only (no line_number)
// - no summary_lines (auto calculated)
// - grades: collection_1 to collection_6
// ═══════════════════════════════════════════════════════════════════════════
const saveCollection = async (req, res) => {
  const {
    collection_date,
    collection_id,
    schedule_time,
    collected_time,
    shed_count,
    eggs_collected,
    sheds,
  } = req.body;

  if (!collection_date || !collection_id || !schedule_time || !collected_time || !shed_count) {
    return res.status(422).json({
      success: false,
      message: 'collection_date, collection_id, schedule_time, collected_time, shed_count are required',
    });
  }
  if (!Array.isArray(sheds) || sheds.length === 0) {
    return res.status(422).json({ success: false, message: 'sheds array is required' });
  }
  for (const shed of sheds) {
    if (!shed.shed_id) {
      return res.status(422).json({ success: false, message: 'shed_id is required for each shed' });
    }
    if (shed.selected_grade && !VALID_GRADES.includes(shed.selected_grade)) {
      return res.status(422).json({
        success: false,
        message: `Invalid selected_grade "${shed.selected_grade}". Valid: ${VALID_GRADES.join(', ')}`,
      });
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── Upsert header ────────────────────────────────────────────────────
    const headerResult = await client.query(`
      INSERT INTO egg_collections
        (collection_date, collection_id, schedule_time, collected_time, shed_count, eggs_collected)
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (collection_date, collection_id)
      DO UPDATE SET
        schedule_time  = EXCLUDED.schedule_time,
        collected_time = EXCLUDED.collected_time,
        shed_count     = EXCLUDED.shed_count,
        eggs_collected = EXCLUDED.eggs_collected,
        updated_at     = NOW()
      RETURNING *
    `, [collection_date, collection_id, schedule_time, collected_time, shed_count, eggs_collected || 0]);

    const header       = headerResult.rows[0];
    const collectionPk = header.id;
    const savedSheds   = [];

    for (const shed of sheds) {
      const { shed_id, lines = [], selected_grade } = shed;

      // Get shed_number from shed_id
      const shedInfo = await client.query(
        `SELECT id, shed_number, shed_name FROM sheds WHERE id = $1`, [shed_id]
      );
      if (shedInfo.rowCount === 0) throw new Error(`shed_id ${shed_id} not found`);
      const shed_number = shedInfo.rows[0].shed_number;

      // ── Upsert egg lines ───────────────────────────────────────────────
      const savedLines = [];
      for (const line of lines) {
        const { line_id, broiler_egg = 0, crack_egg = 0, jumbo_egg = 0, table_egg = 0, waste_reject_egg = 0 } = line;

        if (!line_id) throw new Error('line_id is required for each line');

        // Get line_number from line_id
        const lineInfo = await client.query(
          `SELECT id, line_number, line_name FROM shed_lines WHERE id = $1`, [line_id]
        );
        if (lineInfo.rowCount === 0) throw new Error(`line_id ${line_id} not found`);
        const line_number = lineInfo.rows[0].line_number;

        const lineResult = await client.query(`
          INSERT INTO egg_collection_lines
            (collection_id, shed_number, line_number, shed_id, line_id,
             broiler_egg, crack_egg, jumbo_egg, table_egg, waste_reject_egg)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
          ON CONFLICT (collection_id, shed_number, line_number)
          DO UPDATE SET
            shed_id          = EXCLUDED.shed_id,
            line_id          = EXCLUDED.line_id,
            broiler_egg      = EXCLUDED.broiler_egg,
            crack_egg        = EXCLUDED.crack_egg,
            jumbo_egg        = EXCLUDED.jumbo_egg,
            table_egg        = EXCLUDED.table_egg,
            waste_reject_egg = EXCLUDED.waste_reject_egg,
            updated_at       = NOW()
          RETURNING *
        `, [collectionPk, shed_number, line_number, shed_id, line_id,
            broiler_egg, crack_egg, jumbo_egg, table_egg, waste_reject_egg]);

        savedLines.push({
          ...lineResult.rows[0],
          line_name: lineInfo.rows[0].line_name,
        });
      }

      // ── Upsert grading ─────────────────────────────────────────────────
      let savedGrading = null;
      if (selected_grade) {
        const gradingResult = await client.query(`
          INSERT INTO egg_grading_quick (collection_id, shed_number, selected_grade)
          VALUES ($1,$2,$3)
          ON CONFLICT (collection_id, shed_number)
          DO UPDATE SET selected_grade = EXCLUDED.selected_grade, updated_at = NOW()
          RETURNING *
        `, [collectionPk, shed_number, selected_grade]);
        savedGrading = gradingResult.rows[0];
      }

      // ── Auto calculate summary ─────────────────────────────────────────
      const summary = savedLines.reduce((acc, l) => ({
        hatching_egg:     acc.hatching_egg     + parseInt(l.broiler_egg),
        table_egg:        acc.table_egg        + parseInt(l.table_egg),
        jumbo_egg:        acc.jumbo_egg        + parseInt(l.jumbo_egg),
        crack_egg:        acc.crack_egg        + parseInt(l.crack_egg),
        waste_reject_egg: acc.waste_reject_egg + parseInt(l.waste_reject_egg),
        grand_total:      acc.grand_total      + parseInt(l.line_total),
      }), { hatching_egg: 0, table_egg: 0, jumbo_egg: 0, crack_egg: 0, waste_reject_egg: 0, grand_total: 0 });

      savedSheds.push({
        shed_id,
        shed_number,
        shed_name:  shedInfo.rows[0].shed_name,
        lines:      savedLines,
        grading:    savedGrading,
        summary,
      });
    }

    await client.query('COMMIT');
    return res.status(200).json({
      success: true,
      message: 'Egg collection saved successfully',
      data: {
        id:              header.id,
        collection_date: header.collection_date,
        collection_id:   header.collection_id,
        schedule_time:   header.schedule_time,
        collected_time:  header.collected_time,
        shed_count:      header.shed_count,
        eggs_collected:  header.eggs_collected,
        sheds:           savedSheds,
      },
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[saveCollection]', err.message);
    return res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/egg-collection/:collection_date/:collection_id
// ═══════════════════════════════════════════════════════════════════════════
const getCollection = async (req, res) => {
  const { collection_date, collection_id } = req.params;
  try {
    const headerResult = await pool.query(
      `SELECT * FROM egg_collections WHERE collection_date = $1 AND collection_id = $2`,
      [collection_date, collection_id]
    );
    if (headerResult.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Collection not found' });
    }
    const header       = headerResult.rows[0];
    const collectionPk = header.id;

    const linesResult = await pool.query(`
      SELECT ecl.*, sl.line_name, s.shed_name
      FROM egg_collection_lines ecl
      LEFT JOIN shed_lines sl ON sl.id = ecl.line_id
      LEFT JOIN sheds s ON s.id = ecl.shed_id
      WHERE ecl.collection_id = $1
      ORDER BY ecl.shed_number, ecl.line_number
    `, [collectionPk]);

    const gradingResult = await pool.query(
      `SELECT * FROM egg_grading_quick WHERE collection_id = $1 ORDER BY shed_number`,
      [collectionPk]
    );

    // Group by shed and auto calculate summary per shed
    const shedsMap = {};
    for (const line of linesResult.rows) {
      const sn = line.shed_number;
      if (!shedsMap[sn]) {
        shedsMap[sn] = {
          shed_number: sn,
          shed_id:     line.shed_id,
          shed_name:   line.shed_name,
          lines:       [],
          grading:     gradingResult.rows.find(g => g.shed_number === sn) || null,
          summary:     { hatching_egg: 0, table_egg: 0, jumbo_egg: 0, crack_egg: 0, waste_reject_egg: 0, grand_total: 0 },
        };
      }
      shedsMap[sn].lines.push(line);
      shedsMap[sn].summary.hatching_egg     += parseInt(line.broiler_egg);
      shedsMap[sn].summary.table_egg        += parseInt(line.table_egg);
      shedsMap[sn].summary.jumbo_egg        += parseInt(line.jumbo_egg);
      shedsMap[sn].summary.crack_egg        += parseInt(line.crack_egg);
      shedsMap[sn].summary.waste_reject_egg += parseInt(line.waste_reject_egg);
      shedsMap[sn].summary.grand_total      += parseInt(line.line_total);
    }

    return res.status(200).json({
      success: true,
      data: {
        id:              header.id,
        collection_date: header.collection_date,
        collection_id:   header.collection_id,
        schedule_time:   header.schedule_time,
        collected_time:  header.collected_time,
        shed_count:      header.shed_count,
        eggs_collected:  header.eggs_collected,
        sheds:           Object.values(shedsMap),
      },
    });
  } catch (err) {
    console.error('[getCollection]', err.message);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/egg-collection/list?date=YYYY-MM-DD&limit=20&offset=0
// ═══════════════════════════════════════════════════════════════════════════
const listCollections = async (req, res) => {
  const { date, limit = 20, offset = 0 } = req.query;
  try {
    const conditions = [];
    const params     = [];
    let   idx        = 1;
    if (date) { conditions.push(`collection_date = $${idx++}`); params.push(date); }
    params.push(Number(limit), Number(offset));
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await pool.query(`
      SELECT id, TO_CHAR(collection_date,'YYYY-MM-DD') AS collection_date, collection_id, schedule_time, collected_time, shed_count, eggs_collected, created_at
      FROM egg_collections ${where}
      ORDER BY collection_date DESC, collection_id
      LIMIT $${idx++} OFFSET $${idx}
    `, params);
    return res.status(200).json({ success: true, count: result.rowCount, data: result.rows });
  } catch (err) {
    console.error('[listCollections]', err.message);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

module.exports = {
  getSheds,
  getShedLines,
  getEggTypes,
  getShedSummary,
  saveCollection,
  getCollection,
  listCollections,
};
