/**
 * Cull Sales Dropdown Masters Migration
 * Creates all dropdown tables for the cull sales Step 2 screen:
 *   - customer_type_master   → Customer Type dropdown
 *   - cull_customer_master   → Customer dropdown  
 *   - sales_type_master      → Sales Type dropdown
 *   - transport_type_master  → Transport By dropdown
 *   - cull_sales_emp_master  → Order By & Dispatched By dropdowns
 *
 * Run: npm run migrate:cull:dropdowns
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../src/config/db');

async function run() {
  const client = await pool.connect();
  try {
    console.log('\n🚀 Cull Sales Dropdown Masters Migration...\n');
    await client.query('BEGIN');

    // 1. Customer Type  (e.g. Regular, Wholesale, Retail, Institutional)
    await client.query(`
      CREATE TABLE IF NOT EXISTS customer_type_master (
        id          SERIAL PRIMARY KEY,
        type_name   VARCHAR(100) NOT NULL UNIQUE,
        is_active   BOOLEAN DEFAULT TRUE,
        created_at  TIMESTAMP DEFAULT NOW(),
        updated_at  TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`
      INSERT INTO customer_type_master (type_name) VALUES
        ('Regular'), ('Wholesale'), ('Retail'), ('Institutional'), ('Export')
      ON CONFLICT (type_name) DO NOTHING
    `);
    console.log('  ✔ customer_type_master (5 defaults seeded)');

    // 2. Customer Master  (customer code + name, linked to plant)
    await client.query(`
      CREATE TABLE IF NOT EXISTS cull_customer_master (
        id            SERIAL PRIMARY KEY,
        plant_code    VARCHAR(20),
        customer_code VARCHAR(50),
        customer_name VARCHAR(200) NOT NULL,
        address       TEXT,
        mobile        VARCHAR(20),
        is_active     BOOLEAN DEFAULT TRUE,
        created_at    TIMESTAMP DEFAULT NOW(),
        updated_at    TIMESTAMP DEFAULT NOW(),
        UNIQUE (plant_code, customer_code)
      )
    `);
    await client.query(`
      INSERT INTO cull_customer_master (plant_code, customer_code, customer_name) VALUES
        ('1902', 'CUST001', 'VIYAAN ENTERPRISE'),
        ('1902', 'CUST002', 'RAJA POULTRY WORKS'),
        ('1902', 'CUST003', 'KUMAR TRADERS'),
        ('1903', 'CUST001', 'SRI BALAJI TRADERS'),
        ('1904', 'CUST001', 'ANNAMALAI POULTRY')
      ON CONFLICT (plant_code, customer_code) DO NOTHING
    `);
    console.log('  ✔ cull_customer_master (5 defaults seeded)');

    // 3. Sales Type  (e.g. Live Bird, Dressed, Farm Gate)
    await client.query(`
      CREATE TABLE IF NOT EXISTS sales_type_master (
        id          SERIAL PRIMARY KEY,
        type_name   VARCHAR(100) NOT NULL UNIQUE,
        is_active   BOOLEAN DEFAULT TRUE,
        created_at  TIMESTAMP DEFAULT NOW(),
        updated_at  TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`
      INSERT INTO sales_type_master (type_name) VALUES
        ('Live Bird'), ('Dressed Bird'), ('Farm Gate'), ('Market Sale'), ('Contract Sale')
      ON CONFLICT (type_name) DO NOTHING
    `);
    console.log('  ✔ sales_type_master (5 defaults seeded)');

    // 4. Transport Type  (e.g. Own, Hired, Customer Arranged)
    await client.query(`
      CREATE TABLE IF NOT EXISTS transport_type_master (
        id             SERIAL PRIMARY KEY,
        transport_name VARCHAR(100) NOT NULL UNIQUE,
        is_active      BOOLEAN DEFAULT TRUE,
        created_at     TIMESTAMP DEFAULT NOW(),
        updated_at     TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`
      INSERT INTO transport_type_master (transport_name) VALUES
        ('Own Vehicle'), ('Hired Vehicle'), ('Customer Arranged'), ('Company Vehicle'), ('Third Party')
      ON CONFLICT (transport_name) DO NOTHING
    `);
    console.log('  ✔ transport_type_master (5 defaults seeded)');

    // 5. Employee Master  (Order By + Dispatched By — same table, role differentiates)
    await client.query(`
      CREATE TABLE IF NOT EXISTS cull_sales_emp_master (
        id          SERIAL PRIMARY KEY,
        plant_code  VARCHAR(20),
        emp_code    VARCHAR(50),
        emp_name    VARCHAR(200) NOT NULL,
        role        VARCHAR(50) DEFAULT 'both',  -- 'order_by' | 'dispatched_by' | 'both'
        is_active   BOOLEAN DEFAULT TRUE,
        created_at  TIMESTAMP DEFAULT NOW(),
        updated_at  TIMESTAMP DEFAULT NOW(),
        UNIQUE (plant_code, emp_code)
      )
    `);
    await client.query(`
      INSERT INTO cull_sales_emp_master (plant_code, emp_code, emp_name, role) VALUES
        ('1902', 'EMP001', 'Rajan Kumar',    'both'),
        ('1902', 'EMP002', 'Murugan S',      'both'),
        ('1902', 'EMP003', 'Selvam P',       'dispatched_by'),
        ('1902', 'EMP004', 'Arumugam K',     'order_by'),
        ('1903', 'EMP001', 'Suresh R',       'both'),
        ('1904', 'EMP001', 'Kannan M',       'both')
      ON CONFLICT (plant_code, emp_code) DO NOTHING
    `);
    console.log('  ✔ cull_sales_emp_master (6 defaults seeded)');

    await client.query('COMMIT');
    console.log('\n✅ Cull Sales Dropdown Masters done!');
    console.log('  Run: npm run migrate:cull:dropdowns\n');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error:', err.message);
    process.exit(1);
  } finally {
    client.release();
    process.exit(0);
  }
}
run();
