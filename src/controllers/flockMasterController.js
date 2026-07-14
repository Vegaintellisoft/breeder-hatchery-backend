const axios = require('axios');
const pool  = require('../config/db');
const { generateVaccinationSchedule } = require('./vaccinationScheduleController');

const SAP_BASE   = process.env.SAP_BASE_URL || 'http://krishidevqas.krishinutrition.com:8001/sap/bc/breeder';
const SAP_AUTH   = { username: process.env.SAP_USER || 'vega', password: process.env.SAP_PASSWORD || 'Vegaintell@123' };
const SAP_PARAMS = { 'sap-client': process.env.SAP_CLIENT || '500' };

const safeDate = (val) => (val && String(val).trim() !== '' ? val : null);

async function fetchSAP(endpoint) {
  const res = await axios.get(`${SAP_BASE}/${endpoint}`, {
    auth: SAP_AUTH, params: SAP_PARAMS, timeout: 30000
  });
  return res.data;
}

async function syncFlocksToDB(flocks) {
  if (!flocks || flocks.length === 0) return 0;
  const client = await pool.connect();
  try {
    let saved = 0;
    for (const f of flocks) {
      await client.query(`
        INSERT INTO flock_master
          (flock_no, flock_name, farm_code, farm_name, batch,
           document_date, hatchery_date, status, deletion_flag,
           sap_user, sap_time, source)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'SAP')
        ON CONFLICT (flock_no) DO UPDATE SET
          flock_name   = EXCLUDED.flock_name,
          farm_code    = EXCLUDED.farm_code,
          farm_name    = EXCLUDED.farm_name,
          batch        = EXCLUDED.batch,
          document_date= EXCLUDED.document_date,
          hatchery_date= EXCLUDED.hatchery_date,
          status       = EXCLUDED.status,
          deletion_flag= EXCLUDED.deletion_flag,
          sap_user     = EXCLUDED.sap_user,
          sap_time     = EXCLUDED.sap_time,
          updated_at   = NOW()
      `, [
        f.flock_no, f.flock_name, f.farm_code, f.farm_name, f.batch,
        f.document_date, f.hatchery_date,
        f.deletion_flag === 'X' ? 'D' : (f.status || 'A'),
        f.deletion_flag || '',
        f.sap_user, f.sap_time
      ]);
      // Auto-generate vaccination + biosecurity schedule for new flock
      try {
        const flockData = flocks.find(fl => fl.flock_no === f.flock_no);
        if (flockData?.hatchery_date) {
          await generateVaccinationSchedule(
            f.flock_no,
            f.farm_code || f.plant_code,
            flockData.hatchery_date
          );
        }
      } catch(e) {
        console.error(`[flock sync] vaccination schedule error for ${f.flock_no}:`, e.message);
      }
      saved++;
    }
    return saved;
  } finally {
    client.release();
  }
}

function mergeFlockData(layingRows, birdRows) {
  const map = {};

  for (const r of layingRows) {
    const key = r.zzflock;
    if (!key) continue;
    if (!map[key]) {
      map[key] = {
        flock_no:      r.zzflock,
        flock_name:    r.zzflockn || '',
        farm_code:     r.lifnr    || '',
        farm_name:     '',
        batch:         (r.zzflockn || '').split('-').pop()?.trim() || '',
        document_date: safeDate(r.bldat),
        hatchery_date: null,
        status:        r.loekz === 'X' ? 'D' : 'A',
        deletion_flag: r.loekz || '',
        sap_user:      r.uname  || '',
        sap_time:      r.uzeit  || ''
      };
    }
  }

  for (const r of birdRows) {
    const key = r.zzflock || r.lifnr;
    if (!key) continue;
    if (map[key]) {
      if (!map[key].hatchery_date) map[key].hatchery_date = safeDate(r.hatchdt);
      if (!map[key].farm_code)     map[key].farm_code     = r.lifnr || '';
    }
  }

  return Object.values(map);
}

// ── Handlers ──────────────────────────────────────────────────────────────
exports.getFlockMaster = async (req, res) => {
  try {
    const [layingData, birdData] = await Promise.allSettled([
      fetchSAP('zlaying_prelay'),
      fetchSAP('zbird_receipt')
    ]);

    const layingRows = layingData.status === 'fulfilled'
      ? (layingData.value?.ET_LAYING || layingData.value?.results || []) : [];
    const birdRows = birdData.status === 'fulfilled'
      ? (birdData.value?.ET_BIRD_RECEIPT || birdData.value?.results || []) : [];

    const flocks = mergeFlockData(
      Array.isArray(layingRows) ? layingRows : [],
      Array.isArray(birdRows)   ? birdRows   : []
    );

    const saved = await syncFlocksToDB(flocks);

    // Build DB query with filters
    const { status, search, farm_code, batch, include_deleted } = req.query;
    let where = [];
    let params = [];
    let idx = 1;

    if (!include_deleted || include_deleted !== 'true') {
      where.push(`deletion_flag != 'X'`);
    }
    if (status) { where.push(`status = $${idx++}`); params.push(status); }
    if (farm_code) { where.push(`farm_code = $${idx++}`); params.push(farm_code); }
    if (batch) { where.push(`batch ILIKE $${idx++}`); params.push(`%${batch}%`); }
    if (search) {
      where.push(`(flock_name ILIKE $${idx} OR flock_no::text ILIKE $${idx})`);
      params.push(`%${search}%`); idx++;
    }

    const sql = `SELECT * FROM flock_master ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY flock_no`;
    const dbResult = await pool.query(sql, params);

    res.json({
      success: true,
      sap_synced: saved,
      total: dbResult.rows.length,
      data: dbResult.rows
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getFlockById = async (req, res) => {
  try {
    const { flock_no } = req.params;
    const result = await pool.query('SELECT * FROM flock_master WHERE flock_no = $1', [flock_no]);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Flock not found' });
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getFlockDropdown = async (req, res) => {
  try {
    const { farm_code } = req.query;
    let sql = `SELECT flock_no, flock_name, farm_code, batch, status
               FROM flock_master WHERE status = 'A' AND deletion_flag != 'X'`;
    const params = [];
    if (farm_code) { sql += ` AND farm_code = $1`; params.push(farm_code); }
    sql += ' ORDER BY flock_name';
    const result = await pool.query(sql, params);
    res.json({ success: true, total: result.rows.length, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
