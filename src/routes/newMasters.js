const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/newMastersController');
const { authenticate, adminOnly } = require('../middleware/auth');

// ── SHED MASTER ───────────────────────────────────────────────────────────
// IMPORTANT: specific sub-routes MUST come before /:id routes
// otherwise Express matches "part" and "line" as the :id value

// GET /api/masters/shed?plant_code=1902
router.get('/shed', authenticate, ctrl.getShedMaster);

// POST /api/masters/shed  { plant_code, shed_no, shed_name, ... }
router.post('/shed', authenticate, adminOnly, ctrl.addShed);

// ── PART routes (before /shed/:id) ───────────────────────────────────────
// POST /api/masters/shed/:shed_id/part
router.post('/shed/:shed_id/part',       authenticate, adminOnly, ctrl.addPart);

// PUT  /api/masters/shed/part/:id   { part_row_no, cum_birds, is_active }
router.put('/shed/part/:id',             authenticate, adminOnly, ctrl.updatePart);

// DELETE /api/masters/shed/part/:id
router.delete('/shed/part/:id',          authenticate, adminOnly, ctrl.deletePart);

// ── LINE routes (before /shed/:id) ───────────────────────────────────────
// POST /api/masters/shed/part/:part_id/line
router.post('/shed/part/:part_id/line',  authenticate, adminOnly, ctrl.addLine);

// PUT  /api/masters/shed/line/:id   { line_no, male_birds, female_birds, is_active }
router.put('/shed/line/:id',             authenticate, adminOnly, ctrl.updateLine);

// DELETE /api/masters/shed/line/:id
router.delete('/shed/line/:id',          authenticate, adminOnly, ctrl.deleteLine);

// ── SHED /:id routes (AFTER all sub-routes) ───────────────────────────────
// PUT  /api/masters/shed/:id   { shed_no, shed_name, is_active }
router.put('/shed/:id',                  authenticate, adminOnly, ctrl.updateShed);

// DELETE /api/masters/shed/:id
router.delete('/shed/:id',               authenticate, adminOnly, ctrl.deleteShed);

// ── STANDARD WEIGHT MASTER ────────────────────────────────────────────────
router.get('/standard-weight',             authenticate, ctrl.getStandardWeights);
router.get('/standard-weight/:id',         authenticate, ctrl.getStandardWeightById);
router.post('/standard-weight',            authenticate, adminOnly, ctrl.addStandardWeight);
router.put('/standard-weight/week/:id',    authenticate, adminOnly, ctrl.updateWeekRow);    // before /:id
router.delete('/standard-weight/week/:id', authenticate, adminOnly, ctrl.deleteWeekRow);    // before /:id
router.put('/standard-weight/:id',         authenticate, adminOnly, ctrl.updateStandardWeight);
router.delete('/standard-weight/:id',      authenticate, adminOnly, ctrl.deleteStandardWeight);
router.post('/standard-weight/:id/weeks',  authenticate, adminOnly, ctrl.addWeekRow);

// ── MORTALITY/CULL REASON MASTER ─────────────────────────────────────────
router.get('/mortality-cull-reasons',        authenticate, ctrl.getMortalityCullReasons);  // ?module=Mortality
router.post('/mortality-cull-reasons',       authenticate, adminOnly, ctrl.addMortalityCullReason);
router.put('/mortality-cull-reasons/:id',    authenticate, adminOnly, ctrl.updateMortalityCullReason);
router.delete('/mortality-cull-reasons/:id', authenticate, adminOnly, ctrl.deleteMortalityCullReason);

// ── BIRD GRADING MASTER ───────────────────────────────────────────────────
router.get('/bird-grading',              authenticate, ctrl.getBirdGrading);
router.post('/bird-grading',             authenticate, adminOnly, ctrl.addBirdGrading);
router.put('/bird-grading/:id',          authenticate, adminOnly, ctrl.updateBirdGrading);
router.delete('/bird-grading/:id',       authenticate, adminOnly, ctrl.deleteBirdGrading);

// ── EGG GRADING MASTER ────────────────────────────────────────────────────
router.get('/egg-grading',               authenticate, ctrl.getEggGrading);
router.post('/egg-grading',              authenticate, adminOnly, ctrl.addEggGrading);
router.put('/egg-grading/:id',           authenticate, adminOnly, ctrl.updateEggGrading);
router.delete('/egg-grading/:id',        authenticate, adminOnly, ctrl.deleteEggGrading);

// ── EGG TYPE MASTER (for egg collection categories) ───────────────────────
router.get('/egg-types',                 authenticate, ctrl.getEggTypes);
router.post('/egg-types',                authenticate, adminOnly, ctrl.addEggType);
router.put('/egg-types/:id',             authenticate, adminOnly, ctrl.updateEggType);
router.delete('/egg-types/:id',          authenticate, adminOnly, ctrl.deleteEggType);

module.exports = router;
