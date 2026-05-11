const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/mortalityCullController');
const { authenticate, adminOnly } = require('../middleware/auth');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');

// Upload folder
const uploadDir = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename:    (req, file, cb) => cb(null, `${file.fieldname}-${Date.now()}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/jpeg|jpg|png|gif/.test(path.extname(file.originalname).toLowerCase())) cb(null, true);
    else cb(new Error('Images only'));
  }
});

// Accept up to 12 photo fields (6 photo types × 2 screens)
const photoFields = Array.from({length:12}, (_,i) => ({ name:`photo_type_id_${i+1}`, maxCount:5 }));

// ── DROPDOWN CHAIN ────────────────────────────────────────────────────────
router.get('/flocks',    authenticate, ctrl.getFlocks);     // ?plant_code=1902 → step 1
router.get('/sheds',     authenticate, ctrl.getSheds);      // ?plant_code=1902 → step 2
router.get('/parts',     authenticate, ctrl.getParts);      // ?shed_id=1
router.get('/lines',     authenticate, ctrl.getLines);      // ?part_id=1 → returns lines + cum_birds auto

// ── MORTALITY ─────────────────────────────────────────────────────────────
router.post('/mortality/save',          authenticate, upload.fields(photoFields), ctrl.saveMortality);
router.get('/mortality/:flock_no',      authenticate, ctrl.getMortality);          // ?date=YYYY-MM-DD

// ── CULL KILL ─────────────────────────────────────────────────────────────
router.post('/cull-kill/save',          authenticate, upload.fields(photoFields), ctrl.saveCullKill);
router.get('/cull-kill/:flock_no',      authenticate, ctrl.getCullKill);           // ?date=YYYY-MM-DD

// ── MASTERS (Admin) ───────────────────────────────────────────────────────
// Mortality reasons
router.get('/master/mortality-reasons',           authenticate, ctrl.getMortalityReasons);
router.post('/master/mortality-reasons',          authenticate, adminOnly, ctrl.addMortalityReason);
router.put('/master/mortality-reasons/:id',       authenticate, adminOnly, ctrl.updateMortalityReason);
router.delete('/master/mortality-reasons/:id',    authenticate, adminOnly, ctrl.deleteMortalityReason);

// Cull kill reasons
router.get('/master/cull-kill-reasons',           authenticate, ctrl.getCullKillReasons);
router.post('/master/cull-kill-reasons',          authenticate, adminOnly, ctrl.addCullKillReason);
router.put('/master/cull-kill-reasons/:id',       authenticate, adminOnly, ctrl.updateCullKillReason);
router.delete('/master/cull-kill-reasons/:id',    authenticate, adminOnly, ctrl.deleteCullKillReason);

// Mortality photo types
router.get('/master/mortality-photo-types',       authenticate, ctrl.getMortalityPhotoTypes);
router.post('/master/mortality-photo-types',      authenticate, adminOnly, ctrl.addMortalityPhotoType);
router.put('/master/mortality-photo-types/:id',   authenticate, adminOnly, ctrl.updateMortalityPhotoType);

// Cull kill photo types
router.get('/master/cull-kill-photo-types',       authenticate, ctrl.getCullKillPhotoTypes);
router.post('/master/cull-kill-photo-types',      authenticate, adminOnly, ctrl.addCullKillPhotoType);
router.put('/master/cull-kill-photo-types/:id',   authenticate, adminOnly, ctrl.updateCullKillPhotoType);

module.exports = router;
