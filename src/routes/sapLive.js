const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/sapLiveController');

// Live SAP dropdown chain for all breeder screens:
// Plant (werks) -> Order (aufnr) -> Flock
router.get('/plants', ctrl.getPlants);
router.get('/orders', ctrl.getOrders);
router.get('/flocks', ctrl.getFlocks);
router.get('/chain', ctrl.getChain);

module.exports = router;
