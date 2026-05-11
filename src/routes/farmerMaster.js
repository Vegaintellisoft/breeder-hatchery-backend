const express = require('express');
const router  = express.Router();
const farmer  = require('../controllers/farmerMasterController');

router.get('/dropdown',       farmer.getFarmerDropdown);
router.get('/lines',          farmer.getLines);
router.get('/:farm_number',   farmer.getFarmerByNumber);
router.get('/',               farmer.getFarmerMaster);

module.exports = router;
