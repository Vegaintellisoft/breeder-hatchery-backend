const express = require('express');
const router  = express.Router();
const admin   = require('../controllers/adminController');

// /api/admin
router.post('/login',          admin.login);
router.post('/register',       admin.register);
router.get('/getAll/:category',admin.getAll);
router.get('/getAll',          admin.getAll);
router.put('/update/:id',      admin.updateAdmin);
router.delete('/delete/:id',   admin.deleteAdmin);
router.get('/screens',         admin.getScreens);

module.exports = router;
