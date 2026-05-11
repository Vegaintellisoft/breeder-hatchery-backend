const express = require('express');
const router  = express.Router();
const auth    = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');

// Login is now at POST /api/admin/login
// These are protected routes after login
router.get('/me',               authenticate, auth.getMe);
router.get('/notifications',    authenticate, auth.getNotifications);
router.post('/change-password', authenticate, auth.changePassword);

module.exports = router;
