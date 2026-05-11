const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/dailyActivityController');
const { authenticate, adminOnly } = require('../middleware/auth');

// ── SAP MATERIAL MASTER ──────────────────────────────────────────────────
router.get('/sap/materials',            authenticate, ctrl.getSAPMaterials);
router.get('/sap/material-stock',       authenticate, ctrl.getSapMaterialStock);
router.post('/sap/sync-to-master',      authenticate, adminOnly, ctrl.syncSAPToMaster);

// ── SCREEN 1 — Plant + Flock Grid ────────────────────────────────────────
// No auth on these so admin panel + mobile can call freely
router.get('/plants',                   ctrl.getPlants);
router.get('/flocks',                   ctrl.getFlockGrid);

// ── SCREEN 2+3 MERGED — Flock detail + menu ──────────────────────────────
router.get('/flock-detail/:flock_no',   ctrl.getActivityMenu);

// ── SCREEN 4 — Feeding ───────────────────────────────────────────────────
router.get('/feeding/items',            authenticate, ctrl.getFeedingItems);
router.get('/feeding/stock',            authenticate, ctrl.getStock);
router.get('/feeding/:flock_no',        authenticate, ctrl.getFeedingData);
router.post('/feeding/save',            authenticate, ctrl.saveFeedingData);

// ── MASTERS ───────────────────────────────────────────────────────────────
router.get('/master/feed',              ctrl.getFeedMaster);
router.post('/master/feed',             authenticate, adminOnly, ctrl.addFeedMaster);
router.put('/master/feed/:id',          authenticate, adminOnly, ctrl.updateFeedMaster);
router.delete('/master/feed/:id',       authenticate, adminOnly, ctrl.deleteFeedMaster);

router.get('/master/water',             ctrl.getWaterMaster);
router.post('/master/water',            authenticate, adminOnly, ctrl.addWaterMaster);
router.put('/master/water/:id',         authenticate, adminOnly, ctrl.updateWaterMaster);
router.delete('/master/water/:id',      authenticate, adminOnly, ctrl.deleteWaterMaster);

router.get('/master/medicine',          ctrl.getMedicineMaster);
router.post('/master/medicine',         authenticate, adminOnly, ctrl.addMedicineMaster);
router.put('/master/medicine/:id',      authenticate, adminOnly, ctrl.updateMedicineMaster);
router.delete('/master/medicine/:id',   authenticate, adminOnly, ctrl.deleteMedicineMaster);

router.get('/master/others',            ctrl.getOthersMaster);
router.post('/master/others',           authenticate, adminOnly, ctrl.addOthersMaster);
router.put('/master/others/:id',        authenticate, adminOnly, ctrl.updateOthersMaster);
router.delete('/master/others/:id',     authenticate, adminOnly, ctrl.deleteOthersMaster);

router.get('/master/stock',             ctrl.getStockMaster);
router.post('/master/stock',            authenticate, adminOnly, ctrl.addStockMaster);
router.put('/master/stock/:id',         authenticate, adminOnly, ctrl.updateStockMaster);

module.exports = router;
