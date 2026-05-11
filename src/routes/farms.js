// routes/farms.js - Farm & Flock management
const express = require('express');
const router = express.Router();
const pool = require('../config/db');

// ─── GET /api/farms ─────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM farms ORDER BY plant_code');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed', detail: err.message });
  }
});

// ─── POST /api/farms ────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const { plant_code, plant_name, location, division, farm_type } = req.body;
    if (!plant_code || !plant_name) {
      return res.status(400).json({ error: 'plant_code and plant_name required' });
    }

    const { rows } = await pool.query(`
      INSERT INTO farms (plant_code, plant_name, location, division, farm_type)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (plant_code) DO UPDATE SET
        plant_name = EXCLUDED.plant_name,
        location = EXCLUDED.location,
        division = EXCLUDED.division,
        farm_type = EXCLUDED.farm_type
      RETURNING *
    `, [plant_code, plant_name, location || null, division || 'Breeder', farm_type || 'Own']);

    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed', detail: err.message });
  }
});

// ─── GET /api/farms/:id/flocks ─────────────────────────────
router.get('/:farm_id/flocks', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM farm_flocks WHERE farm_id=$1 ORDER BY flock_no', [req.params.farm_id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed', detail: err.message });
  }
});

// ─── POST /api/farms/:id/flocks ────────────────────────────
router.post('/:farm_id/flocks', async (req, res) => {
  try {
    const { flock_no, stage, date_of_receipt, male_chicks, female_chicks, age_weeks } = req.body;
    if (!flock_no) return res.status(400).json({ error: 'flock_no required' });

    const { rows } = await pool.query(`
      INSERT INTO farm_flocks (farm_id, flock_no, stage, date_of_receipt, male_chicks, female_chicks, age_weeks)
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *
    `, [
      req.params.farm_id, flock_no, stage || null, date_of_receipt || null,
      male_chicks || 0, female_chicks || 0, age_weeks || 0
    ]);

    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed', detail: err.message });
  }
});

module.exports = router;
