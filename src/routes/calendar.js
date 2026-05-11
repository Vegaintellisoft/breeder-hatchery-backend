const express  = require('express');
const router   = express.Router();
const calendar = require('../controllers/calendarController');
const { authenticate } = require('../middleware/auth');

// What's due today for a plant (shown on login/app open)
router.get('/today',                    authenticate, calendar.getWhatsDueToday);

// Full 72-week calendar for a flock
router.get('/flock/:flock_no',          authenticate, calendar.getFlockCalendar);

// Only special days (weekly/fortnightly/monthly due dates)
router.get('/flock/:flock_no/special',  authenticate, calendar.getSpecialDays);

module.exports = router;
