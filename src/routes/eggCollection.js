const express = require('express');
const router  = express.Router();

const {
  getSheds,
  getShedLines,
  getEggTypes,
  getShedSummary,
  saveCollection,
  getCollection,
  listCollections,
} = require('../controllers/eggCollectionController');

// ── Master data ───────────────────────────────────────────────────────────
router.get('/sheds',                           getSheds);
router.get('/sheds/:shed_id/lines',            getShedLines);
router.get('/egg-types',                       getEggTypes);
router.get('/summary',                         getShedSummary);

// ── Collection CRUD ───────────────────────────────────────────────────────
router.post('/save',                           saveCollection);
router.get('/list',                            listCollections);
router.get('/:collection_date/:collection_id', getCollection);

module.exports = router;
