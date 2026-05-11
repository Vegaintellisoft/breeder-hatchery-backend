require('dotenv').config();
const pool = require('../src/config/db');

async function run() {
  const client = await pool.connect();
  try {
    console.log('\n🚀 Running Mortality & Cull Kill Masters Migration...\n');
    await client.query('BEGIN');

    await client.query(`CREATE TABLE IF NOT EXISTS shed_master (id SERIAL PRIMARY KEY, plant_code VARCHAR(20) NOT NULL, shed_no VARCHAR(50) NOT NULL, shed_name VARCHAR(100), is_active BOOLEAN DEFAULT TRUE, created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW(), UNIQUE(plant_code, shed_no));`);
    console.log('  ✔ shed_master');

    await client.query(`CREATE TABLE IF NOT EXISTS shed_part_master (id SERIAL PRIMARY KEY, shed_id INT NOT NULL REFERENCES shed_master(id) ON DELETE CASCADE, part_row_no VARCHAR(50) NOT NULL, cum_birds INT DEFAULT 0, is_active BOOLEAN DEFAULT TRUE, created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW(), UNIQUE(shed_id, part_row_no));`);
    console.log('  ✔ shed_part_master');

    await client.query(`CREATE TABLE IF NOT EXISTS shed_line_master (id SERIAL PRIMARY KEY, part_id INT NOT NULL REFERENCES shed_part_master(id) ON DELETE CASCADE, line_no VARCHAR(50) NOT NULL, male_birds INT DEFAULT 0, female_birds INT DEFAULT 0, total_birds INT DEFAULT 0, is_active BOOLEAN DEFAULT TRUE, created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW(), UNIQUE(part_id, line_no));`);
    console.log('  ✔ shed_line_master');

    await client.query(`CREATE TABLE IF NOT EXISTS mortality_reason_master (id SERIAL PRIMARY KEY, reason_code VARCHAR(50), reason_name VARCHAR(200) NOT NULL, is_active BOOLEAN DEFAULT TRUE, created_by VARCHAR(100), created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW());`);
    console.log('  ✔ mortality_reason_master');

    await client.query(`CREATE TABLE IF NOT EXISTS cull_kill_reason_master (id SERIAL PRIMARY KEY, reason_code VARCHAR(50), reason_name VARCHAR(200) NOT NULL, is_active BOOLEAN DEFAULT TRUE, created_by VARCHAR(100), created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW());`);
    console.log('  ✔ cull_kill_reason_master');

    await client.query(`CREATE TABLE IF NOT EXISTS mortality_photo_type_master (id SERIAL PRIMARY KEY, type_code VARCHAR(50), type_name VARCHAR(200) NOT NULL, is_required BOOLEAN DEFAULT FALSE, is_active BOOLEAN DEFAULT TRUE, sort_order INT DEFAULT 0, created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW());`);
    console.log('  ✔ mortality_photo_type_master');

    await client.query(`CREATE TABLE IF NOT EXISTS cull_kill_photo_type_master (id SERIAL PRIMARY KEY, type_code VARCHAR(50), type_name VARCHAR(200) NOT NULL, is_required BOOLEAN DEFAULT FALSE, is_active BOOLEAN DEFAULT TRUE, sort_order INT DEFAULT 0, created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW());`);
    console.log('  ✔ cull_kill_photo_type_master');

    await client.query(`CREATE TABLE IF NOT EXISTS mortality_log (id SERIAL PRIMARY KEY, flock_no VARCHAR(20) NOT NULL, plant_code VARCHAR(20) NOT NULL, shed_id INT REFERENCES shed_master(id), part_id INT REFERENCES shed_part_master(id), line_id INT REFERENCES shed_line_master(id), entry_date DATE NOT NULL DEFAULT CURRENT_DATE, cum_birds INT DEFAULT 0, total_male INT DEFAULT 0, total_female INT DEFAULT 0, morning_male INT DEFAULT 0, morning_female INT DEFAULT 0, morning_qty INT DEFAULT 0, afternoon_male INT DEFAULT 0, afternoon_female INT DEFAULT 0, afternoon_qty INT DEFAULT 0, evening_male INT DEFAULT 0, evening_female INT DEFAULT 0, evening_qty INT DEFAULT 0, total_qty INT DEFAULT 0, entered_by INT REFERENCES admin(id), created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW(), UNIQUE(flock_no, shed_id, part_id, line_id, entry_date));`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_mort_log_flock ON mortality_log(flock_no, entry_date);`);
    console.log('  ✔ mortality_log');

    await client.query(`CREATE TABLE IF NOT EXISTS mortality_reason_log (id SERIAL PRIMARY KEY, mortality_id INT NOT NULL REFERENCES mortality_log(id) ON DELETE CASCADE, reason_id INT REFERENCES mortality_reason_master(id), reason_name VARCHAR(200), male_count INT DEFAULT 0, female_count INT DEFAULT 0, total_count INT DEFAULT 0, remarks TEXT, created_at TIMESTAMP DEFAULT NOW());`);
    console.log('  ✔ mortality_reason_log');

    await client.query(`CREATE TABLE IF NOT EXISTS mortality_photo_log (id SERIAL PRIMARY KEY, mortality_id INT NOT NULL REFERENCES mortality_log(id) ON DELETE CASCADE, photo_type_id INT REFERENCES mortality_photo_type_master(id), photo_type_name VARCHAR(200), image_path VARCHAR(500) NOT NULL, created_at TIMESTAMP DEFAULT NOW());`);
    console.log('  ✔ mortality_photo_log');

    await client.query(`CREATE TABLE IF NOT EXISTS cull_kill_log (id SERIAL PRIMARY KEY, flock_no VARCHAR(20) NOT NULL, plant_code VARCHAR(20) NOT NULL, shed_id INT REFERENCES shed_master(id), part_id INT REFERENCES shed_part_master(id), line_id INT REFERENCES shed_line_master(id), entry_date DATE NOT NULL DEFAULT CURRENT_DATE, cum_birds INT DEFAULT 0, total_male INT DEFAULT 0, total_female INT DEFAULT 0, morning_male INT DEFAULT 0, morning_female INT DEFAULT 0, morning_qty INT DEFAULT 0, afternoon_male INT DEFAULT 0, afternoon_female INT DEFAULT 0, afternoon_qty INT DEFAULT 0, evening_male INT DEFAULT 0, evening_female INT DEFAULT 0, evening_qty INT DEFAULT 0, total_qty INT DEFAULT 0, entered_by INT REFERENCES admin(id), created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW(), UNIQUE(flock_no, shed_id, part_id, line_id, entry_date));`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_cull_log_flock ON cull_kill_log(flock_no, entry_date);`);
    console.log('  ✔ cull_kill_log');

    await client.query(`CREATE TABLE IF NOT EXISTS cull_kill_reason_log (id SERIAL PRIMARY KEY, cull_kill_id INT NOT NULL REFERENCES cull_kill_log(id) ON DELETE CASCADE, reason_id INT REFERENCES cull_kill_reason_master(id), reason_name VARCHAR(200), male_count INT DEFAULT 0, female_count INT DEFAULT 0, total_count INT DEFAULT 0, remarks TEXT, created_at TIMESTAMP DEFAULT NOW());`);
    console.log('  ✔ cull_kill_reason_log');

    await client.query(`CREATE TABLE IF NOT EXISTS cull_kill_photo_log (id SERIAL PRIMARY KEY, cull_kill_id INT NOT NULL REFERENCES cull_kill_log(id) ON DELETE CASCADE, photo_type_id INT REFERENCES cull_kill_photo_type_master(id), photo_type_name VARCHAR(200), image_path VARCHAR(500) NOT NULL, created_at TIMESTAMP DEFAULT NOW());`);
    console.log('  ✔ cull_kill_photo_log');

    // Seed sheds
    for (const [p,s,n] of [['1902','SH-01','Shed 1'],['1902','SH-02','Shed 2'],['1902','SH-03','Shed 3'],['1903','SH-01','Shed 1'],['1903','SH-02','Shed 2'],['1904','SH-01','Shed 1']]) {
      await client.query(`INSERT INTO shed_master (plant_code,shed_no,shed_name) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,[p,s,n]);
    }

    // Parts + Lines for 1902 SH-01
    const s1 = await client.query(`SELECT id FROM shed_master WHERE plant_code='1902' AND shed_no='SH-01'`);
    if (s1.rowCount > 0) {
      for (const [part,cum] of [['P1',9436],['P2',8500],['P3',7200]]) {
        const pr = await client.query(`INSERT INTO shed_part_master (shed_id,part_row_no,cum_birds) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING id`,[s1.rows[0].id,part,cum]);
        if (pr.rowCount > 0) {
          await client.query(`INSERT INTO shed_line_master (part_id,line_no,male_birds,female_birds,total_birds) VALUES ($1,'L1',98,942,1040),($1,'L2',97,940,1037) ON CONFLICT DO NOTHING`,[pr.rows[0].id]);
        }
      }
    }
    const s2 = await client.query(`SELECT id FROM shed_master WHERE plant_code='1902' AND shed_no='SH-02'`);
    if (s2.rowCount > 0) {
      const pr = await client.query(`INSERT INTO shed_part_master (shed_id,part_row_no,cum_birds) VALUES ($1,'P1',8000) ON CONFLICT DO NOTHING RETURNING id`,[s2.rows[0].id]);
      if (pr.rowCount > 0) await client.query(`INSERT INTO shed_line_master (part_id,line_no,male_birds,female_birds,total_birds) VALUES ($1,'L1',90,910,1000) ON CONFLICT DO NOTHING`,[pr.rows[0].id]);
    }
    console.log('  ✔ Seeded: sheds, parts, lines');

    // Mortality reasons
    for (const [c,n] of [['MR001','Disease / Infection'],['MR002','Injury'],['MR003','Smothering'],['MR004','Prolapse'],['MR005','Starvation'],['MR006','Unknown / Sudden Death'],['MR007','Heat Stress'],['MR008','Predator Attack']]) {
      await client.query(`INSERT INTO mortality_reason_master (reason_code,reason_name,created_by) VALUES ($1,$2,'system') ON CONFLICT DO NOTHING`,[c,n]);
    }
    console.log('  ✔ Seeded: mortality reasons (8)');

    // Cull reasons
    for (const [c,n] of [['CR001','Sick Bird'],['CR002','Weak / Non-Productive'],['CR003','Deformed Bird'],['CR004','Injured Bird'],['CR005','Excess Male'],['CR006','Management Decision']]) {
      await client.query(`INSERT INTO cull_kill_reason_master (reason_code,reason_name,created_by) VALUES ($1,$2,'system') ON CONFLICT DO NOTHING`,[c,n]);
    }
    console.log('  ✔ Seeded: cull kill reasons (6)');

    // Mortality photo types
    for (const [c,n,s] of [['MPT001','Upload Collection Photo',1],['MPT002','Dead Bird Collection BIN',2],['MPT003','Hygiene Dead Bird Disposal',3],['MPT004','Mortality - Dip in MS Solution',4],['MPT005','Mortality PIT - Spray (Fly Control)',5],['MPT006','Mortality PIT - Spray (Odour Control)',6]]) {
      await client.query(`INSERT INTO mortality_photo_type_master (type_code,type_name,sort_order) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,[c,n,s]);
    }
    console.log('  ✔ Seeded: mortality photo types (6)');

    // Cull photo types
    for (const [c,n,s] of [['CPT001','Upload Collection Photo',1],['CPT002','Cull Bird Collection BIN',2],['CPT003','Hygiene Cull Bird Disposal',3],['CPT004','Cull Kill - Dip in MS Solution',4],['CPT005','Cull PIT - Spray (Fly Control)',5],['CPT006','Cull PIT - Spray (Odour Control)',6]]) {
      await client.query(`INSERT INTO cull_kill_photo_type_master (type_code,type_name,sort_order) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,[c,n,s]);
    }
    console.log('  ✔ Seeded: cull kill photo types (6)');

    await client.query('COMMIT');
    console.log('\n✅ Migration Complete! 13 tables created + all masters seeded');
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
