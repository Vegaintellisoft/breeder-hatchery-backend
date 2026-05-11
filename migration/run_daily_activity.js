require('dotenv').config();
const pool = require('../src/config/db');

async function run() {
  const client = await pool.connect();
  try {
    console.log('\n🚀 Running Daily Activity Masters Migration...\n');
    await client.query('BEGIN');

    // ── 1. FEED MASTER ────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS feed_master (
        id          SERIAL PRIMARY KEY,
        mat_id      VARCHAR(50),
        item_name   VARCHAR(200) NOT NULL,
        uom         VARCHAR(20) DEFAULT 'Kg'
                    CHECK (uom IN ('Kg','Mt','Lit','Bags','Nos')),
        module      TEXT[] DEFAULT ARRAY['Breeder'],
        is_active   BOOLEAN DEFAULT TRUE,
        created_by  VARCHAR(100),
        created_at  TIMESTAMP DEFAULT NOW(),
        updated_by  VARCHAR(100),
        updated_at  TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('  ✔ Table: feed_master');

    // ── 2. WATER MASTER ───────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS water_master (
        id          SERIAL PRIMARY KEY,
        water_id    VARCHAR(50),
        item_name   VARCHAR(200) NOT NULL,
        uom         VARCHAR(20) DEFAULT 'Lit',
        is_active   BOOLEAN DEFAULT TRUE,
        created_by  VARCHAR(100),
        created_at  TIMESTAMP DEFAULT NOW(),
        updated_by  VARCHAR(100),
        updated_at  TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('  ✔ Table: water_master');

    // ── 3. MEDICINE MASTER ────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS medicine_master (
        id          SERIAL PRIMARY KEY,
        medicine_id VARCHAR(50),
        item_name   VARCHAR(200) NOT NULL,
        uom         VARCHAR(20) DEFAULT 'Nos',
        module      TEXT[] DEFAULT ARRAY['Breeder'],
        is_active   BOOLEAN DEFAULT TRUE,
        created_by  VARCHAR(100),
        created_at  TIMESTAMP DEFAULT NOW(),
        updated_by  VARCHAR(100),
        updated_at  TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('  ✔ Table: medicine_master');

    // ── 4. OTHERS MASTER ──────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS others_master (
        id          SERIAL PRIMARY KEY,
        others_id   VARCHAR(50),
        item_name   VARCHAR(200) NOT NULL,
        uom         VARCHAR(20) DEFAULT 'Kg',
        is_active   BOOLEAN DEFAULT TRUE,
        created_by  VARCHAR(100),
        created_at  TIMESTAMP DEFAULT NOW(),
        updated_by  VARCHAR(100),
        updated_at  TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('  ✔ Table: others_master');

    // ── 5. STOCK MASTER (comes from SAP — for now manual) ─────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS stock_master (
        id          SERIAL PRIMARY KEY,
        plant_code  VARCHAR(20) NOT NULL,
        item_type   VARCHAR(20) NOT NULL
                    CHECK (item_type IN ('feed','water','medicine','others')),
        item_id     INT NOT NULL,
        item_name   VARCHAR(200),
        uom         VARCHAR(20),
        stock_qty   NUMERIC(12,3) DEFAULT 0,
        cum_qty     NUMERIC(12,3) DEFAULT 0,
        stock_date  DATE DEFAULT CURRENT_DATE,
        source      VARCHAR(20) DEFAULT 'MANUAL',
        created_at  TIMESTAMP DEFAULT NOW(),
        updated_at  TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_stock_plant      ON stock_master(plant_code);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_stock_item_type  ON stock_master(item_type, item_id);`);
    console.log('  ✔ Table: stock_master');

    // ── 6. FLOCK DAILY ACTIVITY (Screen 2 popup data) ─────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS flock_daily_activity (
        id            SERIAL PRIMARY KEY,
        flock_no      VARCHAR(20) NOT NULL,
        plant_code    VARCHAR(20) NOT NULL,
        activity_date DATE NOT NULL DEFAULT CURRENT_DATE,
        stage         VARCHAR(50),
        age_days      INT,
        male_count    INT DEFAULT 0,
        female_count  INT DEFAULT 0,
        mortality     INT DEFAULT 0,
        cull_kill     INT DEFAULT 0,
        cull_sales    INT DEFAULT 0,
        bird_sales    INT DEFAULT 0,
        egg_collection INT DEFAULT 0,
        entered_by    INT REFERENCES admin(id),
        created_at    TIMESTAMP DEFAULT NOW(),
        updated_at    TIMESTAMP DEFAULT NOW(),
        UNIQUE (flock_no, activity_date)
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_fda_flock_date ON flock_daily_activity(flock_no, activity_date);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_fda_plant      ON flock_daily_activity(plant_code, activity_date);`);
    console.log('  ✔ Table: flock_daily_activity');

    // ── 7. FLOCK FEEDING LOG ──────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS flock_feeding_log (
        id              SERIAL PRIMARY KEY,
        flock_no        VARCHAR(20) NOT NULL,
        plant_code      VARCHAR(20) NOT NULL,
        feed_date       DATE NOT NULL DEFAULT CURRENT_DATE,
        feed_type       VARCHAR(20) NOT NULL
                        CHECK (feed_type IN ('feed','water','medicine','others')),
        item_id         INT NOT NULL,
        item_name       VARCHAR(200),
        uom             VARCHAR(20),
        qty_issued_male   NUMERIC(12,3) DEFAULT 0,
        qty_issued_female NUMERIC(12,3) DEFAULT 0,
        stock_in_bags   NUMERIC(12,3) DEFAULT 0,
        cum_feed        NUMERIC(12,3) DEFAULT 0,
        entered_by      INT REFERENCES admin(id),
        created_at      TIMESTAMP DEFAULT NOW(),
        updated_at      TIMESTAMP DEFAULT NOW(),
        UNIQUE (flock_no, feed_date, feed_type, item_id)
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ffl_flock_date ON flock_feeding_log(flock_no, feed_date);`);
    console.log('  ✔ Table: flock_feeding_log');

    // ── 8. FLOCK BIRD WEIGHT LOG ──────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS flock_bird_weight (
        id            SERIAL PRIMARY KEY,
        flock_no      VARCHAR(20) NOT NULL,
        plant_code    VARCHAR(20) NOT NULL,
        weight_date   DATE NOT NULL DEFAULT CURRENT_DATE,
        male_weight   NUMERIC(8,3),
        female_weight NUMERIC(8,3),
        entered_by    INT REFERENCES admin(id),
        created_at    TIMESTAMP DEFAULT NOW(),
        updated_at    TIMESTAMP DEFAULT NOW(),
        UNIQUE (flock_no, weight_date)
      );
    `);
    console.log('  ✔ Table: flock_bird_weight');

    // ── 9. SEED SAMPLE DATA ───────────────────────────────────────────────
    // Feed items
    const feedItems = [
      ['FD001', 'Broiler Breeder Chick Crumbles', 'Bags', ['Broiler','Breeder']],
      ['FD002', 'Pre-Layer Mash',                 'Bags', ['Breeder']],
      ['FD003', 'Layer Breeder Pellet',            'Bags', ['Breeder']],
      ['FD004', 'Broiler Breeder Grower Mash',     'Bags', ['Broiler','Breeder']],
      ['FD005', 'Limestone Grit',                  'Kg',   ['Breeder']],
      ['FD006', 'Oyster Shell',                    'Kg',   ['Breeder']],
    ];
    for (const [matId, name, uom, mod] of feedItems) {
      await client.query(`
        INSERT INTO feed_master (mat_id, item_name, uom, module, created_by)
        VALUES ($1,$2,$3,$4,'system') ON CONFLICT DO NOTHING
      `, [matId, name, uom, mod]);
    }
    console.log('  ✔ Seeded: 6 feed items');

    // Water items
    const waterItems = [
      ['WT001', 'Drinking Water',           'Lit'],
      ['WT002', 'Sanitized Water',          'Lit'],
      ['WT003', 'Water Acidifier Solution', 'Lit'],
    ];
    for (const [waterId, name, uom] of waterItems) {
      await client.query(`
        INSERT INTO water_master (water_id, item_name, uom, created_by)
        VALUES ($1,$2,$3,'system') ON CONFLICT DO NOTHING
      `, [waterId, name, uom]);
    }
    console.log('  ✔ Seeded: 3 water items');

    // Medicine items
    const medItems = [
      ['MD001', 'Antibiotic - Amoxicillin',  'Nos', ['Breeder']],
      ['MD002', 'Vitamin Supplement',         'Nos', ['Broiler','Breeder']],
      ['MD003', 'Electrolyte Powder',         'Nos', ['Broiler','Breeder']],
      ['MD004', 'Deworming Medicine',         'Nos', ['Breeder']],
      ['MD005', 'Coccidiosis Treatment',      'Nos', ['Breeder']],
    ];
    for (const [medId, name, uom, mod] of medItems) {
      await client.query(`
        INSERT INTO medicine_master (medicine_id, item_name, uom, module, created_by)
        VALUES ($1,$2,$3,$4,'system') ON CONFLICT DO NOTHING
      `, [medId, name, uom, mod]);
    }
    console.log('  ✔ Seeded: 5 medicine items');

    // Others items
    const otherItems = [
      ['OT001', 'Litter Material - Rice Husk', 'Kg'],
      ['OT002', 'Lime Powder',                 'Kg'],
      ['OT003', 'Disinfectant - Virkon',        'Lit'],
      ['OT004', 'Fumigation Chemical',          'Lit'],
      ['OT005', 'Rodenticide',                  'Nos'],
    ];
    for (const [othersId, name, uom] of otherItems) {
      await client.query(`
        INSERT INTO others_master (others_id, item_name, uom, created_by)
        VALUES ($1,$2,$3,'system') ON CONFLICT DO NOTHING
      `, [othersId, name, uom]);
    }
    console.log('  ✔ Seeded: 5 others items');

    // ── 10. SEED STOCK MASTER for plant 1902 ─────────────────────────────
    await client.query(`
      INSERT INTO stock_master (plant_code, item_type, item_id, item_name, uom, stock_qty, cum_qty)
      SELECT '1902', 'feed', id, item_name, uom, 500, 1500
      FROM feed_master WHERE is_active = TRUE
      ON CONFLICT DO NOTHING
    `);
    await client.query(`
      INSERT INTO stock_master (plant_code, item_type, item_id, item_name, uom, stock_qty, cum_qty)
      SELECT '1902', 'water', id, item_name, uom, 10000, 50000
      FROM water_master WHERE is_active = TRUE
      ON CONFLICT DO NOTHING
    `);
    await client.query(`
      INSERT INTO stock_master (plant_code, item_type, item_id, item_name, uom, stock_qty, cum_qty)
      SELECT '1902', 'medicine', id, item_name, uom, 100, 500
      FROM medicine_master WHERE is_active = TRUE
      ON CONFLICT DO NOTHING
    `);
    await client.query(`
      INSERT INTO stock_master (plant_code, item_type, item_id, item_name, uom, stock_qty, cum_qty)
      SELECT '1902', 'others', id, item_name, uom, 200, 800
      FROM others_master WHERE is_active = TRUE
      ON CONFLICT DO NOTHING
    `);
    console.log('  ✔ Seeded: stock_master for plant 1902 (feed, water, medicine, others)');

    await client.query('COMMIT');
    console.log(`
✅ Daily Activity Masters Migration Complete!
──────────────────────────────────────────────────────────
  Tables created:
    feed_master, water_master, medicine_master, others_master
    stock_master, flock_daily_activity
    flock_feeding_log, flock_bird_weight
──────────────────────────────────────────────────────────
  Run: npm run migrate:daily:activity`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration error:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}
run();
