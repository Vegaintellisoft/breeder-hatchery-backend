require('dotenv').config();
const path   = require('path');
const pool   = require('../src/config/db');

// ── Try to load xlsx; skip seeding if not installed ────────────────────────
let XLSX;
try { XLSX = require('xlsx'); } catch { XLSX = null; }

async function createTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS farmer_master (
      id                  SERIAL PRIMARY KEY,
      farm_number         VARCHAR(20)  NOT NULL,
      shed_no             VARCHAR(10)  NOT NULL,
      plant               VARCHAR(10),
      supplier_code       VARCHAR(20),
      farmer_name         VARCHAR(200),
      line_code           VARCHAR(10),
      line_name           VARCHAR(100),
      posting_date        DATE,
      document_date       DATE,
      owner_name          VARCHAR(150),
      mobile_number       VARCHAR(20),
      farm_type           VARCHAR(10),
      no_of_sheds         INTEGER      DEFAULT 0,
      water_tank          VARCHAR(10),
      roof_type           VARCHAR(10),
      floor_type          VARCHAR(10),
      eb_phase            VARCHAR(10),
      ph_value            NUMERIC(6,2) DEFAULT 0,
      water_source        VARCHAR(50),
      shed_type           VARCHAR(10),
      farm_length         NUMERIC(10,2) DEFAULT 0,
      farm_width          NUMERIC(10,2) DEFAULT 0,
      capacity            NUMERIC(12,2) DEFAULT 0,
      feed_room           INTEGER       DEFAULT 0,
      chick_house_capacity INTEGER      DEFAULT 0,
      shed_ready          VARCHAR(20),
      status              VARCHAR(5)   DEFAULT 'A',
      sap_user            VARCHAR(30),
      sap_time            VARCHAR(20),
      deletion_indicator  VARCHAR(5)   DEFAULT '',
      created_at          TIMESTAMP    DEFAULT NOW(),
      updated_at          TIMESTAMP    DEFAULT NOW(),
      UNIQUE (farm_number, shed_no)
    );
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_farmer_plant     ON farmer_master(plant);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_farmer_status    ON farmer_master(status);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_farmer_supplier  ON farmer_master(supplier_code);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_farmer_line_code ON farmer_master(line_code);`);
  console.log('✅ farmer_master table created.');
}

function safeDate(val) {
  if (!val) return null;
  // Excel serial number (e.g. 45047)
  if (typeof val === 'number') {
    // Excel epoch offset: serial 1 = Jan 1 1900, but has leap year bug so use 25569 offset from Unix epoch
    const d = new Date(Math.round((val - 25569) * 86400 * 1000));
    return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
  }
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val.toISOString().split('T')[0];
  const s = String(val).trim();
  return s === '' ? null : s;
}

function safeNum(val) {
  const n = parseFloat(val);
  return isNaN(n) ? 0 : n;
}

function safeStr(val) {
  if (val === null || val === undefined) return '';
  return String(val).trim().replace(/\u00a0/g, ' ').trim();
}

async function seedFromExcel(client, xlsxPath) {
  if (!XLSX) {
    console.log('⚠️  xlsx package not installed — skipping seed. Run: npm install xlsx');
    return 0;
  }
  if (!require('fs').existsSync(xlsxPath)) {
    console.log(`⚠️  Excel file not found at ${xlsxPath} — skipping seed.`);
    return 0;
  }

  const wb = XLSX.readFile(xlsxPath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  // Row 0 is header, rows 1+ are data
  let saved = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[0]) continue; // skip empty rows

    const timVal = r[28]; // column index 28 = Time (first occurrence)
    let sapTime = '';
    if (timVal instanceof Date) {
      sapTime = timVal.toTimeString().split(' ')[0];
    } else if (typeof timVal === 'number') {
      // Excel time fraction: 0.5 = 12:00:00
      const totalSec = Math.round(timVal * 86400);
      const h = Math.floor(totalSec / 3600);
      const m = Math.floor((totalSec % 3600) / 60);
      const s = totalSec % 60;
      sapTime = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    } else {
      sapTime = safeStr(timVal);
    }

    await client.query(`
      INSERT INTO farmer_master (
        farm_number, shed_no, plant, supplier_code, farmer_name,
        line_code, line_name, posting_date, document_date,
        owner_name, mobile_number, farm_type, no_of_sheds, water_tank,
        roof_type, floor_type, eb_phase, ph_value, water_source,
        shed_type, farm_length, farm_width, capacity,
        feed_room, chick_house_capacity, shed_ready, status,
        sap_user, sap_time, deletion_indicator
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
        $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
        $21,$22,$23,$24,$25,$26,$27,$28,$29,$30
      )
      ON CONFLICT (farm_number, shed_no) DO UPDATE SET
        plant=$3, supplier_code=$4, farmer_name=$5,
        line_code=$6, line_name=$7, posting_date=$8, document_date=$9,
        farm_type=$12, no_of_sheds=$13, roof_type=$15, floor_type=$16,
        farm_length=$21, farm_width=$22, capacity=$23,
        chick_house_capacity=$25, status=$27,
        sap_user=$28, deletion_indicator=$30,
        updated_at=NOW()
    `, [
      safeStr(r[0]),   // farm_number
      safeStr(r[1]),   // shed_no
      safeStr(r[2]),   // plant
      safeStr(r[3]),   // supplier_code
      safeStr(r[4]),   // farmer_name
      safeStr(r[5]),   // line_code
      safeStr(r[6]),   // line_name
      safeDate(r[7]),  // posting_date
      safeDate(r[8]),  // document_date
      safeStr(r[9]),   // owner_name
      safeStr(r[10]),  // mobile_number
      safeStr(r[11]),  // farm_type
      safeNum(r[12]),  // no_of_sheds
      safeStr(r[13]),  // water_tank
      safeStr(r[14]),  // roof_type
      safeStr(r[15]),  // floor_type
      safeStr(r[16]),  // eb_phase
      safeNum(r[17]),  // ph_value
      safeStr(r[18]),  // water_source
      safeStr(r[19]),  // shed_type
      safeNum(r[20]),  // farm_length
      safeNum(r[21]),  // farm_width
      safeNum(r[22]),  // capacity
      safeNum(r[23]),  // feed_room
      safeNum(r[24]),  // chick_house_capacity
      safeStr(r[25]),  // shed_ready
      safeStr(r[26]) || 'A', // status
      safeStr(r[27]),  // sap_user (User Name col 27)
      sapTime,         // sap_time (Time col 28)
      safeStr(r[34]) || '' // deletion_indicator (col 34)
    ]);
    saved++;
  }
  return saved;
}

async function runMigration() {
  const client = await pool.connect();
  try {
    await createTable(client);

    // Try to seed from Excel if it exists alongside this script
    const xlsxPath = path.join(__dirname, 'farmer_master.xlsx');
    const seeded = await seedFromExcel(client, xlsxPath);
    if (seeded > 0) console.log(`✅ Seeded ${seeded} farmer records from Excel.`);

    console.log('\n✅ farmer_master migration complete.');
    console.log('\nTo seed from Excel, copy your file to:');
    console.log(`   ${xlsxPath}`);
    console.log('Then run: npm run migrate:farmer\n');
  } catch (err) {
    console.error('Migration error:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration();
