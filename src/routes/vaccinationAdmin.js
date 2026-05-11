const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/vaccinationAdminController');
const { authenticate, adminOnly } = require('../middleware/auth');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');

const tmpDir = path.join(process.cwd(), 'uploads', 'tmp');
if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

const upload = multer({
  dest: tmpDir,
  fileFilter: (req, file, cb) => {
    if (file.mimetype.includes('spreadsheet') || file.originalname.match(/\.xlsx?$/)) {
      cb(null, true);
    } else {
      cb(new Error('Only Excel files allowed'));
    }
  }
});

// ── SCREEN 1: Vaccination Program Management ──────────────────────────────
// List all programs (one active at a time)
router.get('/programs',                      authenticate, ctrl.getAllPrograms);
// Get currently active program
router.get('/programs/current',              authenticate, ctrl.getCurrentProgram);
// Get one program + all its detail rows (tap program → show grid)
router.get('/programs/:id/details',          authenticate, ctrl.getProgramWithDetails);
// Add new detail line to existing program
router.post('/programs/:id/details',         authenticate, adminOnly, ctrl.addDetailLine);
// Upload new version from Excel
router.post('/programs/upload-new-version',  authenticate, adminOnly, upload.single('file'), ctrl.uploadNewVersion);
// Download Excel template
router.get('/template',                      authenticate, ctrl.downloadTemplate);

// ── SCREEN 2: Admin Missed Entry ──────────────────────────────────────────
// Get flock dropdown
router.get('/flock-dropdown',              authenticate, ctrl.getFlockDropdown);
// Get full vaccination grid for a flock
router.get('/flock-grid/:flock_no',        authenticate, ctrl.getFlockGrid);
// Record single missed entry
router.post('/record-missed',              authenticate, ctrl.recordMissedEntry);
// Record multiple missed entries at once (bulk save)
router.post('/record-missed/bulk',         authenticate, ctrl.recordMissedBulk);

module.exports = router;
