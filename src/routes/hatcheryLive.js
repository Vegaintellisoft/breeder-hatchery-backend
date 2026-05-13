const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/hatcheryLiveController');
const { authenticate } = require('../middleware/auth');

// Hatchery SAP live GET APIs (separate from breeder)
router.get('/plants', ctrl.getPlants);

// Chain: Plant -> Suppliers -> PO -> Flock -> Details
router.get('/suppliers', ctrl.getSuppliersByPlant);
router.get('/po-list', ctrl.getPoList);
router.get('/flocks', ctrl.getFlockListByPo);
router.get('/flock-details', ctrl.getDetailsByFlock);

// Screen data APIs
router.get('/egg-receipt', ctrl.getEggReceipt);
router.get('/grade-setting', ctrl.getGradeSetting);
router.get('/transfer-pullout', ctrl.getTransferPullout);
router.get('/medicine-issue', ctrl.getMedicineIssue);
router.get('/reasons', ctrl.getHatcheryReasons);
router.post('/reasons', authenticate, ctrl.postHatcheryReason);

// Local saves (mobile / admin) — JWT required; body matches Figma fields inside `form`
// POST /api/hatchery-live/local/:screen/save   screen = egg-receipt | grade-setting | transfer-pullout | medicine-issue
router.post('/local/:screen/save', authenticate, ctrl.saveHatcheryLocal);
router.get('/local/:screen', authenticate, ctrl.listHatcheryLocal);
router.get('/local/:screen/:id', authenticate, ctrl.getHatcheryLocalById);
router.delete('/local/:screen/:id', authenticate, ctrl.deleteHatcheryLocal);

// Admin grid — all hatchery local modules in one list (SAP sync columns + edit/delete hints)
// GET /api/hatchery-live/admin/grid?screen=all|egg-receipt|...&werks=&from_date=&to_date=&search=
router.get('/admin/grid', authenticate, ctrl.listHatcheryAdminGrid);

module.exports = router;
