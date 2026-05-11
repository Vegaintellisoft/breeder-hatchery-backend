const express = require('express');
const router  = express.Router();
const sap     = require('../controllers/sapController');

// ── Dashboard ─────────────────────────────────────────────────────────────
router.get('/dashboard',               sap.getSAPDashboard);

// ── Sync from SAP → save to DB → return data ─────────────────────────────
router.get('/sync/bird-receipt',       sap.syncBirdReceipt);
router.get('/sync/feed-medicine',      sap.syncFeedMedicine);
router.get('/sync/laying',             sap.syncLaying);
router.get('/sync/mortality',          sap.syncMortality);
router.get('/sync/culls-kill',         sap.syncCullsKill);
router.get('/sync/culls-sale',         sap.syncCullsSale);
router.get('/sync/estimated-cost',     sap.syncEstimatedCost);

// ── GET from DB only (no SAP call) ────────────────────────────────────────
router.get('/bird-receipt',            sap.getBirdReceipt);
router.get('/feed-medicine',           sap.getFeedMedicine);
router.get('/laying',                  sap.getLaying);
router.get('/mortality',               sap.getMortality);
router.get('/culls-kill',              sap.getCullsKill);
router.get('/culls-sale',              sap.getCullsSale);
router.get('/estimated-cost',          sap.getEstimatedCost);

module.exports = router;
