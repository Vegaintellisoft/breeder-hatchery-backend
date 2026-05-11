const { parseDate, todayDate, formatRow } = require('../utils/dateUtils');
const pool = require('../config/db');

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/breeder/flocks
// ═══════════════════════════════════════════════════════════════════════════
const getFlocks = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT f.id, f.flock_no, f.breed, f.start_date,
              f.male_opening_stock, f.female_opening_stock,
              u.unit_name
       FROM flocks f
       LEFT JOIN units u ON u.id = f.unit_id
       WHERE f.is_active = TRUE
       ORDER BY f.flock_no`
    );
    return res.status(200).json({ success: true, data: result.rows });
  } catch (err) {
    console.error('[getFlocks]', err.message);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/breeder/flock/:flock_id/opening-stock?entry_date=YYYY-MM-DD
// Called when user selects flock on the form
// ═══════════════════════════════════════════════════════════════════════════
const getOpeningStock = async (req, res) => {
  const { flock_id } = req.params;
  const { entry_date } = req.query;

  try {
    const flockResult = await pool.query(
      `SELECT f.id, f.flock_no, f.breed,
              f.male_opening_stock   AS base_male_opening,
              f.female_opening_stock AS base_female_opening,
              u.unit_name
       FROM flocks f
       LEFT JOIN units u ON u.id = f.unit_id
       WHERE f.id = $1 AND f.is_active = TRUE`,
      [flock_id]
    );

    if (flockResult.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Flock not found' });
    }

    const flock = flockResult.rows[0];

    // Check previous day closing stock → use as opening if exists
    if (entry_date) {
      const prevEntry = await pool.query(
        `SELECT male_closing_stock, female_closing_stock, TO_CHAR(entry_date,'YYYY-MM-DD') AS entry_date
         FROM breeder_daily_entries
         WHERE flock_id = $1 AND entry_date < $2
         ORDER BY entry_date DESC
         LIMIT 1`,
        [flock_id, entry_date]
      );

      if (prevEntry.rowCount > 0) {
        const prev = prevEntry.rows[0];
        return res.status(200).json({
          success: true,
          source: 'previous_day_closing',
          reference_date: prev.entry_date,
          flock_no: flock.flock_no,
          unit_name: flock.unit_name,
          data: {
            male_opening_stock:   prev.male_closing_stock,
            female_opening_stock: prev.female_closing_stock,
          },
        });
      }
    }

    // No previous entry → return SAP seeded values
    return res.status(200).json({
      success: true,
      source: 'sap_seed',
      flock_no: flock.flock_no,
      unit_name: flock.unit_name,
      data: {
        male_opening_stock:   flock.base_male_opening,
        female_opening_stock: flock.base_female_opening,
      },
    });

  } catch (err) {
    console.error('[getOpeningStock]', err.message);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/breeder/entry  — Save or update daily entry
// ═══════════════════════════════════════════════════════════════════════════
const saveEntry = async (req, res) => {
  const {
    flock_id,
    entry_date,
    day_name,
    week_label,
    age_years,

    male_opening_stock   = 0,
    male_mortality       = 0,
    male_culls_kill      = 0,
    male_culls_sale      = 0,
    male_transfer_in     = 0,
    male_transfer_out    = 0,
    male_sales           = 0,

    female_opening_stock = 0,
    female_mortality     = 0,
    female_culls_kill    = 0,
    female_culls_sale    = 0,
    female_transfer_in   = 0,
    female_transfer_out  = 0,
    female_sales         = 0,

    feeding_notes,
    shed_hygiene_notes,
    body_weight_avg_kg,
    egg_collections      = 0,

    temp_min_celsius,
    temp_max_celsius,
    humidity_min,
    humidity_max,
    lighting_start,
    lighting_end,

    remarks,
  } = req.body;

  try {
    // Verify flock
    const flockCheck = await pool.query(
      `SELECT f.id, f.flock_no, u.unit_name
       FROM flocks f
       LEFT JOIN units u ON u.id = f.unit_id
       WHERE f.id = $1 AND f.is_active = TRUE`,
      [flock_id]
    );
    if (flockCheck.rowCount === 0) {
      return res.status(404).json({ success: false, message: `Flock ID ${flock_id} not found` });
    }

    const flock = flockCheck.rows[0];

    const query = `
      INSERT INTO breeder_daily_entries (
        flock_id, entry_date, day_name, week_label, age_years,
        male_opening_stock, male_mortality, male_culls_kill, male_culls_sale,
        male_transfer_in, male_transfer_out, male_sales,
        female_opening_stock, female_mortality, female_culls_kill, female_culls_sale,
        female_transfer_in, female_transfer_out, female_sales,
        feeding_notes, shed_hygiene_notes, body_weight_avg_kg, egg_collections,
        temp_min_celsius, temp_max_celsius,
        humidity_min, humidity_max,
        lighting_start, lighting_end,
        remarks
      )
      VALUES (
        $1,$2,$3,$4,$5,
        $6,$7,$8,$9,$10,$11,$12,
        $13,$14,$15,$16,$17,$18,$19,
        $20,$21,$22,$23,
        $24,$25,$26,$27,$28,$29,
        $30
      )
      ON CONFLICT (flock_id, entry_date)
      DO UPDATE SET
        day_name             = EXCLUDED.day_name,
        week_label           = EXCLUDED.week_label,
        age_years            = EXCLUDED.age_years,
        male_opening_stock   = EXCLUDED.male_opening_stock,
        male_mortality       = EXCLUDED.male_mortality,
        male_culls_kill      = EXCLUDED.male_culls_kill,
        male_culls_sale      = EXCLUDED.male_culls_sale,
        male_transfer_in     = EXCLUDED.male_transfer_in,
        male_transfer_out    = EXCLUDED.male_transfer_out,
        male_sales           = EXCLUDED.male_sales,
        female_opening_stock = EXCLUDED.female_opening_stock,
        female_mortality     = EXCLUDED.female_mortality,
        female_culls_kill    = EXCLUDED.female_culls_kill,
        female_culls_sale    = EXCLUDED.female_culls_sale,
        female_transfer_in   = EXCLUDED.female_transfer_in,
        female_transfer_out  = EXCLUDED.female_transfer_out,
        female_sales         = EXCLUDED.female_sales,
        feeding_notes        = EXCLUDED.feeding_notes,
        shed_hygiene_notes   = EXCLUDED.shed_hygiene_notes,
        body_weight_avg_kg   = EXCLUDED.body_weight_avg_kg,
        egg_collections      = EXCLUDED.egg_collections,
        temp_min_celsius     = EXCLUDED.temp_min_celsius,
        temp_max_celsius     = EXCLUDED.temp_max_celsius,
        humidity_min         = EXCLUDED.humidity_min,
        humidity_max         = EXCLUDED.humidity_max,
        lighting_start       = EXCLUDED.lighting_start,
        lighting_end         = EXCLUDED.lighting_end,
        remarks              = EXCLUDED.remarks,
        updated_at           = NOW()
      RETURNING *;
    `;

    const values = [
      flock_id, entry_date, day_name, week_label, age_years,
      male_opening_stock, male_mortality, male_culls_kill, male_culls_sale,
      male_transfer_in, male_transfer_out, male_sales,
      female_opening_stock, female_mortality, female_culls_kill, female_culls_sale,
      female_transfer_in, female_transfer_out, female_sales,
      feeding_notes, shed_hygiene_notes, body_weight_avg_kg, egg_collections,
      temp_min_celsius, temp_max_celsius,
      humidity_min, humidity_max,
      lighting_start, lighting_end,
      remarks,
    ];

    const result = await pool.query(query, values);
    const entry  = result.rows[0];

    return res.status(200).json({
      success: true,
      message: 'Entry saved successfully',
      data: {
        id:          entry.id,
        flock_id:    entry.flock_id,
        flock_no:    flock.flock_no,
        unit_name:   flock.unit_name,
        entry_date:  entry.entry_date,
        day_name:    entry.day_name,
        week_label:  entry.week_label,
        age_years:   entry.age_years,
        male: {
          opening_stock: entry.male_opening_stock,
          mortality:     entry.male_mortality,
          culls_kill:    entry.male_culls_kill,
          culls_sale:    entry.male_culls_sale,
          transfer_in:   entry.male_transfer_in,
          transfer_out:  entry.male_transfer_out,
          sales:         entry.male_sales,
          closing_stock: entry.male_closing_stock,
        },
        female: {
          opening_stock: entry.female_opening_stock,
          mortality:     entry.female_mortality,
          culls_kill:    entry.female_culls_kill,
          culls_sale:    entry.female_culls_sale,
          transfer_in:   entry.female_transfer_in,
          transfer_out:  entry.female_transfer_out,
          sales:         entry.female_sales,
          closing_stock: entry.female_closing_stock,
        },
        total_closing_stock: entry.male_closing_stock + entry.female_closing_stock,
        production: {
          feeding_notes:      entry.feeding_notes,
          shed_hygiene_notes: entry.shed_hygiene_notes,
          body_weight_avg_kg: entry.body_weight_avg_kg,
          egg_collections:    entry.egg_collections,
        },
        environmental: {
          temp_min_celsius: entry.temp_min_celsius,
          temp_max_celsius: entry.temp_max_celsius,
          humidity_min:     entry.humidity_min,
          humidity_max:     entry.humidity_max,
          lighting_start:   entry.lighting_start,
          lighting_end:     entry.lighting_end,
        },
        remarks:    entry.remarks,
        created_at: entry.created_at,
        updated_at: entry.updated_at,
      },
    });

  } catch (err) {
    console.error('[saveEntry]', err.message);
    return res.status(500).json({ success: false, message: 'Internal server error', error: err.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/breeder/entry/:flock_id/:entry_date
// ═══════════════════════════════════════════════════════════════════════════
const getEntry = async (req, res) => {
  const { flock_id, entry_date } = req.params;
  try {
    const result = await pool.query(
      `SELECT bde.*, f.flock_no, u.unit_name
       FROM breeder_daily_entries bde
       LEFT JOIN flocks f ON f.id = bde.flock_id
       LEFT JOIN units  u ON u.id = f.unit_id
       WHERE bde.flock_id = $1 AND bde.entry_date = $2`,
      [flock_id, entry_date]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Entry not found' });
    }
    return res.status(200).json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('[getEntry]', err.message);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/breeder/entries/:flock_id?from=&to=&limit=&offset=
// ═══════════════════════════════════════════════════════════════════════════
const getEntries = async (req, res) => {
  const { flock_id } = req.params;
  const { from, to, limit = 30, offset = 0 } = req.query;

  try {
    const conditions = ['bde.flock_id = $1'];
    const params     = [flock_id];
    let   idx        = 2;

    if (from) { conditions.push(`bde.entry_date >= $${idx++}`); params.push(from); }
    if (to)   { conditions.push(`bde.entry_date <= $${idx++}`); params.push(to); }

    params.push(Number(limit), Number(offset));

    const result = await pool.query(
      `SELECT bde.*, f.flock_no, u.unit_name
       FROM breeder_daily_entries bde
       LEFT JOIN flocks f ON f.id = bde.flock_id
       LEFT JOIN units  u ON u.id = f.unit_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY bde.entry_date DESC
       LIMIT $${idx++} OFFSET $${idx}`,
      params
    );
    return res.status(200).json({ success: true, count: result.rowCount, data: result.rows });
  } catch (err) {
    console.error('[getEntries]', err.message);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

module.exports = { getFlocks, getOpeningStock, saveEntry, getEntry, getEntries };
