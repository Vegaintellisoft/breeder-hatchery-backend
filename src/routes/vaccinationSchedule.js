const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/vaccinationScheduleController');
const { authenticate, adminOnly } = require('../middleware/auth');

// Notifications (supervisor sees on login)
router.get('/notifications',        authenticate, ctrl.getVaccinationNotifications);

// Record vaccination (vaccinated / not vaccinated)
router.post('/record',              authenticate, ctrl.recordVaccination);

// Today's schedule
router.get('/today',                authenticate, ctrl.getTodaySchedule);

// Flock full schedule
router.get('/flock/:flock_no',      authenticate, ctrl.getFlockSchedule);

// Generate schedule
router.post('/generate',            authenticate, adminOnly, ctrl.generateSchedule);
router.post('/generate-all',        authenticate, adminOnly, ctrl.generateAllSchedules);

module.exports = router;
