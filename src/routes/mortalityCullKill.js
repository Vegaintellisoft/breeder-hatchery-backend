const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/mortalityController');
const { authenticate, adminOnly } = require('../middleware/auth');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');

// Upload dir
const uploadDir = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// Accept any field name starting with photo_type_
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename:    (req, file, cb) => cb(null, `${file.fieldname}-${Date.now()}${path.extname(file.originalname)}`),
  }),
  fileFilter: (req, file, cb) => {
    if (/jpeg|jpg|png|gif|webp/.test(path.extname(file.originalname).toLowerCase())) cb(null, true);
    else cb(new Error('Images only'));
  },
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

// Accept up to 50 photo fields (multiple types × multiple images each)
const uploadPhotos = upload.fields(
  Array.from({ length: 20 }, (_, i) => [
    { name: `photo_type_${i+1}`,   maxCount: 10 },
    { name: `photo_type_${i+1}_0`, maxCount: 1  },
    { name: `photo_type_${i+1}_1`, maxCount: 1  },
    { name: `photo_type_${i+1}_2`, maxCount: 1  },
  ]).flat()
);

// ── DROPDOWN CHAIN ────────────────────────────────────────────────────────
router.get('/sheds',                  authenticate, ctrl.getSheds);
router.get('/parts',                  authenticate, ctrl.getParts);
router.get('/lines',                  authenticate, ctrl.getLines);
router.get('/line-info',              authenticate, ctrl.getLineInfo);

// ── MORTALITY ─────────────────────────────────────────────────────────────
router.get('/mortality/reasons',      authenticate, ctrl.getMortalityReasons);
router.get('/mortality/photo-types',  authenticate, ctrl.getMortalityPhotoTypes);
router.post('/mortality/save',        authenticate, uploadPhotos, ctrl.saveMortality);
router.get('/mortality/:flock_no',    authenticate, ctrl.getMortality);

// ── CULL KILL ─────────────────────────────────────────────────────────────
router.get('/cull-kill/reasons',      authenticate, ctrl.getCullKillReasons);
router.get('/cull-kill/photo-types',  authenticate, ctrl.getCullKillPhotoTypes);
router.post('/cull-kill/save',        authenticate, uploadPhotos, ctrl.saveCullKill);
router.get('/cull-kill/:flock_no',    authenticate, ctrl.getCullKill);

// ── ADMIN MASTERS ─────────────────────────────────────────────────────────
// Shed Master
router.get('/admin/sheds',               authenticate, (req,res)=>{ require('../config/db').query('SELECT sm.*,COUNT(spm.id) AS part_count FROM shed_master sm LEFT JOIN shed_part_master spm ON spm.shed_id=sm.id GROUP BY sm.id ORDER BY sm.plant_code,sm.shed_no').then(r=>res.json({success:true,data:r.rows})).catch(e=>res.status(500).json({success:false,message:e.message})); });
router.post('/admin/sheds',              authenticate, adminOnly, ctrl.addShed);
router.put('/admin/sheds/:id',           authenticate, adminOnly, ctrl.updateShed);
router.delete('/admin/sheds/:id',        authenticate, adminOnly, ctrl.deleteShed);

// Part Master
router.get('/admin/parts',               authenticate, (req,res)=>{ const{shed_id}=req.query; const q=shed_id?`SELECT spm.*,sm.shed_no FROM shed_part_master spm JOIN shed_master sm ON sm.id=spm.shed_id WHERE spm.shed_id=${parseInt(shed_id)} AND spm.is_active=TRUE ORDER BY spm.part_row_no`:`SELECT spm.*,sm.shed_no FROM shed_part_master spm JOIN shed_master sm ON sm.id=spm.shed_id WHERE spm.is_active=TRUE ORDER BY sm.shed_no,spm.part_row_no`; require('../config/db').query(q).then(r=>res.json({success:true,data:r.rows})).catch(e=>res.status(500).json({success:false,message:e.message})); });
router.post('/admin/parts',              authenticate, adminOnly, ctrl.addPart);
router.put('/admin/parts/:id',           authenticate, adminOnly, ctrl.updatePart);
router.delete('/admin/parts/:id',        authenticate, adminOnly, ctrl.deletePart);

// Line Master
router.get('/admin/lines',               authenticate, (req,res)=>{ const{part_id}=req.query; const q=part_id?`SELECT slm.*,spm.part_row_no,sm.shed_no FROM shed_line_master slm JOIN shed_part_master spm ON spm.id=slm.part_id JOIN shed_master sm ON sm.id=spm.shed_id WHERE slm.part_id=${parseInt(part_id)} AND slm.is_active=TRUE ORDER BY slm.line_no`:`SELECT slm.*,spm.part_row_no,sm.shed_no FROM shed_line_master slm JOIN shed_part_master spm ON spm.id=slm.part_id JOIN shed_master sm ON sm.id=spm.shed_id WHERE slm.is_active=TRUE ORDER BY sm.shed_no,spm.part_row_no,slm.line_no`; require('../config/db').query(q).then(r=>res.json({success:true,data:r.rows})).catch(e=>res.status(500).json({success:false,message:e.message})); });
router.post('/admin/lines',              authenticate, adminOnly, ctrl.addLine);
router.put('/admin/lines/:id',           authenticate, adminOnly, ctrl.updateLine);
router.delete('/admin/lines/:id',        authenticate, adminOnly, ctrl.deleteLine);

// Mortality Reason Master
router.get('/admin/mortality-reasons',       authenticate, ctrl.getMortalityReasonMaster);
router.post('/admin/mortality-reasons',      authenticate, adminOnly, ctrl.addMortalityReason);
router.put('/admin/mortality-reasons/:id',   authenticate, adminOnly, ctrl.updateMortalityReason);
router.delete('/admin/mortality-reasons/:id',authenticate, adminOnly, ctrl.deleteMortalityReason);

// Cull Kill Reason Master
router.get('/admin/cull-reasons',            authenticate, ctrl.getCullKillReasonMaster);
router.post('/admin/cull-reasons',           authenticate, adminOnly, ctrl.addCullKillReason);
router.put('/admin/cull-reasons/:id',        authenticate, adminOnly, ctrl.updateCullKillReason);
router.delete('/admin/cull-reasons/:id',     authenticate, adminOnly, ctrl.deleteCullKillReason);

// Mortality Photo Type Master
router.get('/admin/mortality-photo-types',       authenticate, ctrl.getMortalityPhotoTypeMaster);
router.post('/admin/mortality-photo-types',      authenticate, adminOnly, ctrl.addMortalityPhotoType);
router.put('/admin/mortality-photo-types/:id',   authenticate, adminOnly, ctrl.updateMortalityPhotoType);
router.delete('/admin/mortality-photo-types/:id',authenticate, adminOnly, ctrl.deleteMortalityPhotoType);

// Cull Kill Photo Type Master
router.get('/admin/cull-photo-types',            authenticate, ctrl.getCullKillPhotoTypeMaster);
router.post('/admin/cull-photo-types',           authenticate, adminOnly, ctrl.addCullKillPhotoType);
router.put('/admin/cull-photo-types/:id',        authenticate, adminOnly, ctrl.updateCullKillPhotoType);
router.delete('/admin/cull-photo-types/:id',     authenticate, adminOnly, ctrl.deleteCullKillPhotoType);

module.exports = router;
