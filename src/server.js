const express = require('express');
const cors    = require('cors');
const path    = require('path');
require('dotenv').config();

// ── All route requires at top ─────────────────────────────────────────────
const sapRoutes                 = require('./routes/sap');
const flockMasterRoutes         = require('./routes/flockMaster');
const farmerMasterRoutes        = require('./routes/farmerMaster');
const breederRoutes             = require('./routes/breeder');
const eggCollectionV2Routes     = require('./routes/eggCollectionV2');
const eggCollectionRoutes       = require('./routes/eggCollection');
const feedingRoutes             = require('./routes/feeding');
const mortalityRoutes           = require('./routes/mortality');
const birdWeighingRoutes        = require('./routes/birdWeighing');
const vaccinationRoutes         = require('./routes/vaccination');
const notificationRoutes        = require('./routes/notifications');
const farmsRoutes               = require('./routes/farms');
const adminCatRoutes            = require('./routes/adminCategories');
const adminActRoutes            = require('./routes/adminActivities');
const mobileActRoutes           = require('./routes/mobileActivities');
const mobileTasksRoutes         = require('./routes/mobileTasks');
const authRoutes                = require('./routes/auth');
const supervisorRoutes          = require('./routes/supervisor');
const scheduleRoutes            = require('./routes/schedule');
const calendarRoutes            = require('./routes/calendar');
const biosecNotifRoutes         = require('./routes/biosecNotifications');
const vaccinationMasterRoutes   = require('./routes/vaccinationMaster');
const vaccinationScheduleRoutes = require('./routes/vaccinationSchedule');
const vaccinationAdminRoutes    = require('./routes/vaccinationAdmin');
const dailyActivityRoutes       = require('./routes/dailyActivity');
const mortalityCullRoutes       = require('./routes/mortalityCull');
const newMastersRoutes          = require('./routes/newMasters');
const breederSupplyRoutes       = require('./routes/breederSupply');
const cullSalesRoutes           = require('./routes/cullSales');
const mastersRoutes             = require('./routes/masters');
const mortalityCullKillRoutes   = require('./routes/mortalityCullKill');
const sapSyncRoutes             = require('./routes/sapSync');
const sapLiveRoutes             = require('./routes/sapLive');
const hatcheryLiveRoutes        = require('./routes/hatcheryLive');
const adminRoute                = require('./routes/adminRoute');
const roleRoute                 = require('./routes/roleRoute');
const adminGridRoutes           = require('./routes/adminGridRoutes');
const plantMasterRoutes         = require('./routes/plantMaster');
const controllerConfigRoutes    = require('./routes/controllerConfig');
const mobileCtrlConfigRoutes    = require('./routes/mobileControllerConfig');

const { startCron }       = require('./jobs/vaccinationCron');
const { startBiosecCron } = require('./jobs/biosecCron');

// ── App setup ─────────────────────────────────────────────────────────────
const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

const uploadDir = path.join(__dirname, '..', 'uploads');
if (!require('fs').existsSync(uploadDir)) {
  require('fs').mkdirSync(uploadDir, { recursive: true });
}
console.log('📁 Upload directory:', uploadDir);
app.use('/uploads', express.static(uploadDir));

// ── Routes ────────────────────────────────────────────────────────────────
app.use('/api/breeder',               breederRoutes);
app.use('/api/egg-collection/v2',     eggCollectionV2Routes);   // v2 BEFORE base
app.use('/api/egg-collection',        eggCollectionRoutes);
app.use('/api/feeding',               feedingRoutes);
app.use('/api/mortality',             mortalityRoutes);
app.use('/api/bird-weighing',         birdWeighingRoutes);
app.use('/api/vaccination',           vaccinationRoutes);
app.use('/api/notifications',         notificationRoutes);
app.use('/api/sap',                   sapRoutes);
app.use('/api/flock-master',          flockMasterRoutes);
app.use('/api/farmer-master',         farmerMasterRoutes);
app.use('/api/farms',                 farmsRoutes);
app.use('/api/admin/categories',      adminCatRoutes);
app.use('/api/admin/activities',      adminActRoutes);
app.use('/api/admin/grid',            adminGridRoutes);
app.use('/api/admin',                 adminRoute);
app.use('/api/mobile/activities',     mobileActRoutes);
app.use('/api/mobile',                mobileActRoutes);
app.use('/api/mobile/tasks',          mobileTasksRoutes);
app.use('/api/auth',                  authRoutes);
app.use('/api/supervisor',            supervisorRoutes);
app.use('/api/schedule',              scheduleRoutes);
app.use('/api/calendar',              calendarRoutes);
app.use('/api/biosec-notifications',  biosecNotifRoutes);
app.use('/api/vaccination-master',    vaccinationMasterRoutes);
app.use('/api/vaccination-schedule',  vaccinationScheduleRoutes);
app.use('/api/vaccination-admin',     vaccinationAdminRoutes);
app.use('/api/daily-activity',        dailyActivityRoutes);
app.use('/api/mortality-cull',        mortalityCullRoutes);
app.use('/api/masters',               newMastersRoutes);
app.use('/api/masters',               mastersRoutes);
app.use('/api/breeder-supply',        breederSupplyRoutes);
app.use('/api/cull-sales',            cullSalesRoutes);
app.use('/api/farm',                  mortalityCullKillRoutes);
app.use('/api/sap-sync',              sapSyncRoutes);
app.use('/api/sap-live',              sapLiveRoutes);
app.use('/api/hatchery-live',         hatcheryLiveRoutes);
app.use('/api/roles',                 roleRoute);
app.use('/api/masters/plant',         plantMasterRoutes);
app.use('/api/controller-config',      controllerConfigRoutes);
app.use('/api/mobile/controller-config', mobileCtrlConfigRoutes);

// ── Health ────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', service: 'KRISHI Breeder API', timestamp: new Date() });
});

app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.method} ${req.path} not found` });
});
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ success: false, message: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`\n🚀 KRISHI Breeder API running on http://localhost:${PORT}\n`);
  startCron();
  startBiosecCron();
});
