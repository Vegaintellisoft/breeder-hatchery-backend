const express = require('express');
const router  = express.Router();
const role    = require('../controllers/roleController');

// /api/roles
router.get('/getAll/:category', role.getAllRoles);
router.get('/getAll',           role.getAllRoles);
router.post('/add',             role.addRole);
router.put('/update/:id',       role.updateRole);
router.delete('/delete/:id',    role.deleteRole);

module.exports = router;
