const express = require('express');
const router  = express.Router();
const { saveWeighing, getEntry, listEntries } = require('../controllers/birdWeighingController');

// POST /api/bird-weighing/save
router.post('/save', saveWeighing);

// GET  /api/bird-weighing/entry/:entry_date
router.get('/entry/:entry_date', getEntry);

// GET  /api/bird-weighing/list?from=&to=&hen_type_id=&gender=
router.get('/list', listEntries);

module.exports = router;
