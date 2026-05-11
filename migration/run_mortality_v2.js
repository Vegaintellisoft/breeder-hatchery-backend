require('dotenv').config();
const pool = require('../src/config/db');

async function run() {
  const client = await pool.connect();
  try {
    console.log('\n🚀 Running Mortality & Cull Kill V2 Migration...\n');
    await client.query('BEGIN');

    // ── SHED MASTER ───────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS shed_master (
        id         SERIAL PRIMARY KEY,
        plant_code VARCHAR(20) NOT NULL,
        shed_no    VARCHAR(50) NOT NULL,
        shed_name  VARCHAR(100),
        is_active  BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE (plant_code, shed_no)
      );
    `);
    console.log('  ✔ Table: shed_master');

    // ── SHED PART/ROW MASTER ──────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS shed_part_master (
        id          SERIAL PRIMARY KEY,
        shed_id     INT NOT NULL REFERENCES shed_master(id) ON DELETE CASCADE,
        part_row_no VARCHAR(50) NOT NULL,
        cum_birds   INT DEFAULT 0,
        is_active   BOOLEAN DEFAULT TRUE,
        created_at  TIMESTAMP DEFAULT NOW(),
        UNIQUE (shed_id, part_row_no)
      );
    `);
    console.log('  ✔ Table: shed_part_master');

    // ── LINE MASTER ───────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS shed_line_master (
        id           SERIAL PRIMARY KEY,
        part_id      INT NOT NULL REFERENCES shed_part_master(id) ON DELETE CASCADE,
        line_no      VARCHAR(50) NOT NULL,
        total_male   INT DEFAULT 0,
        total_female INT DEFAULT 0,
        is_active    BOOLEAN DEFAULT TRUE,
        created_at   TIMESTAMP DEFAULT NOW(),
        UNIQUE (part_id, line_no)
      );
    `);
    console.log('  ✔ Table: shed_line_master');

    // ── MORTALITY REASON MASTER ───────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS mortality_reason_master (
        id          SERIAL PRIMARY KEY,
        reason_name VARCHAR(100) NOT NULL,
        is_active   BOOLEAN DEFAULT TRUE,
        created_at  TIMESTAMP DEFAULT NOW(),
        updated_at  TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('  ✔ Table: mortality_reason_master');

    // ── CULL KILL REASON MASTER ───────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS cull_kill_reason_master (
        id          SERIAL PRIMARY KEY,
        reason_name VARCHAR(100) NOT NULL,
        is_active   BOOLEAN DEFAULT TRUE,
        created_at  TIMESTAMP DEFAULT NOW(),
        updated_at  TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('  ✔ Table: cull_kill_reason_master');

    // ── MORTALITY PHOTO TYPE MASTER ───────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS mortality_photo_type (
        id          SERIAL PRIMARY KEY,
        type_name   VARCHAR(100) NOT NULL,
        is_multiple BOOLEAN DEFAULT TRUE,
        is_active   BOOLEAN DEFAULT TRUE,
        sort_order  INT DEFAULT 0,
        created_at  TIMESTAMP DEFAULT NOW(),
        updated_at  TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('  ✔ Table: mortality_photo_type');

    // ── CULL KILL PHOTO TYPE MASTER ───────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS cull_kill_photo_type (
        id          SERIAL PRIMARY KEY,
        type_name   VARCHAR(100) NOT NULL,
        is_multiple BOOLEAN DEFAULT TRUE,
        is_active   BOOLEAN DEFAULT TRUE,
        sort_order  INT DEFAULT 0,
        created_at  TIMESTAMP DEFAULT NOW(),
        updated_at  TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('  ✔ Table: cull_kill_photo_type');

    // ── MORTALITY LOG ─────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS mortality_log (
        id               SERIAL PRIMARY KEY,
        flock_no         VARCHAR(20) NOT NULL,
        plant_code       VARCHAR(20) NOT NULL,
        shed_id          INT REFERENCES shed_master(id),
        part_id          INT REFERENCES shed_part_master(id),
        line_id          INT REFERENCES shed_line_master(id),
        entry_date       DATE NOT NULL DEFAULT CURRENT_DATE,
        cum_birds        INT DEFAULT 0,
        total_male       INT DEFAULT 0,
        total_female     INT DEFAULT 0,
        morning_male     INT DEFAULT 0,
        morning_female   INT DEFAULT 0,
        morning_qty      INT DEFAULT 0,
        afternoon_male   INT DEFAULT 0,
        afternoon_female INT DEFAULT 0,
        afternoon_qty    INT DEFAULT 0,
        evening_male     INT DEFAULT 0,
        evening_female   INT DEFAULT 0,
        evening_qty      INT DEFAULT 0,
        total_male_count   INT DEFAULT 0,
        total_female_count INT DEFAULT 0,
        total_qty          INT DEFAULT 0,
        entered_by       INT REFERENCES admin(id),
        created_at       TIMESTAMP DEFAULT NOW(),
        updated_at       TIMESTAMP DEFAULT NOW(),
        UNIQUE (flock_no, shed_id, part_id, line_id, entry_date)
      );
    `);
    console.log('  ✔ Table: mortality_log');

    // ── MORTALITY REASON LOG ──────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS mortality_reason_log (
        id           SERIAL PRIMARY KEY,
        mortality_id INT NOT NULL REFERENCES mortality_log(id) ON DELETE CASCADE,
        reason_id    INT REFERENCES mortality_reason_master(id),
        reason_name  VARCHAR(100),
        male_count   INT DEFAULT 0,
        female_count INT DEFAULT 0,
        total_count  INT DEFAULT 0,
        remarks      TEXT,
        created_at   TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('  ✔ Table: mortality_reason_log');

    // ── MORTALITY PHOTO LOG ───────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS mortality_photo_log (
        id            SERIAL PRIMARY KEY,
        mortality_id  INT NOT NULL REFERENCES mortality_log(id) ON DELETE CASCADE,
        photo_type_id INT REFERENCES mortality_photo_type(id),
        type_name     VARCHAR(100),
        image_path    VARCHAR(500) NOT NULL,
        created_at    TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('  ✔ Table: mortality_photo_log');

    // ── CULL KILL LOG ─────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS cull_kill_log (
        id               SERIAL PRIMARY KEY,
        flock_no         VARCHAR(20) NOT NULL,
        plant_code       VARCHAR(20) NOT NULL,
        shed_id          INT REFERENCES shed_master(id),
        part_id          INT REFERENCES shed_part_master(id),
        line_id          INT REFERENCES shed_line_master(id),
        entry_date       DATE NOT NULL DEFAULT CURRENT_DATE,
        cum_birds        INT DEFAULT 0,
        total_male       INT DEFAULT 0,
        total_female     INT DEFAULT 0,
        morning_male     INT DEFAULT 0,
        morning_female   INT DEFAULT 0,
        morning_qty      INT DEFAULT 0,
        afternoon_male   INT DEFAULT 0,
        afternoon_female INT DEFAULT 0,
        afternoon_qty    INT DEFAULT 0,
        evening_male     INT DEFAULT 0,
        evening_female   INT DEFAULT 0,
        evening_qty      INT DEFAULT 0,
        total_male_count   INT DEFAULT 0,
        total_female_count INT DEFAULT 0,
        total_qty          INT DEFAULT 0,
        entered_by       INT REFERENCES admin(id),
        created_at       TIMESTAMP DEFAULT NOW(),
        updated_at       TIMESTAMP DEFAULT NOW(),
        UNIQUE (flock_no, shed_id, part_id, line_id, entry_date)
      );
    `);
    console.log('  ✔ Table: cull_kill_log');

    // ── CULL KILL REASON LOG ──────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS cull_kill_reason_log (
        id           SERIAL PRIMARY KEY,
        cull_kill_id INT NOT NULL REFERENCES cull_kill_log(id) ON DELETE CASCADE,
        reason_id    INT REFERENCES cull_kill_reason_master(id),
        reason_name  VARCHAR(100),
        male_count   INT DEFAULT 0,
        female_count INT DEFAULT 0,
        total_count  INT DEFAULT 0,
        remarks      TEXT,
        created_at   TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('  ✔ Table: cull_kill_reason_log');

    // ── CULL KILL PHOTO LOG ───────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS cull_kill_photo_log (
        id            SERIAL PRIMARY KEY,
        cull_kill_id  INT NOT NULL REFERENCES cull_kill_log(id) ON DELETE CASCADE,
        photo_type_id INT REFERENCES cull_kill_photo_type(id),
        type_name     VARCHAR(100),
        image_path    VARCHAR(500) NOT NULL,
        created_at    TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('  ✔ Table: cull_kill_photo_log');

    // ── SEED DATA ─────────────────────────────────────────────────────────

    // Sheds
    const sheds = [
      ['1902','SH001','Shed 1'], ['1902','SH002','Shed 2'], ['1902','SH003','Shed 3'],
      ['1903','SH001','Shed 1'], ['1904','SH001','Shed 1'],
    ];
    for (const [pc,sno,sn] of sheds) {
      await client.query(
        `INSERT INTO shed_master (plant_code,shed_no,shed_name) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
        [pc,sno,sn]
      );
    }

    // Parts and lines for plant 1902 sheds
    const shed1Res = await client.query(`SELECT id FROM shed_master WHERE plant_code='1902' AND shed_no='SH001'`);
    const shed2Res = await client.query(`SELECT id FROM shed_master WHERE plant_code='1902' AND shed_no='SH002'`);

    if (shed1Res.rowCount > 0) {
      const s1 = shed1Res.rows[0].id;
      for (const [pno,cum] of [['P1',5000],['P2',4500],['P3',4800]]) {
        const pr = await client.query(
          `INSERT INTO shed_part_master (shed_id,part_row_no,cum_birds) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING id`,
          [s1,pno,cum]
        );
        if (pr.rows[0]) {
          const pid = pr.rows[0].id;
          for (const [lno,tm,tf] of [['L1',500,4500],['L2',480,4300],['L3',490,4400]]) {
            await client.query(
              `INSERT INTO shed_line_master (part_id,line_no,total_male,total_female) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
              [pid,lno,tm,tf]
            );
          }
        }
      }
    }

    if (shed2Res.rowCount > 0) {
      const s2 = shed2Res.rows[0].id;
      const pr = await client.query(
        `INSERT INTO shed_part_master (shed_id,part_row_no,cum_birds) VALUES ($1,'P1',4200) ON CONFLICT DO NOTHING RETURNING id`,
        [s2]
      );
      if (pr.rows[0]) {
        await client.query(
          `INSERT INTO shed_line_master (part_id,line_no,total_male,total_female) VALUES ($1,'L1',400,3800) ON CONFLICT DO NOTHING`,
          [pr.rows[0].id]
        );
      }
    }
    console.log('  ✔ Seeded: sheds, parts, lines');

    // Mortality reasons
    for (const r of ['Disease','Injury','Unknown','Heat Stress','Feed Issue','Water Issue','Predator Attack']) {
      await client.query(`INSERT INTO mortality_reason_master (reason_name) VALUES ($1) ON CONFLICT DO NOTHING`,[r]);
    }
    console.log('  ✔ Seeded: mortality_reason_master');

    // Cull kill reasons
    for (const r of ['Weak Bird','Deformed','Injured','Non-Productive','Disease','Low Weight','Other']) {
      await client.query(`INSERT INTO cull_kill_reason_master (reason_name) VALUES ($1) ON CONFLICT DO NOTHING`,[r]);
    }
    console.log('  ✔ Seeded: cull_kill_reason_master');

    // Mortality photo types
    for (const [n,m,s] of [
      ['Upload Collection Photo',true,1],
      ['Dead Bird Collection BIN',true,2],
      ['Hygiene Dead Bird Disposal',true,3],
      ['Mortality - Dip in MS Solution',true,4],
      ['Mortality PIT - Spray (Fly Control)',true,5],
      ['Mortality PIT - Spray (Odour Control)',true,6],
    ]) {
      await client.query(
        `INSERT INTO mortality_photo_type (type_name,is_multiple,sort_order) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
        [n,m,s]
      );
    }
    console.log('  ✔ Seeded: mortality_photo_type (6 types)');

    // Cull kill photo types
    for (const [n,m,s] of [
      ['Upload Collection Photo',true,1],
      ['Cull Bird Collection BIN',true,2],
      ['Hygiene Cull Bird Disposal',true,3],
      ['Cull - Dip in MS Solution',true,4],
      ['Cull PIT - Spray (Fly Control)',true,5],
      ['Cull PIT - Spray (Odour Control)',true,6],
    ]) {
      await client.query(
        `INSERT INTO cull_kill_photo_type (type_name,is_multiple,sort_order) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
        [n,m,s]
      );
    }
    console.log('  ✔ Seeded: cull_kill_photo_type (6 types)');

    await client.query('COMMIT');
    console.log('\n✅ Migration Complete! Run: npm run migrate:mortality:v2\n');
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
