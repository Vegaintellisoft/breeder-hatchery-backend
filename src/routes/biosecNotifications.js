const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/biosecNotificationController');
const { authenticate } = require('../middleware/auth');

// GET /api/biosec-notifications
// Returns pending/overdue badge count + grouped notifications
router.get('/', authenticate, ctrl.getPendingNotifications);

// GET /api/biosec-notifications/entry-screen
// Returns plant, flock dropdown, late reasons for entry screen
router.get('/entry-screen', authenticate, ctrl.getEntryScreenData);

module.exports = router;
