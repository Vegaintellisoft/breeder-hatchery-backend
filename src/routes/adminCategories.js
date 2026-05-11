// routes/adminCategories.js - Admin: manage categories
const express = require('express');
const router = express.Router();
const pool = require('../config/db');

// ─── GET all categories ─────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT c.*, COUNT(a.id) AS activity_count
      FROM activity_categories c
      LEFT JOIN activities a ON a.category_id = c.id
      GROUP BY c.id
      ORDER BY c.sort_order, c.id
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed', detail: err.message });
  }
});

// ─── POST create category ───────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const { code, label, icon, sort_order } = req.body;
    if (!code || !label) return res.status(400).json({ error: 'code and label required' });

    const { rows } = await pool.query(`
      INSERT INTO activity_categories (code, label, icon, sort_order, is_active)
      VALUES ($1, $2, $3, $4, TRUE)
      RETURNING *
    `, [code, label, icon || null, sort_order || 0]);

    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Code already exists' });
    res.status(500).json({ error: 'Failed', detail: err.message });
  }
});

// ─── PUT update category ────────────────────────────────────
router.put('/:id', async (req, res) => {
  try {
    const { label, icon, sort_order, is_active } = req.body;
    const sets = [];
    const vals = [];
    let idx = 1;

    if (label !== undefined)      { sets.push(`label=$${idx++}`);      vals.push(label); }
    if (icon !== undefined)       { sets.push(`icon=$${idx++}`);       vals.push(icon); }
    if (sort_order !== undefined) { sets.push(`sort_order=$${idx++}`); vals.push(sort_order); }
    if (is_active !== undefined)  { sets.push(`is_active=$${idx++}`);  vals.push(is_active); }

    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });

    vals.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE activity_categories SET ${sets.join(', ')} WHERE id=$${idx} RETURNING *`, vals
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed', detail: err.message });
  }
});

// ─── DELETE category (soft) ─────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE activity_categories SET is_active=FALSE WHERE id=$1 RETURNING *`, [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Category deactivated', category: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed', detail: err.message });
  }
});

module.exports = router;
