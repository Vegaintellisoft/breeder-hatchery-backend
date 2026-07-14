const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/mobileControllerConfigController');
const { authenticate } = require('../middleware/auth');

// ── MOBILE CONTROLLER CONFIG ──────────────────────────────────────────────
// GET    /api/mobile/controller-config            — get config for plant+shed (+module)
// GET    /api/mobile/controller-config/all        — get all configs for a plant
// POST   /api/mobile/controller-config/validate   — validate form values against rules

router.get('/',          authenticate, ctrl.getConfig);
router.get('/all',       authenticate, ctrl.getAllForPlant);
router.post('/validate', authenticate, ctrl.validate);

module.exports = router;
