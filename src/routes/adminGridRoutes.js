const express = require('express');
const router  = express.Router();
const grid    = require('../controllers/adminGridController');
const edit    = require('../controllers/adminEditController');

// ── Registered as: app.use('/api/admin/grid', adminGridRoutes) ────────────
// Add this ONE LINE to server.js:
//   const adminGridRoutes = require('./routes/adminGridRoutes');
//   app.use('/api/admin/grid', adminGridRoutes);

// ═══════════════════════════════════════════════════════════════════════════
// DROPDOWNS  — call once on admin panel load, use across all edit forms
// GET /api/admin/grid/dropdowns
//   Returns: plants, flocks, sheds, feed_items, water_items, medicine_items,
//            other_items, mortality_reasons, cull_reasons
// ═══════════════════════════════════════════════════════════════════════════
router.get('/dropdowns', edit.getDropdowns);

// Cascading shed → part → line dropdowns (used in mortality/cull edit form)
router.get('/sheds/:shed_id/parts',  edit.getShedParts);
router.get('/parts/:part_id/lines',  edit.getPartLines);

// ═══════════════════════════════════════════════════════════════════════════
// DAILY FEED GRID  (Images 1 — Feed screen)
// ═══════════════════════════════════════════════════════════════════════════
// GET  /api/admin/grid/daily-feed
//   ?feed_type=feed|water|medicine|others  (default: feed)
//   ?search=  &from_date=  &to_date=  &plant_code=  &flock_no=  &limit=20  &offset=0
//   Grid cols: S.No | Date | Plant Name | Flock | [items summary] | Actions
router.get('/daily-feed',           grid.getDailyFeedGrid);

// GET  /api/admin/grid/daily-feed/detail
//   ?flock_no=LY000001&date=2026-04-10&feed_type=feed
//   View (eye) icon → full item list for that flock+date+type
router.get('/daily-feed/detail',    grid.getDailyFeedDetail);

// DELETE /api/admin/grid/daily-feed/date?flock_no=&date=&plant_code=  — delete ALL for a date
router.delete('/daily-feed/date',    grid.deleteFeedByDate);
// DELETE /api/admin/grid/daily-feed/:id  — removes single item row
router.delete('/daily-feed/:id',    grid.deleteFeedEntry);

// ─── Feed / Water / Medicine / Others — EDIT ────────────────────────────
// GET  /api/admin/grid/edit/feeding/:flock_no
//   ?date=2026-04-10&feed_type=feed|water|medicine|others
//   Pre-fills edit form with all saved items + bird weight (for feed)
//   Returns: { flock_no, date, feed_type, bird_weight, items:[{id, item_id, item_name,
//              uom, qty_issued_male, qty_issued_female, stock_in_bags, cum_feed}] }
router.get('/edit/feeding/:flock_no',  edit.getFeedingForEdit);

// PUT  /api/admin/grid/edit/feeding/:flock_no
//   Body: {
//     date:        "2026-04-10",
//     feed_type:   "feed",           // feed | water | medicine | others
//     plant_code:  "1902",
//     items: [
//       { item_id: 1, item_name: "Broiler Breeder Layer Mash 50KG", uom: "Bags",
//         qty_issued_male: 10, qty_issued_female: 15,
//         stock_in_bags: 200, cum_feed: 500 }
//     ],
//     male_weight:   2.45,           // only for feed_type = "feed"
//     female_weight: 2.20            // only for feed_type = "feed"
//   }
//   → Deletes old rows for flock+date+type and re-inserts edited items
router.put('/edit/feeding/:flock_no',  edit.updateFeeding);

// ═══════════════════════════════════════════════════════════════════════════
// MORTALITY TABLE GRID  (Image 2 — Mortality screen)
// ═══════════════════════════════════════════════════════════════════════════
// GET  /api/admin/grid/mortality
//   ?search=  &from_date=  &to_date=  &plant_code=  &flock_no=  &limit=20  &offset=0
//   Grid cols: S.No | Date | Plant Name | Flock | Shed | M/A/E counts | Actions
router.get('/mortality',             grid.getMortalityGrid);

// GET  /api/admin/grid/mortality/:id   — view detail popup
//   Returns: all log fields + reasons array
router.get('/mortality/:id',         grid.getMortalityDetail);

// DELETE /api/admin/grid/mortality/:id  — hard delete (cascades to reason+photo logs)
router.delete('/mortality/:id',      grid.deleteMortality);

// ─── Mortality EDIT ─────────────────────────────────────────────────────
// GET  /api/admin/grid/edit/mortality/:id
//   Pre-fills edit form — all fields from mortality_log + reason rows
//   Returns: { ...all mortality_log cols, shed_no, part_row_no, line_no,
//              line_male_birds, line_female_birds, plant_name, flock_name,
//              reasons:[{reason_id, reason_name, male_count, female_count, remarks}] }
router.get('/edit/mortality/:id',    edit.getMortalityForEdit);

// PUT  /api/admin/grid/edit/mortality/:id
//   Body: {
//     entry_date:   "2026-04-10",
//     plant_code:   "1902",
//     flock_no:     "LY000001",
//     shed_id:      1,
//     part_id:      2,
//     line_id:      3,
//     cum_birds:    9436,
//     total_male:   989,
//     total_female: 8447,
//     schedule: [
//       { slot: "morning",   male: 2, female: 3 },
//       { slot: "afternoon", male: 1, female: 1 },
//       { slot: "evening",   male: 0, female: 1 }
//     ],
//     reasons: [
//       { reason_id: 1, reason_name: "Disease", male_count: 3, female_count: 5, remarks: "Resp infection" }
//     ]
//   }
router.put('/edit/mortality/:id',    edit.updateMortality);

// ═══════════════════════════════════════════════════════════════════════════
// CULL KILL TABLE GRID  (Image 3 — Cull Kill screen)
// ═══════════════════════════════════════════════════════════════════════════
// GET  /api/admin/grid/cull-kill
//   ?search=  &from_date=  &to_date=  &plant_code=  &flock_no=  &limit=20  &offset=0
//   Grid cols: S.No | Date | Plant Name | Flock | Shed | Cull counts | Actions
router.get('/cull-kill',             grid.getCullKillGrid);

// GET  /api/admin/grid/cull-kill/:id   — view detail popup
router.get('/cull-kill/:id',         grid.getCullKillDetail);

// DELETE /api/admin/grid/cull-kill/:id
router.delete('/cull-kill/:id',      grid.deleteCullKill);

// ─── Cull Kill EDIT ──────────────────────────────────────────────────────
// GET  /api/admin/grid/edit/cull-kill/:id
//   Same response shape as mortality edit — all fields + reasons array
router.get('/edit/cull-kill/:id',    edit.getCullKillForEdit);

// PUT  /api/admin/grid/edit/cull-kill/:id
//   Same body shape as mortality PUT
router.put('/edit/cull-kill/:id',    edit.updateCullKill);

module.exports = router;

// ════════════════════════════════════════════════════════════════════════
// EGG COLLECTION GRID + EDIT
// ════════════════════════════════════════════════════════════════════════

// GET  /api/admin/grid/egg-collection
//   ?search= &from_date= &to_date= &plant_code= &flock_no= &limit=20 &offset=0
//   Grid cols: S.No | Date | Plant | Flock | Age | Season | T | J | C | W | HE | Total
router.get('/egg-collection',          grid.getEggCollectionGrid);

// GET  /api/admin/grid/egg-collection/:id   — view detail popup
//   Returns: full header + slots[] + rows[] + grand_summary
router.get('/egg-collection/:id',      grid.getEggCollectionDetail);

// DELETE /api/admin/grid/egg-collection/:id  — cascades to slots/rows/summary
router.delete('/egg-collection/:id',   grid.deleteEggCollection);

// GET  /api/admin/grid/edit/egg-collection/:id
//   Pre-fill edit form — returns same shape as POST /api/egg-collection/v2/save body
//   Response: { id, flock_no, plant_code, collection_date, age_days, season,
//               slots:[{ schedule_time, egg_weight_time, egg_weight,
//                        rows:[{ sno, shed_id, shed_no, part_id, part_row_no,
//                                line_id, line_no, table_egg, jumbo_egg,
//                                crack_egg, waste_reject_egg, hatching_egg, total_eggs }],
//                        summary:{...} }],
//               grand_summary:{...} }
router.get('/edit/egg-collection/:id', edit.getEggCollectionForEdit);

// PUT  /api/admin/grid/edit/egg-collection/:id
//   Body: same as POST /api/egg-collection/v2/save
//   { flock_no, plant_code, collection_date, age_days, season,
//     slots:[{ schedule_time, egg_weight_time, egg_weight,
//              rows:[{ shed_id, part_id, line_id,
//                     table_egg, jumbo_egg, crack_egg, waste_reject_egg, hatching_egg }] }] }
router.put('/edit/egg-collection/:id', edit.updateEggCollection);
