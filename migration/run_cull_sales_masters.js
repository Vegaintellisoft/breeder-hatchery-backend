/**
 * Cull Sales SAP Master Tables — same as broiler BroilerMaster.sql
 * Run: npm run migrate:cull:masters
 *
 * Tables (exact mirror of broiler):
 *   broiler_stock_location  → Customer list (from SAP ZBRO_LOC)
 *   broiler_sales_rate      → Customer + Rate (from SAP ZBRO_SAL_RATE)
 *   broiler_sales_emp_default → Order By + Dispatched By (from SAP ZZBS_EMP_DET)
 *   vehicle_type_cost       → Transport By (from SAP)
 *   customer_type_master    → Customer Type (static)
 *   sales_type_master       → Sales Type (static)
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../src/config/db');

async function run() {
  const client = await pool.connect();
  try {
    console.log('\n🚀 Cull Sales SAP Master Tables Migration...\n');
    await client.query('BEGIN');

    // 1. broiler_stock_location — Customer list from SAP
    //    SAP endpoint: ZBRO_LOC  fields: mandt, werks, lifnr, wName1, lName1
    await client.query(`
      CREATE TABLE IF NOT EXISTS broiler_stock_location (
        id         SERIAL PRIMARY KEY,
        mandt      VARCHAR(10)  NOT NULL,
        werks      VARCHAR(10)  NOT NULL,
        lifnr      VARCHAR(40)  NOT NULL,
        "wName1"   VARCHAR(200),
        "lName1"   VARCHAR(300),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (mandt, werks, lifnr)
      )
    `);
    // Seed sample data
    await client.query(`
      INSERT INTO broiler_stock_location (mandt, werks, lifnr, "wName1", "lName1") VALUES
        ('500','1902','CUST001','VIYAAN ENTERPRISE','PATTAKARANPALAYAM, PERUNDURAI, ERODE'),
        ('500','1902','CUST002','RAJA POULTRY WORKS','KAVERIPATTINAM, KRISHNAGIRI'),
        ('500','1902','CUST003','KUMAR TRADERS','SALEM MAIN ROAD, ERODE'),
        ('500','1903','CUST001','SRI BALAJI TRADERS','HOSUR ROAD, KRISHNAGIRI'),
        ('500','1904','CUST001','ANNAMALAI POULTRY','DHARMAPURI ROAD, KRISHNAGIRI')
      ON CONFLICT (mandt, werks, lifnr) DO NOTHING
    `);
    console.log('  ✔ broiler_stock_location (customer list)');

    // 2. broiler_sales_rate — Customer with rate from SAP
    //    SAP endpoint: ZBRO_SAL_RATE  fields: mandt, werks, allPer, rate
    await client.query(`
      CREATE TABLE IF NOT EXISTS broiler_sales_rate (
        id         SERIAL PRIMARY KEY,
        mandt      VARCHAR(10)  NOT NULL,
        werks      VARCHAR(10),
        "allPer"   VARCHAR(50)  NOT NULL,
        rate       NUMERIC(12,4),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (mandt, werks, "allPer")
      )
    `);
    await client.query(`
      INSERT INTO broiler_sales_rate (mandt, werks, "allPer", rate) VALUES
        ('500','1902','VIYAAN ENTERPRISE', 98.50),
        ('500','1902','RAJA POULTRY WORKS',96.00),
        ('500','1902','KUMAR TRADERS',     95.50),
        ('500','1903','SRI BALAJI TRADERS',97.00),
        ('500','1904','ANNAMALAI POULTRY', 94.00)
      ON CONFLICT (mandt, werks, "allPer") DO NOTHING
    `);
    console.log('  ✔ broiler_sales_rate (customer + rate)');

    // 3. broiler_sales_emp_default — Order By + Dispatched By from SAP
    //    SAP endpoint: ZZBS_EMP_DET  fields: mandt, werks, zzdispBy, zzorderBy
    await client.query(`
      CREATE TABLE IF NOT EXISTS broiler_sales_emp_default (
        id           SERIAL PRIMARY KEY,
        mandt        VARCHAR(10)  NOT NULL,
        werks        VARCHAR(10)  NOT NULL,
        "zzdispBy"   VARCHAR(100) NOT NULL,
        "zzorderBy"  VARCHAR(100),
        created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (mandt, werks, "zzdispBy", "zzorderBy")
      )
    `);
    await client.query(`
      INSERT INTO broiler_sales_emp_default (mandt, werks, "zzdispBy", "zzorderBy") VALUES
        ('500','1902','Murugan S',  'Rajan Kumar'),
        ('500','1902','Selvam P',   'Arumugam K'),
        ('500','1902','Kannan M',   'Rajan Kumar'),
        ('500','1903','Suresh R',   'Suresh R'),
        ('500','1904','Vijay K',    'Vijay K')
      ON CONFLICT (mandt, werks, "zzdispBy", "zzorderBy") DO NOTHING
    `);
    console.log('  ✔ broiler_sales_emp_default (order_by + dispatched_by)');

    // 4. vehicle_type_cost — Transport By from SAP
    //    fields: mandt, zvehStyp, traCost
    await client.query(`
      CREATE TABLE IF NOT EXISTS vehicle_type_cost (
        id           SERIAL PRIMARY KEY,
        mandt        VARCHAR(10)  NOT NULL,
        "zvehStyp"   VARCHAR(20)  NOT NULL,
        "traCost"    NUMERIC(12,4),
        created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (mandt, "zvehStyp")
      )
    `);
    await client.query(`
      INSERT INTO vehicle_type_cost (mandt, "zvehStyp", "traCost") VALUES
        ('500','Own Vehicle',      0),
        ('500','Hired Vehicle',    500),
        ('500','Company Vehicle',  0),
        ('500','Customer Arranged',0),
        ('500','Third Party',      750)
      ON CONFLICT (mandt, "zvehStyp") DO NOTHING
    `);
    console.log('  ✔ vehicle_type_cost (transport by)');

    // 5. customer_type_master — static dropdown (not from SAP)
    await client.query(`
      CREATE TABLE IF NOT EXISTS customer_type_master (
        id         SERIAL PRIMARY KEY,
        type_name  VARCHAR(100) NOT NULL UNIQUE,
        is_active  BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`
      INSERT INTO customer_type_master (type_name) VALUES
        ('Regular'),('Wholesale'),('Retail'),('Institutional'),('Export')
      ON CONFLICT (type_name) DO NOTHING
    `);
    console.log('  ✔ customer_type_master');

    // 6. sales_type_master — static dropdown (not from SAP)
    await client.query(`
      CREATE TABLE IF NOT EXISTS sales_type_master (
        id         SERIAL PRIMARY KEY,
        type_name  VARCHAR(100) NOT NULL UNIQUE,
        is_active  BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`
      INSERT INTO sales_type_master (type_name) VALUES
        ('Live Bird'),('Dressed Bird'),('Farm Gate'),('Market Sale'),('Contract Sale')
      ON CONFLICT (type_name) DO NOTHING
    `);
    console.log('  ✔ sales_type_master');

    await client.query('COMMIT');
    console.log('\n✅ Cull Sales SAP Masters done!');
    console.log('  Run: npm run migrate:cull:masters\n');
    console.log('  To sync from SAP: GET /api/cull-sales/masters/sync/:name');
    console.log('  To get dropdown:  GET /api/cull-sales/masters/getAll/:name\n');
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
