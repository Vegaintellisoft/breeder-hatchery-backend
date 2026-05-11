require('dotenv').config();
const pool = require('../src/config/db');

async function run() {
  const client = await pool.connect();
  try {
    console.log('\n🚀 Running New Masters Migration...\n');
    await client.query('BEGIN');

    // ── 1. STANDARD WEIGHT MASTER (header) ───────────────────────────────
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
        male_weight   NUMERIC(10,2),
        female_weight NUMERIC(10,2),
        created_at    TIMESTAMP DEFAULT NOW(),
        updated_at    TIMESTAMP DEFAULT NOW(),
        UNIQUE(header_id, age_in_weeks)
      );
    `);
    console.log('  ✔ Table: standard_weight_detail');

    // ── 3. MORTALITY/CULL REASON MASTER (combined) ───────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS mortality_cull_reason_master (
        id          SERIAL PRIMARY KEY,
        reason_id   VARCHAR(50),
        reason_name VARCHAR(200) NOT NULL,
        module      VARCHAR(20) NOT NULL CHECK (module IN ('Mortality','Cull')),
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
        id            SERIAL PRIMARY KEY,
        doc_no        VARCHAR(50) NOT NULL,
        doc_date      DATE,
        start_date    DATE,
        end_date      DATE,
        age_in_weeks  NUMERIC(5,1),
        is_active     BOOLEAN DEFAULT TRUE,
        created_by    VARCHAR(100),
        created_at    TIMESTAMP DEFAULT NOW(),
        updated_at    TIMESTAMP DEFAULT NOW()
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

    // Standard weight — sample header + weeks
    const swh = await client.query(`
      INSERT INTO standard_weight_header (doc_no, doc_date, start_date, end_date, season, remarks, created_by)
      VALUES ('SW001', CURRENT_DATE, CURRENT_DATE, CURRENT_DATE + 365, 'Summer', 'Vencobb 430Y Standard Weights', 'system')
      ON CONFLICT DO NOTHING RETURNING id
    `);
    if (swh.rowCount > 0) {
      const hid = swh.rows[0].id;
      for (const [wk, m, f] of [
        [1,60,58],[2,110,105],[3,175,165],[4,255,240],[5,340,320],
        [6,430,405],[7,520,490],[8,610,575],[10,790,745],[12,970,915],
        [16,1310,1235],[20,1620,1530],[24,1890,1785],[30,2150,2030],
      ]) {
        await client.query(`
          INSERT INTO standard_weight_detail (header_id, age_in_weeks, male_weight, female_weight)
          VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING
        `, [hid, wk, m, f]);
      }
      console.log('  ✔ Seeded: standard_weight_header + 14 week entries');
    }

    // Mortality/Cull reasons (combined)
    for (const [rid, name, module] of [
      ['MR001','Disease / Infection','Mortality'],
      ['MR002','Injury','Mortality'],
      ['MR003','Smothering','Mortality'],
      ['MR004','Prolapse','Mortality'],
      ['MR005','Starvation','Mortality'],
      ['MR006','Unknown / Sudden Death','Mortality'],
      ['MR007','Heat Stress','Mortality'],
      ['MR008','Predator Attack','Mortality'],
      ['CR001','Sick Bird','Cull'],
      ['CR002','Weak / Non-Productive','Cull'],
      ['CR003','Deformed Bird','Cull'],
      ['CR004','Injured Bird','Cull'],
      ['CR005','Excess Male','Cull'],
      ['CR006','Management Decision','Cull'],
    ]) {
      await client.query(`
        INSERT INTO mortality_cull_reason_master (reason_id, reason_name, module, created_by)
        VALUES ($1,$2,$3,'system') ON CONFLICT DO NOTHING
      `, [rid, name, module]);
    }
    console.log('  ✔ Seeded: mortality_cull_reason_master (8 mortality + 6 cull)');

    // Bird grading
    for (const [doc, wk] of [['BG001',8],['BG002',16],['BG003',24],['BG004',30]]) {
      await client.query(`
        INSERT INTO bird_grading_master (doc_no, doc_date, start_date, end_date, age_in_weeks, created_by)
        VALUES ($1, CURRENT_DATE, CURRENT_DATE, CURRENT_DATE+90, $2, 'system') ON CONFLICT DO NOTHING
      `, [doc, wk]);
    }
    console.log('  ✔ Seeded: bird_grading_master (4 records)');

    // Egg grading
    for (const [gid, name, code] of [
      ['EG001','Jumbo','JB'],
      ['EG002','Large','LG'],
      ['EG003','Medium','MD'],
      ['EG004','Small','SM'],
      ['EG005','Crack / Reject','CK'],
      ['EG006','Floor Egg','FL'],
    ]) {
      await client.query(`
        INSERT INTO egg_grading_master (grading_id, grading_name, short_code, created_by)
        VALUES ($1,$2,$3,'system') ON CONFLICT DO NOTHING
      `, [gid, name, code]);
    }
    console.log('  ✔ Seeded: egg_grading_master (6 grades)');

    await client.query('COMMIT');
    console.log(`
✅ New Masters Migration Complete!
  Tables: standard_weight_header, standard_weight_detail,
          mortality_cull_reason_master, bird_grading_master, egg_grading_master
  Run: npm run migrate:new:masters`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}
run();
