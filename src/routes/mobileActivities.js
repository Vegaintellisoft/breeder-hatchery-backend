// routes/mobileActivities.js - Mobile: get activities for a frequency
const express = require('express');
const router = express.Router();
const pool = require('../config/db');

// ─── GET /api/mobile/activities?frequency=daily ─────────────
// Returns only ACTIVE activities for that frequency, grouped by category
router.get('/', async (req, res) => {
  try {
    const { frequency } = req.query;
    if (!frequency) return res.status(400).json({ error: 'frequency required' });

    const { rows } = await pool.query(`
      SELECT 
        a.id AS activity_id, a.code AS activity_code, a.label AS activity_label, a.sort_order,
        c.id AS category_id, c.code AS category_code, c.label AS category_label,
        afa.image_required,
        afa.sample_fields_required
      FROM activities a
      JOIN activity_categories c ON c.id = a.category_id
      JOIN activity_frequency_assignments afa ON afa.activity_id = a.id
      WHERE afa.frequency = $1 AND afa.is_active = TRUE AND c.is_active = TRUE
      ORDER BY c.sort_order, a.sort_order, a.id
    `, [frequency]);

    // group by category
    const grouped = {};
    for (const r of rows) {
      const key = r.category_code;
      if (!grouped[key]) {
        grouped[key] = {
          category_id: r.category_id,
          category_code: r.category_code,
          category_label: r.category_label,
          activities: []
        };
      }
      grouped[key].activities.push({
        activity_id: r.activity_id,
        activity_code: r.activity_code,
        activity_label: r.activity_label,
        sort_order: r.sort_order,
        image_required: r.image_required || false,
        sample_fields_required: r.sample_fields_required || false, // NEW!
        remarks: '',
        image: null
      });
    }

    res.json({ frequency, categories: Object.values(grouped) });
  } catch (err) {
    res.status(500).json({ error: 'Failed', detail: err.message });
  }
});

// ─── GET /api/mobile/frequencies ────────────────────────────
// Returns list of 7 frequency options for dropdown
router.get('/frequencies', (req, res) => {
  res.json([
    { value: 'daily',          label: 'Daily' },
    { value: 'weekly',         label: 'Weekly' },
    { value: 'fortnightly',    label: 'Fortnightly' },
    { value: 'monthly',        label: 'Monthly' },
    { value: 'two_month_once', label: '2 Months Once' },
    { value: 'quarterly',      label: 'Quarterly' },
    { value: 'bi_annually',    label: 'Bi-Annually' }
  ]);
});

// ─── GET /api/mobile/dropdowns/water-quality ─────────────────
// Returns dropdown options for "Water Quality Checking (PH/TDS)"
router.get('/dropdowns/water-quality', (req, res) => {
  res.json({
    field: 'water_quality_checking',
    label: 'Water Quality Checking (PH/TDS)',
    options: [
      { value: 'morning_check',  label: 'Morning Check' },
      { value: 'afternoon_check',label: 'Afternoon Check' },
      { value: 'evening_check',  label: 'Evening Check' },
      { value: 'routine_check',  label: 'Routine Check' },
      { value: 'special_check',  label: 'Special Check' }
    ]
  });
});

// ─── GET /api/mobile/dropdowns ───────────────────────────────
// Returns ALL dropdown options used across the mobile app
router.get('/dropdowns', (req, res) => {
  res.json({
    water_quality_checking: {
      field: 'water_quality_checking',
      label: 'Water Quality Checking (PH/TDS)',
      options: [
        { value: 'morning_check',   label: 'Morning Check' },
        { value: 'afternoon_check', label: 'Afternoon Check' },
        { value: 'evening_check',   label: 'Evening Check' },
        { value: 'routine_check',   label: 'Routine Check' },
        { value: 'special_check',   label: 'Special Check' }
      ]
    },
    sample_type: {
      field: 'sample_type',
      label: 'Sample Type',
      options: [
        { value: 'blood',  label: 'Blood' },
        { value: 'serum',  label: 'Serum' },
        { value: 'bird',   label: 'Bird' },
        { value: 'organ',  label: 'Organ' }
      ]
    },
    sample_sent_through: {
      field: 'sample_sent_through',
      label: 'Sample Sent Through',
      options: [
        { value: 'in_person', label: 'In Person' },
        { value: 'bus',       label: 'Bus' },
        { value: 'courier',   label: 'Courier' }
      ]
    }
  });
});

module.exports = router;
