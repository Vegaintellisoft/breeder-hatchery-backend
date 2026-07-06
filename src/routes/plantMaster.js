const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/plantMasterController');
const { authenticate, adminOnly } = require('../middleware/auth');

// ── PLANT MASTER ──────────────────────────────────────────────────────────
// GET    /api/masters/plant          — list all (with optional ?module= &search= &status=)
// GET    /api/masters/plant/:id      — get single plant by id
// POST   /api/masters/plant          — add new plant
// PUT    /api/masters/plant/:id      — update plant
// DELETE /api/masters/plant/:id      — soft delete (status → false)

router.get('/',       authenticate, ctrl.getPlantMaster);
router.get('/:id',    authenticate, ctrl.getPlantById);
router.post('/',      authenticate, adminOnly, ctrl.addPlant);
router.put('/:id',    authenticate, adminOnly, ctrl.updatePlant);
router.delete('/:id', authenticate, adminOnly, ctrl.deletePlant);

module.exports = router;
