const { parseDate, todayDate, formatRow } = require('../utils/dateUtils');
const pool  = require('../config/db');
const axios = require('axios');
const { pushToSap } = require('../services/sapOutboundPush');

const SAP_BASE   = process.env.SAP_BASE_URL || 'http://krishidevqas.krishinutrition.com:8001/sap/bc';
const SAP_AUTH   = { username: process.env.SAP_USER || 'vega', password: process.env.SAP_PASSWORD || 'Vega@1234' };
const SAP_CLIENT = process.env.SAP_CLIENT || '500';

// ── mtart → master type mapping (from SAP data analysis) ─────────────────
// ZROH = KNC FEED RAW MATERIALS         → Feed
// ZMD  = KNC FARM & HATCHERY ADDT.      → Medicine
// Any other mtart not ZROH/ZMD          → Others
// Water: no dedicated mtart found — admin manually assigns
const MTART_TO_TYPE = {
  'ZROH': 'feed',
  'ZFIF': 'feed',
  'ZMD':  'medicine',
};

function detectType(mtart) {
  return MTART_TO_TYPE[mtart] || 'others';
}

// ── Fetch all materials from SAP ──────────────────────────────────────────
async function fetchSAPMaterials(filters = {}) {
  const params = { 'sap-client': SAP_CLIENT };
  if (filters.werks) params.werks = filters.werks;
  if (filters.matnr) params.matnr = filters.matnr;

  const res = await axios.get(`${SAP_BASE}/masters/material`, {
    auth:    SAP_AUTH,
    params,
    timeout: 15000,
  });
  return Array.isArray(res.data) ? res.data : (res.data?.results || []);
}

// GET /api/daily-activity/sap/material-stock?plant_code=1904&matnr=FG000096
// Returns stock per storage location (lgort) from SAP masters/material
exports.getSapMaterialStock = async (req, res) => {
  const { plant_code, matnr } = req.query;
  const werks = String(plant_code || '').trim();
  const code = String(matnr || '').trim();
  if (!werks || !code) {
    return res.status(422).json({ success: false, message: 'plant_code and matnr required' });
  }
  try {
    const rows = await fetchSAPMaterials({ werks, matnr: code });
    const byLgort = new Map();
    for (const r of rows) {
      const lgort = String(r?.lgort || '').trim();
      if (!lgort) continue;
      const labst = Number(r?.labst) || 0;
      if (!byLgort.has(lgort)) {
        byLgort.set(lgort, {
          matnr: String(r?.matnr || '').trim(),
          maktx: String(r?.maktx || '').trim(),
          meins: String(r?.meins || '').trim(),
          mtart: String(r?.mtart || '').trim(),
          werks: String(r?.werks || '').trim(),
          lgort,
          labst,
        });
      } else {
        // Sum if SAP returns multiple rows per lgort
        byLgort.get(lgort).labst += labst;
      }
    }
    const data = Array.from(byLgort.values()).sort((a, b) => (b.labst || 0) - (a.labst || 0));
    return res.json({ success: true, plant_code: werks, matnr: code, total: data.length, data });
  } catch (err) {
    return res.status(503).json({ success: false, message: 'Failed to fetch stock from SAP', error: err.message });
  }
};

function buildMaterialMap(rows) {
  const matMap = {};
  for (const r of rows) {
    const matnr = r.matnr?.trim();
    if (!matnr) continue;

    if (!matMap[matnr]) {
      matMap[matnr] = {
        matnr,
        maktx:         r.maktx?.trim(),
        meins:         r.meins?.trim(),
        mtart:         r.mtart?.trim(),
        mtbez:         r.mtbez?.trim(),
        detected_type: detectType(r.mtart?.trim()),
        plants:        [],
      };
    }
    matMap[matnr].plants.push({
      werks:  r.werks,
      labst:  parseFloat(r.labst) || 0,
      lgort:  r.lgort,
    });
  }
  return matMap;
}

async function upsertStock(client, { plant_code, item_type, item_id, item_name, uom, stock_qty }) {
  const upd = await client.query(
    `UPDATE stock_master
     SET stock_qty=$5, item_name=$4, uom=$6, source='SAP', stock_date=CURRENT_DATE, updated_at=NOW()
     WHERE plant_code=$1 AND item_type=$2 AND item_id=$3`,
    [plant_code, item_type, item_id, item_name || null, stock_qty || 0, uom || null]
  );
  if (upd.rowCount === 0) {
    await client.query(
      `INSERT INTO stock_master (plant_code, item_type, item_id, item_name, uom, stock_qty, source, stock_date)
       VALUES ($1,$2,$3,$4,$5,$6,'SAP',CURRENT_DATE)`,
      [plant_code, item_type, item_id, item_name || null, uom || null, stock_qty || 0]
    );
  }
}

async function upsertMasterItem(client, cfg, mat, modArr) {
  const { table, idCol, hasModule } = cfg;
  const code = mat.matnr;
  const name = mat.maktx;
  const uom = mat.meins;

  let existing;
  if (hasModule) {
    existing = await client.query(
      `UPDATE ${table}
       SET item_name=$2, uom=$3, module=$4, updated_at=NOW()
       WHERE ${idCol}=$1
       RETURNING id, ${idCol} AS sap_code, item_name, uom`,
      [code, name, uom, modArr]
    );
  } else {
    existing = await client.query(
      `UPDATE ${table}
       SET item_name=$2, uom=$3, updated_at=NOW()
       WHERE ${idCol}=$1
       RETURNING id, ${idCol} AS sap_code, item_name, uom`,
      [code, name, uom]
    );
  }
  if (existing.rowCount > 0) return existing.rows[0];

  // Insert when not found. Keep robust if duplicate already exists.
  try {
    if (hasModule) {
      const ins = await client.query(
        `INSERT INTO ${table} (${idCol}, item_name, uom, module, created_by)
         VALUES ($1,$2,$3,$4,'SAP')
         RETURNING id, ${idCol} AS sap_code, item_name, uom`,
        [code, name, uom, modArr]
      );
      return ins.rows[0];
    }
    const ins = await client.query(
      `INSERT INTO ${table} (${idCol}, item_name, uom, created_by)
       VALUES ($1,$2,$3,'SAP')
       RETURNING id, ${idCol} AS sap_code, item_name, uom`,
      [code, name, uom]
    );
    return ins.rows[0];
  } catch (_) {
    const fallback = await client.query(
      `SELECT id, ${idCol} AS sap_code, item_name, uom
       FROM ${table}
       WHERE ${idCol}=$1
       ORDER BY id DESC
       LIMIT 1`,
      [code]
    );
    if (fallback.rowCount > 0) return fallback.rows[0];
    throw _;
  }
}

async function syncMaterialsFromSAPToLocal({ plant_code, matnr, module }) {
  const tableMap = {
    feed:     { table:'feed_master',     idCol:'mat_id',      hasModule:true  },
    medicine: { table:'medicine_master', idCol:'medicine_id', hasModule:true  },
    water:    { table:'water_master',    idCol:'water_id',    hasModule:false },
    others:   { table:'others_master',   idCol:'others_id',   hasModule:false },
  };
  const modArr = Array.isArray(module) ? module : (module ? [module] : ['Breeder']);
  const rows = await fetchSAPMaterials({ werks: plant_code, matnr });
  const materials = Object.values(buildMaterialMap(rows));

  const client = await pool.connect();
  const synced = [];
  const errors = [];
  try {
    await client.query('BEGIN');
    for (const mat of materials) {
      const masterType = mat.detected_type;
      const cfg = tableMap[masterType];
      if (!cfg) continue;

      try {
        const master = await upsertMasterItem(client, cfg, mat, modArr);
        const masterId = master.id;

        // Save stock plant-wise (werks stock from SAP)
        for (const p of mat.plants) {
          if (!p.werks) continue;
          await upsertStock(client, {
            plant_code: p.werks,
            item_type: masterType,
            item_id: masterId,
            item_name: mat.maktx,
            uom: mat.meins,
            stock_qty: p.labst,
          });
        }

        synced.push({ matnr:mat.matnr, name:mat.maktx, uom:mat.meins, saved_to:masterType, plants: mat.plants.length });
      } catch (e) {
        errors.push({ matnr:mat.matnr, error:e.message });
      }
    }
    await client.query('COMMIT');
    return { synced, errors, rows, materials };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/daily-activity/sap/materials
// Returns ALL SAP materials with auto-detected type
// ?type=feed|medicine|water|others|all  (default: all)
// ?plant_code=1902  (optional — filter by plant)
// ═══════════════════════════════════════════════════════════════════════════
exports.getSAPMaterials = async (req, res) => {
  const { type, plant_code, matnr } = req.query;

  try {
    const rows = await fetchSAPMaterials({ werks: plant_code, matnr });
    let materials = Object.values(buildMaterialMap(rows));

    // Filter by plant_code if provided
    if (plant_code) {
      materials = materials.filter(m =>
        m.plants.some(p => p.werks === plant_code)
      );
    }

    // Filter by type if provided
    if (type && type !== 'all') {
      materials = materials.filter(m => m.detected_type === type);
    }

    return res.json({
      success: true,
      source:  'SAP',
      filter:  { type: type||'all', plant_code: plant_code||'all' },
      total:   materials.length,
      data:    materials.map(m => {
        // Get stock for requested plant
        const plantStock = plant_code
          ? m.plants.find(p => p.werks === plant_code)
          : null;

        return {
          matnr:         m.matnr,
          maktx:         m.maktx,
          meins:         m.meins,
          mtart:         m.mtart,
          mtbez:         m.mtbez,
          detected_type: m.detected_type,
          stock:         plantStock?.labst || 0,
          // For dropdown label
          label:         `${m.matnr} — ${m.maktx} (${m.meins})`,
          // Auto-fill when selected in form
          mat_id:        m.matnr,
          item_name:     m.maktx,
          uom:           m.meins,
        };
      })
    });
  } catch(err) {
    console.error('[getSAPMaterials]', err.message);
    return res.status(503).json({
      success: false,
      message: 'SAP connection failed. Use local master data.',
      error:   err.message
    });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/daily-activity/sap/sync-to-master
// Admin selects a SAP material and saves to local master
// Body: { matnr, type: 'feed'|'medicine'|'water'|'others', module, plant_code }
// OR bulk: { sync_all: true, plant_code } → syncs all SAP items by detected_type
// ═══════════════════════════════════════════════════════════════════════════
exports.syncSAPToMaster = async (req, res) => {
  const { matnr, type, module, plant_code, sync_all } = req.body;

  try {
    if (!sync_all && !matnr) {
      return res.status(422).json({ success:false, message:'Provide matnr or sync_all:true' });
    }
    const out = await syncMaterialsFromSAPToLocal({
      plant_code,
      matnr: sync_all ? null : matnr,
      module,
    });

    // Admin override type for single-item sync (if explicitly requested)
    if (!sync_all && type && ['feed','medicine','water','others'].includes(type) && out.synced.length) {
      const s = out.synced.find(x => x.matnr === matnr);
      if (s) s.saved_to = type;
    }

    return res.json({
      success:  true,
      message:  `${out.synced.length} items synced from SAP`,
      synced: out.synced,
      errors: out.errors,
    });
  } catch(err) {
    console.error('[syncSAPToMaster]', err.message);
    return res.status(500).json({ success:false, message:err.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// SCREEN 1 — Plant dropdown + Flock grid
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/daily-activity/plants?supervisor_id=3
// Returns plant assigned to supervisor
exports.getPlants = async (req, res) => {
  const { supervisor_id } = req.query;
  try {
    // Get supervisor's assigned plant from today's shift
    let plantCodes = [];
    if (supervisor_id || req.user?.id) {
      const shiftRes = await pool.query(`
        SELECT DISTINCT sps.plant_code, f.plant_name, f.location
        FROM supervisor_plant_shifts sps
        LEFT JOIN farms f ON f.plant_code = sps.plant_code
        WHERE sps.user_id = $1
          AND sps.shift_date = CURRENT_DATE
          AND sps.is_active = TRUE
      `, [supervisor_id || req.user.id]);
      plantCodes = shiftRes.rows;
    }

    // If no shift today fallback to admin.plant_code
    if (plantCodes.length === 0 && req.user?.plant_code) {
      const farmRes = await pool.query(`
        SELECT plant_code, plant_name, location FROM farms WHERE plant_code = $1
      `, [req.user.plant_code]);
      plantCodes = farmRes.rows;
    }

    // If still empty return all plants
    if (plantCodes.length === 0) {
      const allRes = await pool.query(`SELECT plant_code, plant_name, location FROM farms ORDER BY plant_code`);
      plantCodes = allRes.rows;
    }

    return res.json({
      success:    true,
      total:      plantCodes.length,
      data:       plantCodes.map(p => ({
        plant_code: p.plant_code,
        plant_name: p.plant_name || p.plant_code,
        location:   p.location || '',
        label:      `${p.plant_name || p.plant_code}`,
      }))
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/daily-activity/flocks?plant_code=1902&date=2026-05-03
// Returns flock grid for Screen 1
exports.getFlockGrid = async (req, res) => {
  const { plant_code, date } = req.query;
  if (!plant_code) return res.status(422).json({ success: false, message: 'plant_code required' });

  const actDate = parseDate(date);

  try {
    const result = await pool.query(`
      SELECT
        fm.flock_no, fm.flock_name, TO_CHAR(fm.hatchery_date,'YYYY-MM-DD') AS hatchery_date, fm.farm_code,
        CASE WHEN fm.hatchery_date IS NOT NULL
             THEN (CURRENT_DATE - fm.hatchery_date::date)
             ELSE 0 END AS age_days,
        CASE
          WHEN fm.hatchery_date IS NULL THEN 'Laying'
          WHEN (CURRENT_DATE - fm.hatchery_date::date) <= 42  THEN 'Brooming'
          WHEN (CURRENT_DATE - fm.hatchery_date::date) <= 126 THEN 'Grooming'
          ELSE 'Laying'
        END AS stage,
        fda.male_count, fda.female_count,
        (COALESCE(fda.male_count,0) + COALESCE(fda.female_count,0)) AS total_count,
        fda.mortality, fda.cull_kill, fda.cull_sales,
        fda.bird_sales, fda.egg_collection,
        fda.activity_date,
        CASE WHEN fda.id IS NOT NULL THEN TRUE ELSE FALSE END AS has_entry
      FROM flock_master fm
      LEFT JOIN flock_daily_activity fda
        ON fda.flock_no = fm.flock_no AND fda.activity_date = $2
      WHERE (fm.farm_code = $1 OR fm.farm_code LIKE '%' || $1 || '%')
        AND fm.status = 'A'
        AND COALESCE(fm.deletion_flag, '') != 'X'
      ORDER BY fm.flock_no
    `, [plant_code, actDate]);

    return res.json({
      success:    true,
      plant_code,
      date:       actDate,
      total:      result.rowCount,
      // Grid columns: Flock | Stage | Age | Male | Female | Total
      data: result.rows.map(r => ({
        flock_no:      r.flock_no,
        flock_name:    r.flock_name || r.flock_no,
        stage:         r.stage,
        age_days:      parseInt(r.age_days) || 0,
        male_count:    r.male_count || 0,
        female_count:  r.female_count || 0,
        total_count:   r.total_count || 0,
        mortality:     r.mortality || 0,
        cull_kill:     r.cull_kill || 0,
        cull_sales:    r.cull_sales || 0,
        bird_sales:    r.bird_sales || 0,
        egg_collection:r.egg_collection || 0,
        has_entry:     r.has_entry,
      }))
    });
  } catch (err) {
    console.error('[getFlockGrid]', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// SCREEN 2 — Flock detail popup (view + entry)
// GET  /api/daily-activity/flock-detail/:flock_no?date=2026-05-03
// POST /api/daily-activity/flock-detail
// ═══════════════════════════════════════════════════════════════════════════

exports.getFlockDetail = async (req, res) => {
  const { flock_no } = req.params;
  const { date }     = req.query;
  const actDate = parseDate(date);

  try {
    const flockRes = await pool.query(`
      SELECT fm.*,
        CASE WHEN fm.hatchery_date IS NOT NULL THEN (CURRENT_DATE - fm.hatchery_date::date) ELSE 0 END AS age_days,
        CASE
          WHEN fm.hatchery_date IS NULL THEN 'Laying'
          WHEN (CURRENT_DATE - fm.hatchery_date::date) <= 42  THEN 'Brooming'
          WHEN (CURRENT_DATE - fm.hatchery_date::date) <= 126 THEN 'Grooming'
          ELSE 'Laying'
        END AS stage
      FROM flock_master fm WHERE fm.flock_no = $1
    `, [flock_no]);

    if (flockRes.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Flock not found' });
    }

    const flock = flockRes.rows[0];

    // Get today's activity if exists
    const actRes = await pool.query(`
      SELECT * FROM flock_daily_activity
      WHERE flock_no=$1 AND activity_date=$2
    `, [flock_no, actDate]);

    const activity = actRes.rows[0] || {};

    return res.json({
      success:    true,
      flock_no,
      date:       actDate,
      flock_name: flock.flock_name || flock_no,
      stage:      flock.stage,
      age_days:   parseInt(flock.age_days) || 0,
      // Screen 2 fields
      data: {
        male_count:    activity.male_count    || 0,
        female_count:  activity.female_count  || 0,
        mortality:     activity.mortality     || 0,
        cull_kill:     activity.cull_kill     || 0,
        cull_sales:    activity.cull_sales    || 0,
        bird_sales:    activity.bird_sales    || 0,
        egg_collection:activity.egg_collection|| 0,
      },
      has_entry: actRes.rowCount > 0,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.saveFlockDetail = async (req, res) => {
  const {
    flock_no, plant_code, activity_date,
    male_count, female_count, mortality,
    cull_kill, cull_sales, bird_sales, egg_collection, stage, order_no
  } = req.body;

  if (!flock_no || !plant_code) {
    return res.status(422).json({ success: false, message: 'flock_no and plant_code required' });
  }

  const date = parseDate(activity_date);
  const today = todayDate();

  if (date > today) return res.status(400).json({ success: false, message: 'Cannot enter future date' });

  try {
    // Get flock age
    const flock = await pool.query(`
      SELECT hatchery_date FROM flock_master WHERE flock_no=$1
    `, [flock_no]);

    const ageDays = flock.rowCount > 0
      ? Math.floor((new Date(date) - new Date(flock.rows[0].hatchery_date)) / 86400000)
      : 0;

    const autoStage = ageDays <= 42 ? 'Brooming' : ageDays <= 126 ? 'Grooming' : 'Laying';

    const result = await pool.query(`
      INSERT INTO flock_daily_activity
        (flock_no, plant_code, order_no, activity_date, stage, age_days,
         male_count, female_count, mortality, cull_kill,
         cull_sales, bird_sales, egg_collection, entered_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      ON CONFLICT (flock_no, activity_date)
      DO UPDATE SET
        order_no       = EXCLUDED.order_no,
        stage          = EXCLUDED.stage,
        age_days       = EXCLUDED.age_days,
        male_count     = EXCLUDED.male_count,
        female_count   = EXCLUDED.female_count,
        mortality      = EXCLUDED.mortality,
        cull_kill      = EXCLUDED.cull_kill,
        cull_sales     = EXCLUDED.cull_sales,
        bird_sales     = EXCLUDED.bird_sales,
        egg_collection = EXCLUDED.egg_collection,
        entered_by     = EXCLUDED.entered_by,
        updated_at     = NOW()
      RETURNING *
    `, [
      flock_no, plant_code, order_no || null, date, stage || autoStage, ageDays,
      male_count||0, female_count||0, mortality||0, cull_kill||0,
      cull_sales||0, bird_sales||0, egg_collection||0,
      req.user?.id || null
    ]);

    return res.status(201).json({
      success: true,
      message: '✅ Flock daily activity saved',
      data:    result.rows[0],
    });
  } catch (err) {
    console.error('[saveFlockDetail]', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// SCREEN 2 + 3 MERGED — Flock detail + activity menu in one API
// GET /api/daily-activity/flock-detail/:flock_no?date=2026-05-03
// ═══════════════════════════════════════════════════════════════════════════
exports.getActivityMenu = async (req, res) => {
  const { flock_no } = req.params;
  const { date }     = req.query;
  const actDate = parseDate(date);

  try {
    // Get flock info + stage + age
    const flockRes = await pool.query(`
      SELECT fm.*,
        CASE WHEN fm.hatchery_date IS NOT NULL THEN (CURRENT_DATE - fm.hatchery_date::date) ELSE 0 END AS age_days,
        CASE
          WHEN fm.hatchery_date IS NULL THEN 'Laying'
          WHEN (CURRENT_DATE - fm.hatchery_date::date) <= 42  THEN 'Brooming'
          WHEN (CURRENT_DATE - fm.hatchery_date::date) <= 126 THEN 'Grooming'
          ELSE 'Laying'
        END AS stage
      FROM flock_master fm WHERE fm.flock_no = $1
    `, [flock_no]);

    if (flockRes.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Flock not found' });
    }
    const flock = flockRes.rows[0];

    // Get saved activity data for this date
    const actRes = await pool.query(
      `SELECT * FROM flock_daily_activity WHERE flock_no=$1 AND activity_date=$2`,
      [flock_no, actDate]
    );
    const activity = actRes.rows[0] || {};

    // Check which menu items have entries
    const [feedR, waterR, medR, othersR, weightR] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM flock_feeding_log WHERE flock_no=$1 AND feed_date=$2 AND feed_type='feed'`,     [flock_no, actDate]),
      pool.query(`SELECT COUNT(*) FROM flock_feeding_log WHERE flock_no=$1 AND feed_date=$2 AND feed_type='water'`,    [flock_no, actDate]),
      pool.query(`SELECT COUNT(*) FROM flock_feeding_log WHERE flock_no=$1 AND feed_date=$2 AND feed_type='medicine'`,[flock_no, actDate]),
      pool.query(`SELECT COUNT(*) FROM flock_feeding_log WHERE flock_no=$1 AND feed_date=$2 AND feed_type='others'`,   [flock_no, actDate]),
      pool.query(`SELECT COUNT(*) FROM flock_bird_weight  WHERE flock_no=$1 AND weight_date=$2`,                       [flock_no, actDate]),
    ]);

    return res.json({
      success:    true,
      flock_no,
      date:       actDate,
      // ── Screen 2 flock detail ─────────────────────────────────────────
      flock_name:    flock.flock_name || flock_no,
      stage:         flock.stage,
      age_days:      parseInt(flock.age_days) || 0,
      detail: {
        male_count:    activity.male_count    || 0,
        female_count:  activity.female_count  || 0,
        mortality:     activity.mortality     || 0,
        cull_kill:     activity.cull_kill     || 0,
        cull_sales:    activity.cull_sales    || 0,
        bird_sales:    activity.bird_sales    || 0,
        egg_collection:activity.egg_collection|| 0,
      },
      // ── Screen 3 activity menu ────────────────────────────────────────
      menu: [
        { key:'feeding',          label:'Feeding',                icon:'feeding',  has_entry: parseInt(feedR.rows[0].count)>0 },
        { key:'mortality',        label:'Mortality',              icon:'mortality',has_entry: actRes.rowCount>0 },
        { key:'culls_kill',       label:'Culls Kill',             icon:'culls',    has_entry: actRes.rowCount>0 },
        { key:'culls_sales',      label:'Culls Sales',            icon:'culls',    has_entry: actRes.rowCount>0 },
        { key:'egg_collection',   label:'Egg Collection & Grading',icon:'egg',     has_entry: actRes.rowCount>0 },
        { key:'bird_weighing',    label:'Bird Weighing',          icon:'weight',   has_entry: parseInt(weightR.rows[0].count)>0 },
      ],
    });
  } catch (err) {
    console.error('[getActivityMenu]', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// SCREEN 4 — Feeding entry
// GET  /api/daily-activity/feeding/items?type=feed|water|medicine|others
// GET  /api/daily-activity/feeding/stock?plant_code=1902&type=feed
// GET  /api/daily-activity/feeding/:flock_no?date=&type=
// POST /api/daily-activity/feeding/save
// ═══════════════════════════════════════════════════════════════════════════

// GET master items for dropdown
exports.getFeedingItems = async (req, res) => {
  const { type, plant_code } = req.query;
  if (!type || !['feed','water','medicine','others'].includes(type)) {
    return res.status(422).json({ success: false, message: 'type required: feed, water, medicine, others' });
  }

  try {
    if (req.query.auto_sync !== 'false') {
      try { await syncMaterialsFromSAPToLocal({ plant_code, module: req.query.module || 'Breeder' }); } catch (_) {}
    }

    const tableMap = {
      feed:     { table:'feed_master',     idCol:'mat_id',      hasModule:true  },
      water:    { table:'water_master',    idCol:'water_id',    hasModule:false },
      medicine: { table:'medicine_master', idCol:'medicine_id', hasModule:true  },
      others:   { table:'others_master',   idCol:'others_id',   hasModule:false },
    };
    const cfg = tableMap[type];
    let q = `SELECT id, ${cfg.idCol} AS type_id, item_name, uom FROM ${cfg.table} WHERE is_active=TRUE`;
    const p = [];
    // Filter by module for feed and medicine (default Breeder)
    const mod = req.query.module || 'Breeder';
    if (cfg.hasModule) { q += ` AND $1=ANY(module)`; p.push(mod); }
    q += ` ORDER BY item_name`;
    const result = await pool.query(q, p);
    return res.json({
      success: true,
      type,
      data: result.rows.map(r => ({
        id:        r.id,
        type_id:   r.type_id,
        item_name: r.item_name,
        uom:       r.uom,
        label:     `${r.item_name} (${r.uom})`,
      }))
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// GET stock for plant + item type
exports.getStock = async (req, res) => {
  const { plant_code, type } = req.query;
  if (!plant_code || !type) {
    return res.status(422).json({ success: false, message: 'plant_code and type required' });
  }

  try {
    if (req.query.auto_sync !== 'false') {
      try { await syncMaterialsFromSAPToLocal({ plant_code, module: req.query.module || 'Breeder' }); } catch (_) {}
    }

    const result = await pool.query(`
      SELECT sm.*, 
        CASE $2
          WHEN 'feed'     THEN fm.item_name
          WHEN 'water'    THEN wm.item_name
          WHEN 'medicine' THEN mm.item_name
          WHEN 'others'   THEN om.item_name
        END AS item_name
      FROM stock_master sm
      LEFT JOIN feed_master     fm ON sm.item_type='feed'     AND fm.id=sm.item_id
      LEFT JOIN water_master    wm ON sm.item_type='water'    AND wm.id=sm.item_id
      LEFT JOIN medicine_master mm ON sm.item_type='medicine' AND mm.id=sm.item_id
      LEFT JOIN others_master   om ON sm.item_type='others'   AND om.id=sm.item_id
      WHERE sm.plant_code=$1 AND sm.item_type=$2
      ORDER BY sm.item_id
    `, [plant_code, type]);

    return res.json({ success:true, plant_code, type, data: result.rows });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// GET saved feeding data for a flock + date
exports.getFeedingData = async (req, res) => {
  const { flock_no } = req.params;
  const { date, type } = req.query;
  const feedDate = date || todayDate();

  try {
    let q = `
      SELECT ffl.*, TO_CHAR(ffl.feed_date,'YYYY-MM-DD') AS feed_date, sm.stock_qty, sm.cum_qty
      FROM flock_feeding_log ffl
      LEFT JOIN stock_master sm
        ON sm.plant_code = ffl.plant_code
        AND sm.item_type = ffl.feed_type
        AND sm.item_id   = ffl.item_id
      WHERE ffl.flock_no=$1 AND ffl.feed_date=$2
    `;
    const params = [flock_no, feedDate];
    if (type) { q += ` AND ffl.feed_type=$3`; params.push(type); }
    q += ` ORDER BY ffl.feed_type, ffl.item_id`;

    const feedRes = await pool.query(q, params);

    // Get bird weight for this flock + date
    const weightRes = await pool.query(`
      SELECT male_weight, female_weight FROM flock_bird_weight
      WHERE flock_no=$1 AND weight_date=$2
    `, [flock_no, feedDate]);

    // Group by feed_type
    const grouped = { feed:[], water:[], medicine:[], others:[] };
    for (const row of feedRes.rows) {
      if (grouped[row.feed_type]) grouped[row.feed_type].push(formatRow(row));
    }

    return res.json({
      success:    true,
      flock_no,
      date:       feedDate,
      bird_weight: weightRes.rows[0] || { male_weight: null, female_weight: null },
      data:       grouped,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/daily-activity/feeding/save
// Saves feed/water/medicine/others entries + bird weight
exports.saveFeedingData = async (req, res) => {
  const {
    flock_no, plant_code, feed_date,
    order_no,
    batch_no,
    feed_type,    // 'feed' | 'water' | 'medicine' | 'others'
    items,        // [{ item_id, item_name, uom, qty_issued_male, qty_issued_female, stock_in_bags, cum_feed }]
    male_weight,  // bird weight — only for feed type
    female_weight,
    zzage,
    zzfstk,
    zzmstk,
    zzfbwt,
    zzmbwt,
  } = req.body;

  if (!flock_no || !plant_code || !feed_type) {
    return res.status(422).json({ success: false, message: 'flock_no, plant_code, feed_type required' });
  }
  if (!items || !items.length) {
    return res.status(422).json({ success: false, message: 'items array required' });
  }

  const date = parseDate(feed_date);
  const today = todayDate();
  if (date > today) return res.status(400).json({ success: false, message: 'Cannot enter future date' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`ALTER TABLE flock_feeding_log ADD COLUMN IF NOT EXISTS storage_location VARCHAR(10)`);
    await client.query(`ALTER TABLE flock_feeding_log ADD COLUMN IF NOT EXISTS batch_no VARCHAR(40)`);
    await client.query(`ALTER TABLE flock_feeding_log ADD COLUMN IF NOT EXISTS sap_age NUMERIC(12,3)`);
    await client.query(`ALTER TABLE flock_feeding_log ADD COLUMN IF NOT EXISTS sap_female_stock NUMERIC(12,3)`);
    await client.query(`ALTER TABLE flock_feeding_log ADD COLUMN IF NOT EXISTS sap_male_stock NUMERIC(12,3)`);
    await client.query(`ALTER TABLE flock_feeding_log ADD COLUMN IF NOT EXISTS sap_female_bird_weight NUMERIC(12,3)`);
    await client.query(`ALTER TABLE flock_feeding_log ADD COLUMN IF NOT EXISTS sap_male_bird_weight NUMERIC(12,3)`);

    const saved = [];

    const masterCfg = {
      feed: { table: 'feed_master', codeCol: 'mat_id' },
      water: { table: 'water_master', codeCol: 'water_id' },
      medicine: { table: 'medicine_master', codeCol: 'medicine_id' },
      others: { table: 'others_master', codeCol: 'others_id' },
    };
    const cfg = masterCfg[feed_type];
    if (!cfg) {
      const e = new Error(`Unsupported feed_type: ${feed_type}`);
      e.statusCode = 422;
      throw e;
    }

    for (const item of items) {
      const sapMatnr = String(item.sap_matnr || item.type_id || '').trim();
      if (!sapMatnr) {
        const e = new Error('sap_matnr required in each item (must come from SAP material list)');
        e.statusCode = 422;
        throw e;
      }

      const reqMale = parseFloat(item.qty_issued_male) || 0;
      const reqFemale = parseFloat(item.qty_issued_female) || 0;
      const reqTotal = reqMale + reqFemale;

      // Always validate from SAP stock rows (matnr + lgort) before save.
      const sapRows = await fetchSAPMaterials({ werks: plant_code, matnr: sapMatnr });
      const stockRows = sapRows
        .filter((r) => String(r?.matnr || '').trim() === sapMatnr)
        .map((r) => ({
          lgort: String(r?.lgort || '').trim(),
          labst: Number(r?.labst) || 0,
          maktx: String(r?.maktx || '').trim(),
          meins: String(r?.meins || '').trim(),
        }))
        .filter((r) => !!r.lgort);
      if (!stockRows.length) {
        const e = new Error(`No SAP stock rows found for matnr "${sapMatnr}" in plant "${plant_code}"`);
        e.statusCode = 422;
        throw e;
      }
      const requestedLgort = String(item.lgort || item.storage_location || '').trim();
      const chosen = requestedLgort
        ? stockRows.find((r) => r.lgort === requestedLgort)
        : stockRows.slice().sort((a, b) => b.labst - a.labst)[0];
      if (!chosen) {
        const allowed = stockRows.map((r) => r.lgort).join(', ');
        const e = new Error(`Invalid lgort "${requestedLgort}" for matnr "${sapMatnr}". Allowed: ${allowed}`);
        e.statusCode = 422;
        throw e;
      }
      const availableStock = Number(chosen.labst) || 0;
      if (reqTotal > availableStock) {
        const e = new Error(
          `Stock quantity is ${availableStock} for "${chosen.maktx || sapMatnr}" at location "${chosen.lgort}". Entered quantity is ${reqTotal}.`
        );
        e.statusCode = 422;
        throw e;
      }

      // Keep local masters/stock in sync with SAP-selected material before save.
      await syncMaterialsFromSAPToLocal({ plant_code, matnr: sapMatnr, module: 'Breeder' });
      const localItemRes = await client.query(
        `SELECT id, item_name, uom
           FROM ${cfg.table}
          WHERE ${cfg.codeCol}=$1 AND is_active=TRUE
          ORDER BY id DESC
          LIMIT 1`,
        [sapMatnr]
      );
      if (!localItemRes.rowCount) {
        const e = new Error(`Material ${sapMatnr} not available in local master ${cfg.table} after SAP sync`);
        e.statusCode = 422;
        throw e;
      }
      const localItem = localItemRes.rows[0];
      const baseSapAge = item.zzage ?? item.sap_age ?? zzage ?? null;
      let sapFemaleStock = item.zzfstk ?? item.sap_female_stock ?? zzfstk ?? null;
      let sapMaleStock = item.zzmstk ?? item.sap_male_stock ?? zzmstk ?? null;
      let sapAge = baseSapAge;
      if (sapAge == null || sapFemaleStock == null || sapMaleStock == null) {
        const da = await client.query(
          `SELECT age_days, female_count, male_count
             FROM flock_daily_activity
            WHERE flock_no=$1 AND plant_code=$2 AND activity_date <= $3
            ORDER BY activity_date DESC
            LIMIT 1`,
          [flock_no, plant_code, date]
        );
        const d = da.rows[0] || null;
        if (sapAge == null) sapAge = d?.age_days ?? null;
        if (sapFemaleStock == null) sapFemaleStock = d?.female_count ?? null;
        if (sapMaleStock == null) sapMaleStock = d?.male_count ?? null;
      }
      const sapFemaleBirdWeight = item.zzfbwt ?? item.sap_female_bird_weight ?? zzfbwt ?? female_weight ?? null;
      const sapMaleBirdWeight = item.zzmbwt ?? item.sap_male_bird_weight ?? zzmbwt ?? male_weight ?? null;

      const result = await client.query(`
        INSERT INTO flock_feeding_log
          (flock_no, plant_code, order_no, feed_date, feed_type, item_id, item_name, uom,
           qty_issued_male, qty_issued_female, stock_in_bags, cum_feed, entered_by, storage_location, batch_no,
           sap_age, sap_female_stock, sap_male_stock, sap_female_bird_weight, sap_male_bird_weight)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
        ON CONFLICT (flock_no, feed_date, feed_type, item_id)
        DO UPDATE SET
          order_no          = EXCLUDED.order_no,
          item_name         = EXCLUDED.item_name,
          uom               = EXCLUDED.uom,
          qty_issued_male   = EXCLUDED.qty_issued_male,
          qty_issued_female = EXCLUDED.qty_issued_female,
          stock_in_bags     = EXCLUDED.stock_in_bags,
          cum_feed          = EXCLUDED.cum_feed,
          entered_by        = EXCLUDED.entered_by,
          storage_location  = EXCLUDED.storage_location,
          batch_no          = EXCLUDED.batch_no,
          sap_age           = COALESCE(EXCLUDED.sap_age, flock_feeding_log.sap_age),
          sap_female_stock  = COALESCE(EXCLUDED.sap_female_stock, flock_feeding_log.sap_female_stock),
          sap_male_stock    = COALESCE(EXCLUDED.sap_male_stock, flock_feeding_log.sap_male_stock),
          sap_female_bird_weight = COALESCE(EXCLUDED.sap_female_bird_weight, flock_feeding_log.sap_female_bird_weight),
          sap_male_bird_weight   = COALESCE(EXCLUDED.sap_male_bird_weight, flock_feeding_log.sap_male_bird_weight),
          updated_at        = NOW()
        RETURNING *
      `, [
        flock_no, plant_code, order_no || null, date, feed_type,
        localItem.id, chosen.maktx || localItem.item_name || item.item_name || null, chosen.meins || localItem.uom || item.uom || null,
        item.qty_issued_male   || 0,
        item.qty_issued_female || 0,
        availableStock,
        item.cum_feed          || 0,
        req.user?.id || null,
        chosen.lgort,
        batch_no || null,
        sapAge,
        sapFemaleStock,
        sapMaleStock,
        sapFemaleBirdWeight,
        sapMaleBirdWeight
      ]);
      saved.push(result.rows[0]);
    }

    // Save bird weight (only for feed type)
    let birdWeight = null;
    if (feed_type === 'feed' && (male_weight != null || female_weight != null)) {
      const bwResult = await client.query(`
        INSERT INTO flock_bird_weight
          (flock_no, plant_code, order_no, weight_date, male_weight, female_weight, entered_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (flock_no, weight_date)
        DO UPDATE SET
          order_no      = EXCLUDED.order_no,
          male_weight   = EXCLUDED.male_weight,
          female_weight = EXCLUDED.female_weight,
          entered_by    = EXCLUDED.entered_by,
          updated_at    = NOW()
        RETURNING *
      `, [flock_no, plant_code, order_no || null, date, male_weight||null, female_weight||null, req.user?.id||null]);
      birdWeight = bwResult.rows[0];
    }

    await client.query('COMMIT');

    const sap_push_results = [];
    for (const row of saved) {
      const pushResult = await pushToSap(pool, 'feeding', row.id);
      sap_push_results.push(pushResult);
    }
    const sapFailed = sap_push_results.some((r) => !r?.ok);

    return res.status(201).json({
      success:     true,
      message:     `✅ ${saved.length} ${feed_type} items saved for flock ${flock_no}`,
      flock_no,
      plant_code,
      order_no: order_no || null,
      feed_date:   date,
      feed_type,
      saved,
      bird_weight: birdWeight,
      sap_pushed: true,
      sap_push_failed: sapFailed,
      sap_push_results,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[saveFeedingData]', err.message);
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// MASTERS CRUD — Feed, Water, Medicine, Others
// ═══════════════════════════════════════════════════════════════════════════

// ── FEED MASTER ──────────────────────────────────────────────────────────
// Columns: Feed ID | Name | UOM | Module (Broiler/Breeder/Hatchery) | Actions
exports.getFeedMaster = async (req, res) => {
  const { module } = req.query;
  let q = `SELECT * FROM feed_master WHERE is_active=TRUE`;
  const p = [];
  if (module) { q += ` AND $1=ANY(module)`; p.push(module); }
  q += ` ORDER BY mat_id, item_name`;
  const result = await pool.query(q, p);
  return res.json({ success:true, total:result.rowCount, data:result.rows });
};

exports.addFeedMaster = async (req, res) => {
  const { mat_id, item_name, uom, module } = req.body;
  if (!item_name) return res.status(422).json({ success:false, message:'item_name required' });
  try {
    const result = await pool.query(
      `INSERT INTO feed_master (mat_id, item_name, uom, module, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [mat_id||null, item_name, uom||'Kg',
       Array.isArray(module) ? module : (module ? [module] : ['Breeder']),
       req.user?.username||'admin']
    );
    return res.status(201).json({ success:true, message:'Feed item added', data:result.rows[0] });
  } catch(err) { return res.status(500).json({ success:false, message:err.message }); }
};

exports.updateFeedMaster = async (req, res) => {
  const { mat_id, item_name, uom, module, is_active } = req.body;
  const sets=[]; const vals=[]; let idx=1;
  if (mat_id    !== undefined) { sets.push(`mat_id=$${idx++}`);    vals.push(mat_id); }
  if (item_name !== undefined) { sets.push(`item_name=$${idx++}`); vals.push(item_name); }
  if (uom       !== undefined) { sets.push(`uom=$${idx++}`);       vals.push(uom); }
  if (module    !== undefined) { sets.push(`module=$${idx++}`);    vals.push(Array.isArray(module)?module:[module]); }
  if (is_active !== undefined) { sets.push(`is_active=$${idx++}`); vals.push(is_active); }
  if (!sets.length) return res.status(400).json({ success:false, message:'Nothing to update' });
  sets.push(`updated_by=$${idx++}`); vals.push(req.user?.username||'admin');
  sets.push(`updated_at=NOW()`); vals.push(req.params.id);
  const result = await pool.query(`UPDATE feed_master SET ${sets.join(',')} WHERE id=$${idx} RETURNING *`, vals);
  if (result.rowCount===0) return res.status(404).json({ success:false, message:'Not found' });
  return res.json({ success:true, message:'Updated', data:result.rows[0] });
};

exports.deleteFeedMaster = async (req, res) => {
  const result = await pool.query(`UPDATE feed_master SET is_active=FALSE WHERE id=$1 RETURNING id,item_name`, [req.params.id]);
  if (result.rowCount===0) return res.status(404).json({ success:false, message:'Not found' });
  return res.json({ success:true, message:'Deleted', data:result.rows[0] });
};

// ── WATER MASTER ─────────────────────────────────────────────────────────
// Columns: Water ID | Name | UOM | Actions (no module)
exports.getWaterMaster = async (req, res) => {
  const result = await pool.query(`SELECT * FROM water_master WHERE is_active=TRUE ORDER BY water_id, item_name`);
  return res.json({ success:true, total:result.rowCount, data:result.rows });
};

exports.addWaterMaster = async (req, res) => {
  const { water_id, item_name, uom } = req.body;
  if (!item_name) return res.status(422).json({ success:false, message:'item_name required' });
  try {
    const result = await pool.query(
      `INSERT INTO water_master (water_id, item_name, uom, created_by) VALUES ($1,$2,$3,$4) RETURNING *`,
      [water_id||null, item_name, uom||'Lit', req.user?.username||'admin']
    );
    return res.status(201).json({ success:true, message:'Water item added', data:result.rows[0] });
  } catch(err) { return res.status(500).json({ success:false, message:err.message }); }
};

exports.updateWaterMaster = async (req, res) => {
  const { water_id, item_name, uom, is_active } = req.body;
  const sets=[]; const vals=[]; let idx=1;
  if (water_id  !== undefined) { sets.push(`water_id=$${idx++}`);  vals.push(water_id); }
  if (item_name !== undefined) { sets.push(`item_name=$${idx++}`); vals.push(item_name); }
  if (uom       !== undefined) { sets.push(`uom=$${idx++}`);       vals.push(uom); }
  if (is_active !== undefined) { sets.push(`is_active=$${idx++}`); vals.push(is_active); }
  if (!sets.length) return res.status(400).json({ success:false, message:'Nothing to update' });
  sets.push(`updated_by=$${idx++}`); vals.push(req.user?.username||'admin');
  sets.push(`updated_at=NOW()`); vals.push(req.params.id);
  const result = await pool.query(`UPDATE water_master SET ${sets.join(',')} WHERE id=$${idx} RETURNING *`, vals);
  if (result.rowCount===0) return res.status(404).json({ success:false, message:'Not found' });
  return res.json({ success:true, message:'Updated', data:result.rows[0] });
};

exports.deleteWaterMaster = async (req, res) => {
  const result = await pool.query(`UPDATE water_master SET is_active=FALSE WHERE id=$1 RETURNING id,item_name`, [req.params.id]);
  if (result.rowCount===0) return res.status(404).json({ success:false, message:'Not found' });
  return res.json({ success:true, message:'Deleted', data:result.rows[0] });
};

// ── MEDICINE MASTER ───────────────────────────────────────────────────────
// Columns: Medicine ID | Name | UOM | Module | Actions
exports.getMedicineMaster = async (req, res) => {
  const { module } = req.query;
  let q = `SELECT * FROM medicine_master WHERE is_active=TRUE`;
  const p = [];
  if (module) { q += ` AND $1=ANY(module)`; p.push(module); }
  q += ` ORDER BY medicine_id, item_name`;
  const result = await pool.query(q, p);
  return res.json({ success:true, total:result.rowCount, data:result.rows });
};

exports.addMedicineMaster = async (req, res) => {
  const { medicine_id, item_name, uom, module } = req.body;
  if (!item_name) return res.status(422).json({ success:false, message:'item_name required' });
  try {
    const result = await pool.query(
      `INSERT INTO medicine_master (medicine_id, item_name, uom, module, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [medicine_id||null, item_name, uom||'Nos',
       Array.isArray(module) ? module : (module ? [module] : ['Breeder']),
       req.user?.username||'admin']
    );
    return res.status(201).json({ success:true, message:'Medicine item added', data:result.rows[0] });
  } catch(err) { return res.status(500).json({ success:false, message:err.message }); }
};

exports.updateMedicineMaster = async (req, res) => {
  const { medicine_id, item_name, uom, module, is_active } = req.body;
  const sets=[]; const vals=[]; let idx=1;
  if (medicine_id !== undefined) { sets.push(`medicine_id=$${idx++}`); vals.push(medicine_id); }
  if (item_name   !== undefined) { sets.push(`item_name=$${idx++}`);   vals.push(item_name); }
  if (uom         !== undefined) { sets.push(`uom=$${idx++}`);         vals.push(uom); }
  if (module      !== undefined) { sets.push(`module=$${idx++}`);      vals.push(Array.isArray(module)?module:[module]); }
  if (is_active   !== undefined) { sets.push(`is_active=$${idx++}`);   vals.push(is_active); }
  if (!sets.length) return res.status(400).json({ success:false, message:'Nothing to update' });
  sets.push(`updated_by=$${idx++}`); vals.push(req.user?.username||'admin');
  sets.push(`updated_at=NOW()`); vals.push(req.params.id);
  const result = await pool.query(`UPDATE medicine_master SET ${sets.join(',')} WHERE id=$${idx} RETURNING *`, vals);
  if (result.rowCount===0) return res.status(404).json({ success:false, message:'Not found' });
  return res.json({ success:true, message:'Updated', data:result.rows[0] });
};

exports.deleteMedicineMaster = async (req, res) => {
  const result = await pool.query(`UPDATE medicine_master SET is_active=FALSE WHERE id=$1 RETURNING id,item_name`, [req.params.id]);
  if (result.rowCount===0) return res.status(404).json({ success:false, message:'Not found' });
  return res.json({ success:true, message:'Deleted', data:result.rows[0] });
};

// ── OTHERS MASTER ─────────────────────────────────────────────────────────
// Columns: Others ID | Name | UOM | Actions (no module)
exports.getOthersMaster = async (req, res) => {
  const result = await pool.query(`SELECT * FROM others_master WHERE is_active=TRUE ORDER BY others_id, item_name`);
  return res.json({ success:true, total:result.rowCount, data:result.rows });
};

exports.addOthersMaster = async (req, res) => {
  const { others_id, item_name, uom } = req.body;
  if (!item_name) return res.status(422).json({ success:false, message:'item_name required' });
  try {
    const result = await pool.query(
      `INSERT INTO others_master (others_id, item_name, uom, created_by) VALUES ($1,$2,$3,$4) RETURNING *`,
      [others_id||null, item_name, uom||'Kg', req.user?.username||'admin']
    );
    return res.status(201).json({ success:true, message:'Others item added', data:result.rows[0] });
  } catch(err) { return res.status(500).json({ success:false, message:err.message }); }
};

exports.updateOthersMaster = async (req, res) => {
  const { others_id, item_name, uom, is_active } = req.body;
  const sets=[]; const vals=[]; let idx=1;
  if (others_id !== undefined) { sets.push(`others_id=$${idx++}`); vals.push(others_id); }
  if (item_name !== undefined) { sets.push(`item_name=$${idx++}`); vals.push(item_name); }
  if (uom       !== undefined) { sets.push(`uom=$${idx++}`);       vals.push(uom); }
  if (is_active !== undefined) { sets.push(`is_active=$${idx++}`); vals.push(is_active); }
  if (!sets.length) return res.status(400).json({ success:false, message:'Nothing to update' });
  sets.push(`updated_by=$${idx++}`); vals.push(req.user?.username||'admin');
  sets.push(`updated_at=NOW()`); vals.push(req.params.id);
  const result = await pool.query(`UPDATE others_master SET ${sets.join(',')} WHERE id=$${idx} RETURNING *`, vals);
  if (result.rowCount===0) return res.status(404).json({ success:false, message:'Not found' });
  return res.json({ success:true, message:'Updated', data:result.rows[0] });
};

exports.deleteOthersMaster = async (req, res) => {
  const result = await pool.query(`UPDATE others_master SET is_active=FALSE WHERE id=$1 RETURNING id,item_name`, [req.params.id]);
  if (result.rowCount===0) return res.status(404).json({ success:false, message:'Not found' });
  return res.json({ success:true, message:'Deleted', data:result.rows[0] });
};

// Stock Master
exports.getStockMaster = async (req,res) => {
  const { plant_code, type } = req.query;
  let q = `SELECT * FROM stock_master WHERE 1=1`;
  const p = [];
  if (plant_code) { q += ` AND plant_code=$${p.length+1}`; p.push(plant_code); }
  if (type)       { q += ` AND item_type=$${p.length+1}`;  p.push(type); }
  q += ` ORDER BY item_type, item_id`;
  const result = await pool.query(q, p);
  return res.json({ success:true, total: result.rowCount, data: result.rows });
};

exports.addStockMaster = async (req,res) => {
  const { plant_code, item_type, item_id, item_name, uom, stock_qty, cum_qty } = req.body;
  if (!plant_code || !item_type || !item_id) {
    return res.status(422).json({ success:false, message:'plant_code, item_type, item_id required' });
  }
  try {
    const result = await pool.query(`
      INSERT INTO stock_master (plant_code, item_type, item_id, item_name, uom, stock_qty, cum_qty)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT DO NOTHING RETURNING *
    `, [plant_code, item_type, item_id, item_name||null, uom||null, stock_qty||0, cum_qty||0]);
    return res.status(201).json({ success:true, message:'Stock added', data: result.rows[0] });
  } catch(err) {
    return res.status(500).json({ success:false, message: err.message });
  }
};

exports.updateStockMaster = async (req,res) => {
  const { stock_qty, cum_qty } = req.body;
  const result = await pool.query(`
    UPDATE stock_master SET
      stock_qty  = COALESCE($1, stock_qty),
      cum_qty    = COALESCE($2, cum_qty),
      updated_at = NOW()
    WHERE id=$3 RETURNING *
  `, [stock_qty??null, cum_qty??null, req.params.id]);
  if (result.rowCount===0) return res.status(404).json({ success:false, message:'Not found' });
  return res.json({ success:true, message:'Updated', data: result.rows[0] });
};
