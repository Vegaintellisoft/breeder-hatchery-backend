require('dotenv').config();
const pool = require('../src/config/db');

async function run() {
  const client = await pool.connect();
  try {
    console.log('\n🚀 Running Cull Sales Migration...\n');
    await client.query('BEGIN');

    // ── CULL SALES HEADER ─────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS cull_sales_header (
        id              SERIAL PRIMARY KEY,
        flock_no        VARCHAR(20) NOT NULL,
        plant_code      VARCHAR(20) NOT NULL,
        entry_date      DATE NOT NULL DEFAULT CURRENT_DATE,
        -- Step 1
        shed_id         INT REFERENCES shed_master(id),
        part_id         INT REFERENCES shed_part_master(id),
        line_id         INT REFERENCES shed_line_master(id),
        batch_no        VARCHAR(50),
        age             VARCHAR(50),
        bird_stock      INT DEFAULT 0,
        -- Step 2
        customer_type   VARCHAR(100),
        dc_no           VARCHAR(50),
        customer        VARCHAR(200),
        sales_type      VARCHAR(100),
        transport_by    VARCHAR(200),
        vehicle_no      VARCHAR(100),
        driver_name     VARCHAR(200),
        driver_mobile   VARCHAR(20),
        order_by        VARCHAR(200),
        dispatched_by   VARCHAR(200),
        -- Step 3 Rate Details
        rate            NUMERIC(10,2) DEFAULT 0,
        net_weight_male   NUMERIC(10,3) DEFAULT 0,
        net_weight_female NUMERIC(10,3) DEFAULT 0,
        avg_weight_male   NUMERIC(10,3) DEFAULT 0,
        avg_weight_female NUMERIC(10,3) DEFAULT 0,
        bill_value      NUMERIC(12,2) DEFAULT 0,
        -- Bill
        bill_no         VARCHAR(50),
        status          VARCHAR(20) DEFAULT 'pending',
        remarks         TEXT,
        entered_by      INT REFERENCES admin(id),
        created_at      TIMESTAMP DEFAULT NOW(),
        updated_at      TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_cs_flock ON cull_sales_header(flock_no, entry_date);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_cs_plant ON cull_sales_header(plant_code);`);
    console.log('  ✔ Table: cull_sales_header');

    // ── CULL SALES LOAD DETAILS (cage entries grid) ───────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS cull_sales_load_detail (
        id              SERIAL PRIMARY KEY,
        cull_sales_id   INT NOT NULL REFERENCES cull_sales_header(id) ON DELETE CASCADE,
        s_no            INT,
        cage_no         VARCHAR(50),
        empty_weight    NUMERIC(10,3) DEFAULT 0,
        birds_male      INT DEFAULT 0,
        birds_female    INT DEFAULT 0,
        load_weight     NUMERIC(10,3) DEFAULT 0,
        net_weight      NUMERIC(10,3) DEFAULT 0,
        created_at      TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('  ✔ Table: cull_sales_load_detail');

    await client.query('COMMIT');
    console.log('\n✅ Cull Sales Migration Complete!\n  Run: npm run migrate:cull:sales');
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
// Already complete
