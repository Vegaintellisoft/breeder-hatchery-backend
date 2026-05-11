require('dotenv').config();
const pool = require('../src/config/db');

async function run() {
  const client = await pool.connect();
  try {
    console.log('\n🚀 Running Breeder Supply Migration...\n');
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS breeder_supply (
        id              SERIAL PRIMARY KEY,
        date            DATE,
        customer_type   VARCHAR(100),
        dc_no           VARCHAR(50),
        sales_type      VARCHAR(100),
        vehicle_no      VARCHAR(100),
        farmer          VARCHAR(100),
        plant_code      VARCHAR(20),
        flock_no        VARCHAR(20),
        line_no         VARCHAR(50),
        farm_shed_no    VARCHAR(100),
        batch_no        VARCHAR(50),
        age             VARCHAR(50),
        bird_stock      INTEGER,
        excess          INTEGER DEFAULT 0,
        shortage        INTEGER DEFAULT 0,
        bird_quantity   INTEGER,
        rate            NUMERIC(10,2),
        empty_weight    NUMERIC(10,2),
        load_weight     NUMERIC(10,2),
        weight          NUMERIC(10,2),
        amt_weight      NUMERIC(10,2),
        cross_value     NUMERIC(10,2),
        bill_value      NUMERIC(10,2),
        remarks         TEXT,
        status          VARCHAR(20) DEFAULT 'pending',
        created_by      VARCHAR(100),
        created_at      TIMESTAMP DEFAULT NOW(),
        updated_at      TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_bs_plant_code ON breeder_supply(plant_code);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_bs_flock_no   ON breeder_supply(flock_no);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_bs_date       ON breeder_supply(date);`);
    console.log('  ✔ Table: breeder_supply');

    await client.query('COMMIT');
    console.log('\n✅ Breeder Supply Migration Complete!\n  Run: npm run migrate:breeder:supply');
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
