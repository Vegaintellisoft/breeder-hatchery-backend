const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/breederSupplyController');
const { authenticate, adminOnly } = require('../middleware/auth');

router.get('/getAll',       authenticate, ctrl.getAll);   // ?plant_code=1902&flock_no=LY000001&status=pending
router.get('/getOne/:id',   authenticate, ctrl.getOne);
router.post('/create',      authenticate, ctrl.create);
router.put('/update/:id',   authenticate, ctrl.update);
router.delete('/remove/:id',authenticate, adminOnly, ctrl.remove);

module.exports = router;
