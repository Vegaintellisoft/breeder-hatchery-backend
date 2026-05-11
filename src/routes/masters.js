const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/mastersController');
const { authenticate, adminOnly } = require('../middleware/auth');

// ── SHED MASTER ───────────────────────────────────────────────────────────
// IMPORTANT: specific sub-routes MUST come before /:id routes

router.get('/shed',  authenticate, ctrl.getShedMaster);   // ?plant_code=1902
router.post('/shed', authenticate, adminOnly, ctrl.addShed);

// ── PART routes (before /shed/:id) ───────────────────────────────────────
router.post('/shed/part/:part_id/line',  authenticate, adminOnly, ctrl.addLine);

// PUT  /api/masters/shed/part/:id
router.put('/shed/part/:id',             authenticate, adminOnly, ctrl.updatePart);

// DELETE /api/masters/shed/part/:id
router.delete('/shed/part/:id',          authenticate, adminOnly, ctrl.deletePart);

// ── LINE routes (before /shed/:id) ───────────────────────────────────────
// PUT  /api/masters/shed/line/:id
router.put('/shed/line/:id',             authenticate, adminOnly, ctrl.updateLine);

// DELETE /api/masters/shed/line/:id
router.delete('/shed/line/:id',          authenticate, adminOnly, ctrl.deleteLine);
router.delete('/line/:id',               authenticate, adminOnly, ctrl.deleteLine);  // legacy alias

// ── SHED /:id (AFTER all sub-routes) ─────────────────────────────────────
router.put('/shed/:id',                  authenticate, adminOnly, ctrl.updateShed);
router.delete('/shed/:id',               authenticate, adminOnly, ctrl.deleteShed);

// ── STANDARD WEIGHT MASTER ────────────────────────────────────────────────
router.get('/standard-weight',              authenticate, ctrl.getStandardWeights);
router.get('/standard-weight/:id',          authenticate, ctrl.getStandardWeightById);
router.post('/standard-weight',             authenticate, adminOnly, ctrl.addStandardWeight);
router.put('/standard-weight/week/:id',     authenticate, adminOnly, ctrl.updateWeekDetail);   // before /:id
router.delete('/standard-weight/week/:id',  authenticate, adminOnly, ctrl.deleteWeekDetail);   // before /:id
router.put('/standard-weight/:id',          authenticate, adminOnly, ctrl.updateStandardWeight);
router.delete('/standard-weight/:id',       authenticate, adminOnly, ctrl.deleteStandardWeight);
router.post('/standard-weight/:id/week',    authenticate, adminOnly, ctrl.addWeekDetail);

// ── MORTALITY/CULL REASON MASTER ─────────────────────────────────────────
router.get('/mortality-cull-reasons',           authenticate, ctrl.getMortalityCullReasons);
router.post('/mortality-cull-reasons',          authenticate, adminOnly, ctrl.addMortalityCullReason);
router.put('/mortality-cull-reasons/:id',       authenticate, adminOnly, ctrl.updateMortalityCullReason);
router.delete('/mortality-cull-reasons/:id',    authenticate, adminOnly, ctrl.deleteMortalityCullReason);

// ── BIRD GRADING MASTER ───────────────────────────────────────────────────
router.get('/bird-grading',           authenticate, ctrl.getBirdGrading);
router.post('/bird-grading',          authenticate, adminOnly, ctrl.addBirdGrading);
router.put('/bird-grading/:id',       authenticate, adminOnly, ctrl.updateBirdGrading);
router.delete('/bird-grading/:id',    authenticate, adminOnly, ctrl.deleteBirdGrading);

// ── EGG GRADING MASTER ────────────────────────────────────────────────────
router.get('/egg-grading',            authenticate, ctrl.getEggGrading);
router.post('/egg-grading',           authenticate, adminOnly, ctrl.addEggGrading);
router.put('/egg-grading/:id',        authenticate, adminOnly, ctrl.updateEggGrading);
router.delete('/egg-grading/:id',     authenticate, adminOnly, ctrl.deleteEggGrading);

module.exports = router;
