const express = require('express');
const router  = express.Router();

const {
  getFlocks,
  getOpeningStock,
  saveEntry,
  getEntry,
  getEntries,
} = require('../controllers/breederController');

const { entryValidation, validate } = require('../middleware/validation');

// GET /api/breeder/flocks
router.get('/flocks', getFlocks);

// GET /api/breeder/flock/:flock_id/opening-stock?entry_date=YYYY-MM-DD
router.get('/flock/:flock_id/opening-stock', getOpeningStock);

// POST /api/breeder/entry
router.post('/entry', entryValidation, validate, saveEntry);

// GET /api/breeder/entry/:flock_id/:entry_date
router.get('/entry/:flock_id/:entry_date', getEntry);

// GET /api/breeder/entries/:flock_id?from=&to=&limit=&offset=
router.get('/entries/:flock_id', getEntries);

module.exports = router;
