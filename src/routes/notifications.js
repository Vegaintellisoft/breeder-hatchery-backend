const express = require('express');
const router  = express.Router();
const {
  getNotifications,
  markRead,
  markAllRead,
  triggerCheck,
  getFarmConfig,
  updateFlockStartDate,
} = require('../controllers/notificationController');

// GET    /api/notifications?unread_only=true&limit=20&offset=0
router.get('/', getNotifications);

// PUT    /api/notifications/mark-all-read
router.put('/mark-all-read', markAllRead);

// POST   /api/notifications/trigger-check  ← manual cron trigger for testing
router.post('/trigger-check', triggerCheck);

// GET    /api/notifications/farm-config
router.get('/farm-config', getFarmConfig);

// PUT    /api/notifications/flock-start-date
router.put('/flock-start-date', updateFlockStartDate);

// PUT    /api/notifications/:id/read
router.put('/:id/read', markRead);

module.exports = router;
