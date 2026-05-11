const express  = require('express');
const router   = express.Router();
const ctrl     = require('../controllers/vaccinationMasterController');
const { authenticate, adminOnly } = require('../middleware/auth');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');

// Upload temp folder
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

// ── Program (Header) APIs ─────────────────────────────────────────────────
router.get('/programs',              authenticate, ctrl.getAllPrograms);
router.get('/programs/:id',          authenticate, ctrl.getProgramById);
router.post('/programs',             authenticate, adminOnly, ctrl.createProgram);
router.put('/programs/:id',          authenticate, adminOnly, ctrl.updateProgram);
router.delete('/programs/:id',       authenticate, adminOnly, ctrl.deleteProgram);

// ── Detail APIs ───────────────────────────────────────────────────────────
router.get('/programs/:id/details',          authenticate, ctrl.getProgramDetails);
router.post('/programs/:id/details',         authenticate, adminOnly, ctrl.addDetail);
router.post('/programs/:id/details/bulk',    authenticate, adminOnly, ctrl.addDetailsBulk);
router.put('/details/:id',                   authenticate, adminOnly, ctrl.updateDetail);
router.delete('/details/:id',                authenticate, adminOnly, ctrl.deleteDetail);

// ── Excel Upload & Template ───────────────────────────────────────────────
router.post('/programs/:id/upload-excel',    authenticate, adminOnly, upload.single('file'), ctrl.uploadExcel);
router.get('/template',                      authenticate, ctrl.downloadTemplate);

module.exports = router;
