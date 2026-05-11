const express = require('express');
const router  = express.Router();

const {
  sapPushStock,
  getItemsWithStock,
  saveConsumption,
  addOtherItem,
  removeOtherItem,
  getConsumptionHistory,
} = require('../controllers/feedingController');

// ── SAP Integration ───────────────────────────────────────────────────────
// POST /api/feeding/sap/push-stock
// Sample SAP endpoint — when real SAP API ready, just call this from SAP
router.post('/sap/push-stock', sapPushStock);

// ── Save consumption ──────────────────────────────────────────────────────
// POST /api/feeding/consume
router.post('/consume', saveConsumption);

// ── Other tab: manage dynamic items ──────────────────────────────────────
// POST   /api/feeding/other/item        → add item
// DELETE /api/feeding/other/item/:id    → remove item
router.post('/other/item', addOtherItem);
router.delete('/other/item/:id', removeOtherItem);

// ── Consumption history (must be before /:category) ──────────────────────
// GET /api/feeding/consumption/history?category=&from=&to=
router.get('/consumption/history', getConsumptionHistory);

// ── Get items + opening stock per tab ────────────────────────────────────
// GET /api/feeding/feed?date=YYYY-MM-DD
// GET /api/feeding/medicine?date=YYYY-MM-DD
// GET /api/feeding/other?date=YYYY-MM-DD
router.get('/:category', getItemsWithStock);

module.exports = router;
