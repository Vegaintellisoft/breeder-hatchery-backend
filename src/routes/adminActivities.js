// routes/adminActivities.js - Admin: manage activities + frequency assignments
const express = require('express');
const router = express.Router();
const pool = require('../config/db');

// ─── GET all activities with their frequency assignments ────
router.get('/', async (req, res) => {
  try {
    const { category_id } = req.query;

    let q = `
      SELECT 
        a.id, a.code, a.label, a.sort_order, a.created_at,
        c.id AS category_id, c.code AS category_code, c.label AS category_label,
        json_agg(
          json_build_object(
            'frequency', afa.frequency,
            'is_active', afa.is_active
          ) ORDER BY afa.frequency
        ) FILTER (WHERE afa.id IS NOT NULL) AS frequencies
      FROM activities a
      JOIN activity_categories c ON c.id = a.category_id
      LEFT JOIN activity_frequency_assignments afa ON afa.activity_id = a.id
    `;

    const params = [];
    if (category_id) {
      q += ` WHERE a.category_id = $1`;
      params.push(parseInt(category_id));
    }

    q += ` GROUP BY a.id, c.id ORDER BY a.sort_order, a.id`;

    const { rows } = await pool.query(q, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed', detail: err.message });
  }
});

// ─── POST create activity + assign frequencies ──────────────
// Body: {
//   category_id, code, label, sort_order,
//   frequencies: ['daily', 'weekly']  // can assign to multiple
// }
router.post('/', async (req, res) => {
  const client = await pool.connect();
  try {
    const { category_id, code, label, sort_order, frequencies } = req.body;
    if (!category_id || !code || !label) {
      return res.status(400).json({ error: 'category_id, code, label required' });
    }
    if (!Array.isArray(frequencies) || !frequencies.length) {
      return res.status(400).json({ error: 'frequencies array required (e.g. ["daily","weekly"])' });
    }

    await client.query('BEGIN');

    // insert activity
    const { rows: actRows } = await client.query(`
      INSERT INTO activities (category_id, code, label, sort_order)
      VALUES ($1, $2, $3, $4) RETURNING *
    `, [category_id, code, label, sort_order || 0]);

    const activity = actRows[0];

    // insert frequency assignments
    for (const freq of frequencies) {
      await client.query(`
        INSERT INTO activity_frequency_assignments (activity_id, frequency, is_active)
        VALUES ($1, $2, TRUE)
        ON CONFLICT (activity_id, frequency) DO NOTHING
      `, [activity.id, freq]);
    }

    await client.query('COMMIT');

    // fetch full result with frequencies
    const { rows } = await pool.query(`
      SELECT a.*, json_agg(
        json_build_object('frequency', afa.frequency, 'is_active', afa.is_active)
      ) AS frequencies
      FROM activities a
      LEFT JOIN activity_frequency_assignments afa ON afa.activity_id = a.id
      WHERE a.id = $1
      GROUP BY a.id
    `, [activity.id]);

    res.status(201).json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return res.status(409).json({ error: 'Code already exists' });
    res.status(500).json({ error: 'Failed', detail: err.message });
  } finally {
    client.release();
  }
});

// ─── PUT update activity + frequencies ──────────────────────
// Body: {
//   label, sort_order,
//   frequencies: ['daily','weekly','monthly']  // replaces all assignments
// }
router.put('/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    const { label, sort_order, frequencies } = req.body;

    await client.query('BEGIN');

    // update activity fields
    const sets = [];
    const vals = [];
    let idx = 1;
    if (label !== undefined)      { sets.push(`label=$${idx++}`);      vals.push(label); }
    if (sort_order !== undefined) { sets.push(`sort_order=$${idx++}`); vals.push(sort_order); }

    if (sets.length) {
      vals.push(req.params.id);
      await client.query(`UPDATE activities SET ${sets.join(', ')} WHERE id=$${idx}`, vals);
    }

    // update frequencies if provided
    if (Array.isArray(frequencies)) {
      // delete old assignments
      await client.query('DELETE FROM activity_frequency_assignments WHERE activity_id=$1', [req.params.id]);
      // insert new ones
      for (const freq of frequencies) {
        await client.query(`
          INSERT INTO activity_frequency_assignments (activity_id, frequency, is_active)
          VALUES ($1, $2, TRUE)
        `, [req.params.id, freq]);
      }
    }

    await client.query('COMMIT');

    const { rows } = await pool.query(`
      SELECT a.*, json_agg(
        json_build_object('frequency', afa.frequency, 'is_active', afa.is_active)
      ) AS frequencies
      FROM activities a
      LEFT JOIN activity_frequency_assignments afa ON afa.activity_id = a.id
      WHERE a.id = $1
      GROUP BY a.id
    `, [req.params.id]);

    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Failed', detail: err.message });
  } finally {
    client.release();
  }
});

// ─── PATCH toggle activity active/inactive for ONE frequency
// Body: { frequency: 'weekly', is_active: false }
router.patch('/:id/toggle', async (req, res) => {
  try {
    const { frequency, is_active } = req.body;
    if (!frequency || is_active === undefined) {
      return res.status(400).json({ error: 'frequency and is_active required' });
    }

    const { rows } = await pool.query(`
      UPDATE activity_frequency_assignments
      SET is_active = $1
      WHERE activity_id = $2 AND frequency = $3
      RETURNING *
    `, [is_active, req.params.id, frequency]);

    if (!rows.length) return res.status(404).json({ error: 'Assignment not found' });
    res.json({ message: 'Toggled', assignment: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed', detail: err.message });
  }
});

// ─── DELETE activity (hard delete - removes from all frequencies)
router.delete('/:id', async (req, res) => {
  try {
    // cascade deletes frequency assignments automatically
    const { rows } = await pool.query('DELETE FROM activities WHERE id=$1 RETURNING *', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Activity deleted', activity: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed', detail: err.message });
  }
});

module.exports = router;
