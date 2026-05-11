const multer = require('multer');
const path   = require('path');
const fs     = require('fs');

// Always resolve uploads folder relative to THIS file (src/middleware/)
// So uploads is always at: breeder-api/uploads/  — no matter where node is run from
const uploadDir = path.join(__dirname, '..', '..', 'uploads');

// Auto-create if not exists
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
  console.log(`✔ Created uploads directory: ${uploadDir}`);
}

console.log(`📁 Upload directory: ${uploadDir}`);

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE || '5242880') },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|pdf/;
    const ext  = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype);
    if (ext && mime) return cb(null, true);
    cb(new Error('Only images and PDFs allowed'));
  }
});

module.exports = upload;
