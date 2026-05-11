const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/eggCollectionV2Controller');
const { authenticate } = require('../middleware/auth');

// ── Registered as: app.use('/api/egg-collection/v2', eggCollectionV2Routes) ──

// ═══════════════════════════════════════════════════════════════════════════
// CASCADING DROPDOWNS
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/egg-collection/v2/dropdowns?plant_code=1902&flock_no=LY000001
//   Returns: flock_name, age_days, sheds[], schedule_slots[], seasons[]
//   Call once when plant+flock selected
router.get('/dropdowns', ctrl.getDropdowns);

// GET /api/egg-collection/v2/sheds?plant_code=1902
//   Step 1 — sheds for this plant (shed_master)
//   Returns: [{ id, shed_no, shed_name }]
router.get('/sheds', ctrl.getSheds);

// GET /api/egg-collection/v2/parts?shed_id=1
//   Step 2 — parts/rows for this shed (shed_part_master)
//   Returns: [{ id, part_row_no, cum_birds }]
router.get('/parts', ctrl.getParts);

// GET /api/egg-collection/v2/lines?part_id=1
//   Step 3 — lines for this part (shed_line_master)
//   Returns: [{ id, line_no, male_birds, female_birds, total_birds }]
router.get('/lines', ctrl.getLines);

// GET /api/egg-collection/v2/egg-types
//   Egg categories from egg_type_master with SAP IDs (EG000001...)
router.get('/egg-types', ctrl.getEggTypes);

// ═══════════════════════════════════════════════════════════════════════════
// SAVE  (mobile + admin use same endpoint)
// ═══════════════════════════════════════════════════════════════════════════

// POST /api/egg-collection/v2/save
//   Body: {
//     flock_no:        "LY000001",
//     plant_code:      "1902",
//     collection_date: "2026-04-10",
//     age_days:        280,              ← loaded from flock, passed from front end
//     season:          "Summer",         ← manually entered by user
//     shed_id:         1,                ← selected from dropdown
//     part_id:         2,                ← selected from dropdown (loaded by shed)
//     line_id:         3,                ← selected from dropdown (loaded by part)
//     slots: [                           ← multiple schedule time entries
//       {
//         schedule_time:    "7-8",       ← time slot e.g. "7-8", "9-10", "11-12", "1-2", "3-4", "5-6", "7-8pm"
//         table_egg:        10,          ← T column
//         jumbo_egg:        5,           ← J column
//         crack_egg:        2,           ← C column
//         waste_reject_egg: 1,           ← W column
//         hatching_egg:     20,          ← HE column
//         egg_weight:       58.5         ← egg weight for this slot
//       },
//       {
//         schedule_time:    "9-10",
//         table_egg:        8,
//         jumbo_egg:        4,
//         crack_egg:        1,
//         waste_reject_egg: 0,
//         hatching_egg:     18,
//         egg_weight:       57.2
//       }
//     ]
//   }
//   total_eggs per slot = T + J + C + W + HE  ← auto-calculated (DB generated column)
//   summary = sum of all slots               ← auto-calculated and saved
router.post('/save', authenticate, ctrl.saveCollection);

// ═══════════════════════════════════════════════════════════════════════════
// GET ENTRY  (pre-fill for edit)
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/egg-collection/v2/entry?flock_no=LY000001&date=2026-04-10&shed_id=1&part_id=2&line_id=3
//   Returns same shape as POST body — front end can pre-fill directly
//   Response: {
//     success, has_entry,
//     data: {
//       flock_no, plant_code, collection_date, age_days, season,
//       shed_id, part_id, line_id, shed_no, part_row_no, line_no,
//       slots: [{ schedule_time, table_egg, jumbo_egg, crack_egg, waste_reject_egg, hatching_egg, total_eggs, egg_weight }],
//       summary: { table_egg, jumbo_egg, crack_egg, waste_reject_egg, hatching_egg, total_eggs }
//     }
//   }
router.get('/entry', ctrl.getEntry);

// ═══════════════════════════════════════════════════════════════════════════
// LIST  (admin panel grid)
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/egg-collection/v2/list
//   ?flock_no= &plant_code= &date= &from_date= &to_date= &limit=20 &offset=0
//   Returns paginated grid with summary totals per entry
router.get('/list', ctrl.listCollections);

// ═══════════════════════════════════════════════════════════════════════════
// DELETE
// ═══════════════════════════════════════════════════════════════════════════

// DELETE /api/egg-collection/v2/:id
router.delete('/:id', ctrl.deleteCollection);

module.exports = router;
