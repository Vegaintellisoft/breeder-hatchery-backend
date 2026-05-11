const express  = require('express');
const router   = express.Router();
const ctrl     = require('../controllers/cullSalesController');
const mCtrl    = require('../controllers/cullSalesMasterController');
const { authenticate, adminOnly } = require('../middleware/auth');

// ═══════════════════════════════════════════════════════════════════════════
// STEP 1 — SHED / PART / LINE CHAIN
// ═══════════════════════════════════════════════════════════════════════════
router.get('/flocks',           ctrl.getFlocks);      // ?plant_code=1902
router.get('/sheds',            ctrl.getSheds);       // ?plant_code=1902
router.get('/parts',            ctrl.getParts);       // ?shed_id=1
router.get('/lines',            ctrl.getLines);       // ?part_id=1

// ═══════════════════════════════════════════════════════════════════════════
// STEP 2 — FORM DROPDOWNS (same as broiler supply screen)
// ═══════════════════════════════════════════════════════════════════════════

// Single call — returns ALL 6 dropdowns at once (recommended)
router.get('/dropdowns',        mCtrl.getAllDropdowns);  // ?plant_code=1902

// Individual endpoints
router.get('/customer-types',   mCtrl.getCustomerTypes);
router.get('/customers',        mCtrl.getCustomers);       // ?plant_code=1902
router.get('/sales-types',      mCtrl.getSalesTypes);
router.get('/transport-types',  mCtrl.getTransportTypes);
router.get('/order-by',         mCtrl.getOrderBy);         // ?plant_code=1902
router.get('/dispatched-by',    mCtrl.getDispatchedBy);    // ?plant_code=1902

// ═══════════════════════════════════════════════════════════════════════════
// MASTER SYNC (same as broiler /api/broiler/master/...)
// ═══════════════════════════════════════════════════════════════════════════

// POST /api/cull-sales/masters/sync/:name  — push data directly (from SAP webhook or manual)
// Body: array of records
// name: broiler_stock_location | broiler_sales_rate | broiler_sales_emp_default | vehicle_type_cost
router.post('/masters/sync/:name',   authenticate, adminOnly, mCtrl.masterInsert);

// GET /api/cull-sales/masters/sync/:name?werks=1902  — pull from SAP + save to DB
router.get('/masters/sync/:name',    authenticate, adminOnly, mCtrl.syncFromSAP);

// GET /api/cull-sales/masters/getAll/:name?werks=1902  — get from local DB
// name: broiler_stock_location | broiler_sales_rate | broiler_sales_emp_default | vehicle_type_cost
router.get('/masters/getAll/:name',  mCtrl.getAllMaster);

// Admin add static dropdowns
router.post('/admin/customer-types', authenticate, adminOnly, mCtrl.addCustomerType);
router.post('/admin/sales-types',    authenticate, adminOnly, mCtrl.addSalesType);

// ═══════════════════════════════════════════════════════════════════════════
// STEP 3 — LOAD CALCULATION
// ═══════════════════════════════════════════════════════════════════════════
router.get('/calculate-load',   ctrl.calculateLoad);
// ?empty_weight=5.3&load_weight=133.2&birds_male=12&birds_female=12

// ═══════════════════════════════════════════════════════════════════════════
// STEP 4 — SAVE + GENERATE DC BILL
// ═══════════════════════════════════════════════════════════════════════════
router.post('/save',            authenticate, ctrl.saveCullSales);

// ═══════════════════════════════════════════════════════════════════════════
// VIEW RECORDS
// ═══════════════════════════════════════════════════════════════════════════
router.get('/getAll',           ctrl.getAll);
router.get('/getOne/:id',       ctrl.getOne);
router.get('/flock/:flock_no',  ctrl.getByFlock);
router.get('/dc/:id',           ctrl.getDC);
router.delete('/:id',           authenticate, ctrl.deleteCullSales);  // blocked if SAP synced

module.exports = router;
