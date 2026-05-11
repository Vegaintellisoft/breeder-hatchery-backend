const express  = require('express');
const router   = express.Router();
const schedule = require('../controllers/scheduleController');
const { authenticate, adminOnly } = require('../middleware/auth');

// Generate schedule (admin)
router.post('/generate',     authenticate, adminOnly, schedule.generateSchedule);

// View schedule
router.get('/today',         authenticate, schedule.getTodaySchedule);
router.get('/overdue',       authenticate, schedule.getOverdueSchedule);
router.get('/completion',    authenticate, schedule.getCompletionReport);
router.get('/late-reasons',  authenticate, schedule.getLateReasons);

// Mark complete (supervisor)
router.post('/complete',     authenticate, schedule.markComplete);

// Manual cron trigger (admin/testing)
router.post('/trigger-check', authenticate, adminOnly, async (req, res) => {
  try {
    const { checkIncompleteAndNotifyManager } = require('../jobs/biosecCron');
    const result = await checkIncompleteAndNotifyManager();
    res.json({ success: true, message: 'Biosecurity check triggered', result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
