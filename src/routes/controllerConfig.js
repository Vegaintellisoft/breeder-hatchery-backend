const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/controllerConfigController');
const { authenticate, adminOnly } = require('../middleware/auth');

// ── CONTROLLER CONFIG (Admin Panel) ───────────────────────────────────────
// GET    /api/controller-config              — list all configs (?plant_code= &search=)
// GET    /api/controller-config/:id          — get single config
// POST   /api/controller-config              — create/upsert config for plant+shed
// PUT    /api/controller-config/toggle       — toggle single switch (Part/Line)
// PUT    /api/controller-config/:id          — update config
// POST   /api/controller-config/bulk         — bulk upsert entire grid
// DELETE /api/controller-config/:id          — reset all toggles to OFF

router.get('/',         authenticate,            ctrl.getAll);
router.get('/:id',      authenticate,            ctrl.getById);
router.post('/',        authenticate, adminOnly, ctrl.create);
router.put('/toggle',   authenticate, adminOnly, ctrl.toggle);
router.put('/:id',      authenticate, adminOnly, ctrl.update);
router.post('/bulk',    authenticate, adminOnly, ctrl.bulkUpsert);
router.delete('/:id',   authenticate, adminOnly, ctrl.resetConfig);

module.exports = router;
