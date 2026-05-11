const express = require('express');
const router  = express.Router();
const flock   = require('../controllers/flockMasterController');

router.get('/dropdown',   flock.getFlockDropdown);
router.get('/:flock_no',  flock.getFlockById);
router.get('/',           flock.getFlockMaster);

module.exports = router;
