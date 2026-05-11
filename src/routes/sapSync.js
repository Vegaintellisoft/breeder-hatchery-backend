const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/sapSyncController');
const { authenticate, adminOnly } = require('../middleware/auth');

// POST /api/sap-sync — push to SAP, then mark sap_synced (only if SAP HTTP 2xx)
router.post('/', authenticate, ctrl.markSynced);

// POST /api/sap-sync/mobile-latest — sync latest unsynced row saved today by current user
router.post('/mobile-latest', authenticate, ctrl.syncLatestMobile);

// GET /api/sap-sync/status — sync flags + can_sync_mobile / can_sync_admin
router.get('/status', authenticate, ctrl.getSyncStatus);

// POST /api/sap-sync/pull — import from SAP into DB
router.post('/pull', authenticate, adminOnly, ctrl.pullFromSAP);

// POST /api/sap-sync/push — SAP only (no local flag); mobile = today IST only
router.post('/push', authenticate, ctrl.pushToSapOnly);

// POST /api/sap-sync/push-raw — raw SAP query params
router.post('/push-raw', authenticate, adminOnly, ctrl.pushRaw);

// GET /api/sap-sync/unsynced — admin grid of pending rows
router.get('/unsynced', authenticate, adminOnly, ctrl.listUnsynced);

// POST /api/sap-sync/push-unsynced — admin bulk push + mark synced
router.post('/push-unsynced', authenticate, adminOnly, ctrl.pushUnsyncedBulk);

module.exports = router;
