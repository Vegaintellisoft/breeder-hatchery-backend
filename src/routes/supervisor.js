const express = require('express');
const router  = express.Router();
const sup     = require('../controllers/supervisorController');
const { authenticate, adminOnly } = require('../middleware/auth');

// Admin only
router.get('/',              authenticate, adminOnly, sup.getSupervisors);
router.post('/',             authenticate, adminOnly, sup.createSupervisor);
router.put('/:id',           authenticate, adminOnly, sup.updateSupervisor);
router.post('/shift',        authenticate, adminOnly, sup.assignShift);
router.get('/shifts',        authenticate, adminOnly, sup.getShifts);

// Supervisor can see their own plant (read-only)
router.get('/my-plant',      authenticate, sup.getSupervisorPlant);

module.exports = router;
