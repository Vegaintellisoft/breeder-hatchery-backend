require('dotenv').config();
const pool = require('../src/config/db');

async function run() {
  const client = await pool.connect();
  try {
    console.log('\n🚀 Running New Masters Migration...\n');
    await client.query('BEGIN');

    // ── 1. STANDARD WEIGHT MASTER (Header) ───────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS standard_weight_header (
        id          SERIAL PRIMARY KEY,
        doc_no      VARCHAR(50) NOT NULL,
        doc_date    DATE,
        start_date  DATE,
        end_date    DATE,
        season      VARCHAR(20) CHECK (season IN ('Summer','Winter','All')),
        remarks     TEXT,
        is_active   BOOLEAN DEFAULT TRUE,
        created_by  VARCHAR(100),
        created_at  TIMESTAMP DEFAULT NOW(),
        updated_at  TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('  ✔ Table: standard_weight_header');

    // ── 2. STANDARD WEIGHT DETAIL (week rows) ────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS standard_weight_detail (
        id            SERIAL PRIMARY KEY,
        header_id     INT NOT NULL REFERENCES standard_weight_header(id) ON DELETE CASCADE,
        age_in_weeks  NUMERIC(5,1) NOT NULL,
        male_weight   NUMERIC(8,2),
        female_weight NUMERIC(8,2),
        created_at    TIMESTAMP DEFAULT NOW(),
        updated_at    TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_swd_header ON standard_weight_detail(header_id);`);
    console.log('  ✔ Table: standard_weight_detail');

    // ── 3. MORTALITY/CULL REASON MASTER (combined with module) ───────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS mortality_cull_reason_master (
        id          SERIAL PRIMARY KEY,
        reason_id   VARCHAR(50),
        reason_name VARCHAR(200) NOT NULL,
        module      VARCHAR(20) DEFAULT 'Mortality'
                    CHECK (module IN ('Mortality','Cull','Both')),
        is_active   BOOLEAN DEFAULT TRUE,
        created_by  VARCHAR(100),
        created_at  TIMESTAMP DEFAULT NOW(),
        updated_at  TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('  ✔ Table: mortality_cull_reason_master');

    // ── 4. BIRD GRADING MASTER ────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS bird_grading_master (
        id           SERIAL PRIMARY KEY,
        doc_no       VARCHAR(50) NOT NULL,
        doc_date     DATE,
        start_date   DATE,
        end_date     DATE,
        age_in_weeks NUMERIC(5,1),
        is_active    BOOLEAN DEFAULT TRUE,
        created_by   VARCHAR(100),
        created_at   TIMESTAMP DEFAULT NOW(),
        updated_at   TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('  ✔ Table: bird_grading_master');

    // ── 5. EGG GRADING MASTER ─────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS egg_grading_master (
        id           SERIAL PRIMARY KEY,
        grading_id   VARCHAR(50),
        grading_name VARCHAR(200) NOT NULL,
        short_code   VARCHAR(20),
        is_active    BOOLEAN DEFAULT TRUE,
        created_by   VARCHAR(100),
        created_at   TIMESTAMP DEFAULT NOW(),
        updated_at   TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('  ✔ Table: egg_grading_master');

    // ── SEED DATA ─────────────────────────────────────────────────────────

    // Standard weight sample
    const swRes = await client.query(`
      INSERT INTO standard_weight_header (doc_no, doc_date, start_date, end_date, season, remarks, created_by)
      VALUES ('SW001', CURRENT_DATE, CURRENT_DATE, CURRENT_DATE + 365, 'All', 'Default standard weight', 'system')
      RETURNING id
    `);
    if (swRes.rowCount > 0) {
      const hid = swRes.rows[0].id;
      const weeks = [[1,45,42],[2,85,80],[3,130,120],[4,185,170],[5,245,225],[6,310,285],[7,380,350],[8,455,420],[10,580,535],[12,700,645],[16,900,830],[20,1080,995],[24,1240,1140],[28,1380,1265],[32,1480,1355],[36,1540,1410],[40,1570,1440],[44,1580,1450],[48,1590,1455],[52,1595,1460]];
      for (const [w,m,f] of weeks) {
        await client.query(`INSERT INTO standard_weight_detail (header_id,age_in_weeks,male_weight,female_weight) VALUES ($1,$2,$3,$4)`,[hid,w,m,f]);
      }
      console.log('  ✔ Seeded: standard_weight_header + 20 week entries');
    }

    // Mortality/Cull reasons combined
    const reasons = [
      ['MR001','Disease / Infection',  'Mortality'],
      ['MR002','Injury',               'Mortality'],
      ['MR003','Smothering',           'Mortality'],
      ['MR004','Prolapse',             'Mortality'],
      ['MR005','Starvation',           'Mortality'],
      ['MR006','Unknown / Sudden Death','Both'],
      ['MR007','Heat Stress',          'Mortality'],
      ['MR008','Predator Attack',      'Mortality'],
      ['CR001','Sick Bird',            'Cull'],
      ['CR002','Weak / Non-Productive','Cull'],
      ['CR003','Deformed Bird',        'Cull'],
      ['CR004','Injured Bird',         'Both'],
      ['CR005','Excess Male',          'Cull'],
      ['CR006','Management Decision',  'Cull'],
    ];
    for (const [rid,name,mod] of reasons) {
      await client.query(`
        INSERT INTO mortality_cull_reason_master (reason_id,reason_name,module,created_by)
        VALUES ($1,$2,$3,'system') ON CONFLICT DO NOTHING
      `,[rid,name,mod]);
    }
    console.log('  ✔ Seeded: mortality_cull_reason_master (14 reasons)');

    // Bird grading sample
    await client.query(`
      INSERT INTO bird_grading_master (doc_no,doc_date,start_date,end_date,age_in_weeks,created_by)
      VALUES ('BG001',CURRENT_DATE,CURRENT_DATE,CURRENT_DATE+365,20,'system') ON CONFLICT DO NOTHING
    `);
    console.log('  ✔ Seeded: bird_grading_master');

    // Egg grading sample
    const grades = [
      ['EG001','Grade A','GA'],['EG002','Grade B','GB'],['EG003','Grade C','GC'],
      ['EG004','Jumbo','JB'],  ['EG005','Small','SM'],  ['EG006','Crack','CR'],
      ['EG007','Dirty','DT'],  ['EG008','Reject','RJ'],
    ];
    for (const [gid,name,code] of grades) {
      await client.query(`
        INSERT INTO egg_grading_master (grading_id,grading_name,short_code,created_by)
        VALUES ($1,$2,$3,'system') ON CONFLICT DO NOTHING
      `,[gid,name,code]);
    }
    console.log('  ✔ Seeded: egg_grading_master (8 grades)');

    await client.query('COMMIT');
    console.log(`
✅ New Masters Migration Complete!
  Tables: standard_weight_header, standard_weight_detail,
          mortality_cull_reason_master, bird_grading_master, egg_grading_master
  Run: npm run migrate:masters:new`);
  } catch(err) {
    await client.query('ROLLBACK');
    console.error('Error:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}
run();
