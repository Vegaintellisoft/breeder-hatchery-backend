/**
 * COMPLETE DB SETUP MIGRATION
 * Run this on a fresh DB or to sync all changes
 * Run: npm run migrate:setup
 *
 * Covers ALL changes made during development:
 * 1. egg_collection_header — add shed/part/line, sap cols, fix unique constraint
 * 2. egg_collection_slots  — add egg count columns
 * 3. cull_sales_header     — create table
 * 4. cull_sales_load_detail — create table
 * 5. mortality_log         — add sap cols
 * 6. cull_kill_log         — add sap cols
 * 7. flock_feeding_log     — add sap cols
 * 8. flock_bird_weight     — add sap cols
 * 9. Cull Sales master tables (broiler_stock_location etc.)
 * 10. Static master tables (customer_type_master, sales_type_master)
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../src/config/db');

async function safe(client, sql, label) {
  try {
    await client.query(sql);
    console.log(`  ✔ ${label}`);
  } catch(e) {
    if (e.message.match(/already exists|duplicate/i)) {
      console.log(`  ⏭  ${label} (already exists)`);
    } else {
      console.log(`  ⚠  ${label}: ${e.message}`);
    }
  }
}

async function run() {
  const client = await pool.connect();
  try {
    console.log('\n🚀 Running Complete DB Setup...\n');

    // ── 1. egg_collection_header ─────────────────────────────────────────
    console.log('📋 egg_collection_header...');
    await safe(client, `ALTER TABLE egg_collection_header ADD COLUMN IF NOT EXISTS shed_id INT REFERENCES shed_master(id)`, 'shed_id');
    await safe(client, `ALTER TABLE egg_collection_header ADD COLUMN IF NOT EXISTS part_id INT REFERENCES shed_part_master(id)`, 'part_id');
    await safe(client, `ALTER TABLE egg_collection_header ADD COLUMN IF NOT EXISTS line_id INT REFERENCES shed_line_master(id)`, 'line_id');
    await safe(client, `ALTER TABLE egg_collection_header ADD COLUMN IF NOT EXISTS sap_synced BOOLEAN DEFAULT FALSE`, 'sap_synced');
    await safe(client, `ALTER TABLE egg_collection_header ADD COLUMN IF NOT EXISTS sap_synced_at TIMESTAMP DEFAULT NULL`, 'sap_synced_at');
    await safe(client, `ALTER TABLE egg_collection_header ADD COLUMN IF NOT EXISTS sap_synced_by INT DEFAULT NULL`, 'sap_synced_by');
    await safe(client, `ALTER TABLE egg_collection_header ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`, 'updated_at');
    // Drop old wrong unique constraints
    await safe(client, `ALTER TABLE egg_collection_header DROP CONSTRAINT IF EXISTS egg_collection_header_flock_no_collection_date_key`, 'drop old unique 1');
    await safe(client, `ALTER TABLE egg_collection_header DROP CONSTRAINT IF EXISTS uq_egg_header_flock_date`, 'drop old unique 2');
    await safe(client, `ALTER TABLE egg_collection_header DROP CONSTRAINT IF EXISTS uq_egg_header_flock_date_shed`, 'drop old unique 3');
    await safe(client, `ALTER TABLE egg_collection_header DROP CONSTRAINT IF EXISTS uq_egg_header_flock_plant_date`, 'drop old unique 4');
    // Add correct unique constraint
    await safe(client, `ALTER TABLE egg_collection_header ADD CONSTRAINT uq_egg_header_flock_plant_date UNIQUE (flock_no, plant_code, collection_date)`, 'UNIQUE(flock_no, plant_code, collection_date)');

    // ── 2. egg_collection_slots ──────────────────────────────────────────
    console.log('\n📋 egg_collection_slots...');
    await safe(client, `ALTER TABLE egg_collection_slots ADD COLUMN IF NOT EXISTS table_egg INT NOT NULL DEFAULT 0`, 'table_egg');
    await safe(client, `ALTER TABLE egg_collection_slots ADD COLUMN IF NOT EXISTS jumbo_egg INT NOT NULL DEFAULT 0`, 'jumbo_egg');
    await safe(client, `ALTER TABLE egg_collection_slots ADD COLUMN IF NOT EXISTS crack_egg INT NOT NULL DEFAULT 0`, 'crack_egg');
    await safe(client, `ALTER TABLE egg_collection_slots ADD COLUMN IF NOT EXISTS waste_reject_egg INT NOT NULL DEFAULT 0`, 'waste_reject_egg');
    await safe(client, `ALTER TABLE egg_collection_slots ADD COLUMN IF NOT EXISTS hatching_egg INT NOT NULL DEFAULT 0`, 'hatching_egg');
    await safe(client, `
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='egg_collection_slots' AND column_name='total_eggs') THEN
          ALTER TABLE egg_collection_slots ADD COLUMN total_eggs INT GENERATED ALWAYS AS (table_egg+jumbo_egg+crack_egg+waste_reject_egg+hatching_egg) STORED;
        END IF;
      END $$
    `, 'total_eggs (generated)');

    // ── 3. cull_sales_header ─────────────────────────────────────────────
    console.log('\n📋 cull_sales_header...');
    await safe(client, `
      CREATE TABLE IF NOT EXISTS cull_sales_header (
        id              SERIAL PRIMARY KEY,
        flock_no        VARCHAR(20) NOT NULL,
        plant_code      VARCHAR(20) NOT NULL,
        entry_date      DATE NOT NULL DEFAULT CURRENT_DATE,
        shed_id         INT REFERENCES shed_master(id),
        part_id         INT REFERENCES shed_part_master(id),
        line_id         INT REFERENCES shed_line_master(id),
        batch_no        VARCHAR(50),
        age             VARCHAR(50),
        bird_stock      INT DEFAULT 0,
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
        rate            NUMERIC(10,2) DEFAULT 0,
        net_weight_male   NUMERIC(10,3) DEFAULT 0,
        net_weight_female NUMERIC(10,3) DEFAULT 0,
        avg_weight_male   NUMERIC(10,3) DEFAULT 0,
        avg_weight_female NUMERIC(10,3) DEFAULT 0,
        gross_value     NUMERIC(12,2) DEFAULT 0,
        bill_value      NUMERIC(12,2) DEFAULT 0,
        bill_no         VARCHAR(50),
        dc_no_auto      VARCHAR(50),
        pdf_link        TEXT,
        status          VARCHAR(20) DEFAULT 'pending',
        remarks         TEXT,
        entered_by      INT REFERENCES admin(id),
        sap_synced      BOOLEAN DEFAULT FALSE,
        sap_synced_at   TIMESTAMP DEFAULT NULL,
        sap_synced_by   INT DEFAULT NULL,
        created_at      TIMESTAMP DEFAULT NOW(),
        updated_at      TIMESTAMP DEFAULT NOW(),
        CONSTRAINT uq_cull_sales_flock_date UNIQUE (flock_no, entry_date)
      )
    `, 'cull_sales_header table');

    // ── 4. cull_sales_load_detail ────────────────────────────────────────
    console.log('\n📋 cull_sales_load_detail...');
    await safe(client, `
      CREATE TABLE IF NOT EXISTS cull_sales_load_detail (
        id             SERIAL PRIMARY KEY,
        cull_sales_id  INT NOT NULL REFERENCES cull_sales_header(id) ON DELETE CASCADE,
        s_no           INT NOT NULL,
        cage_no        INT,
        empty_weight   NUMERIC(10,3) DEFAULT 0,
        birds_male     INT DEFAULT 0,
        birds_female   INT DEFAULT 0,
        load_weight    NUMERIC(10,3) DEFAULT 0,
        net_weight     NUMERIC(10,3) DEFAULT 0,
        created_at     TIMESTAMP DEFAULT NOW()
      )
    `, 'cull_sales_load_detail table');

    // ── 5. SAP sync columns on all transactional tables ──────────────────
    console.log('\n📋 SAP sync columns...');
    const sapTables = ['mortality_log','cull_kill_log','flock_feeding_log','flock_bird_weight'];
    for (const t of sapTables) {
      const exists = await client.query(`SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`, [t]);
      if (!exists.rowCount) { console.log(`  ⏭  ${t} not found, skip`); continue; }
      await safe(client, `ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS sap_synced BOOLEAN DEFAULT FALSE`, `${t}.sap_synced`);
      await safe(client, `ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS sap_synced_at TIMESTAMP DEFAULT NULL`, `${t}.sap_synced_at`);
      await safe(client, `ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS sap_synced_by INT DEFAULT NULL`, `${t}.sap_synced_by`);
    }

    // ── 6. Cull Sales master tables ──────────────────────────────────────
    console.log('\n📋 Cull Sales master tables...');
    await safe(client, `
      CREATE TABLE IF NOT EXISTS broiler_stock_location (
        id         SERIAL PRIMARY KEY,
        mandt      VARCHAR(10) NOT NULL,
        werks      VARCHAR(10) NOT NULL,
        lifnr      VARCHAR(40) NOT NULL,
        "wName1"   VARCHAR(200),
        "lName1"   VARCHAR(300),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE (mandt, werks, lifnr)
      )
    `, 'broiler_stock_location');
    await safe(client, `
      INSERT INTO broiler_stock_location (mandt, werks, lifnr, "wName1", "lName1") VALUES
        ('500','1902','CUST001','VIYAAN ENTERPRISE','PATTAKARANPALAYAM, PERUNDURAI, ERODE'),
        ('500','1902','CUST002','RAJA POULTRY WORKS','KAVERIPATTINAM, KRISHNAGIRI'),
        ('500','1902','CUST003','KUMAR TRADERS','SALEM MAIN ROAD, ERODE')
      ON CONFLICT DO NOTHING
    `, 'broiler_stock_location seed');

    await safe(client, `
      CREATE TABLE IF NOT EXISTS broiler_sales_rate (
        id         SERIAL PRIMARY KEY,
        mandt      VARCHAR(10) NOT NULL,
        werks      VARCHAR(10),
        "allPer"   VARCHAR(50) NOT NULL,
        rate       NUMERIC(12,4),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE (mandt, werks, "allPer")
      )
    `, 'broiler_sales_rate');
    await safe(client, `
      INSERT INTO broiler_sales_rate (mandt, werks, "allPer", rate) VALUES
        ('500','1902','VIYAAN ENTERPRISE',98.50),
        ('500','1902','RAJA POULTRY WORKS',96.00),
        ('500','1902','KUMAR TRADERS',95.50)
      ON CONFLICT DO NOTHING
    `, 'broiler_sales_rate seed');

    await safe(client, `
      CREATE TABLE IF NOT EXISTS broiler_sales_emp_default (
        id           SERIAL PRIMARY KEY,
        mandt        VARCHAR(10) NOT NULL,
        werks        VARCHAR(10) NOT NULL,
        "zzdispBy"   VARCHAR(100) NOT NULL,
        "zzorderBy"  VARCHAR(100),
        created_at   TIMESTAMP DEFAULT NOW(),
        updated_at   TIMESTAMP DEFAULT NOW(),
        UNIQUE (mandt, werks, "zzdispBy", "zzorderBy")
      )
    `, 'broiler_sales_emp_default');
    await safe(client, `
      INSERT INTO broiler_sales_emp_default (mandt, werks, "zzdispBy", "zzorderBy") VALUES
        ('500','1902','Murugan S','Rajan Kumar'),
        ('500','1902','Selvam P','Arumugam K'),
        ('500','1902','Kannan M','Rajan Kumar')
      ON CONFLICT DO NOTHING
    `, 'broiler_sales_emp_default seed');

    await safe(client, `
      CREATE TABLE IF NOT EXISTS vehicle_type_cost (
        id           SERIAL PRIMARY KEY,
        mandt        VARCHAR(10) NOT NULL,
        "zvehStyp"   VARCHAR(20) NOT NULL,
        "traCost"    NUMERIC(12,4),
        created_at   TIMESTAMP DEFAULT NOW(),
        updated_at   TIMESTAMP DEFAULT NOW(),
        UNIQUE (mandt, "zvehStyp")
      )
    `, 'vehicle_type_cost');
    await safe(client, `
      INSERT INTO vehicle_type_cost (mandt, "zvehStyp", "traCost") VALUES
        ('500','Own Vehicle',0),
        ('500','Hired Vehicle',500),
        ('500','Company Vehicle',0),
        ('500','Customer Arranged',0),
        ('500','Third Party',750)
      ON CONFLICT DO NOTHING
    `, 'vehicle_type_cost seed');

    // ── 7. Static master tables ──────────────────────────────────────────
    console.log('\n📋 Static master tables...');
    await safe(client, `
      CREATE TABLE IF NOT EXISTS customer_type_master (
        id         SERIAL PRIMARY KEY,
        type_name  VARCHAR(100) NOT NULL UNIQUE,
        is_active  BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `, 'customer_type_master');
    await safe(client, `
      INSERT INTO customer_type_master (type_name) VALUES
        ('Regular'),('Wholesale'),('Retail'),('Institutional'),('Export')
      ON CONFLICT DO NOTHING
    `, 'customer_type_master seed');

    await safe(client, `
      CREATE TABLE IF NOT EXISTS sales_type_master (
        id         SERIAL PRIMARY KEY,
        type_name  VARCHAR(100) NOT NULL UNIQUE,
        is_active  BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `, 'sales_type_master');
    await safe(client, `
      INSERT INTO sales_type_master (type_name) VALUES
        ('Live Bird'),('Dressed Bird'),('Farm Gate'),('Market Sale'),('Contract Sale')
      ON CONFLICT DO NOTHING
    `, 'sales_type_master seed');

    // ── 8. Indexes ───────────────────────────────────────────────────────
    console.log('\n📋 Indexes...');
    await safe(client, `CREATE INDEX IF NOT EXISTS idx_ech_flock_date ON egg_collection_header(flock_no, collection_date)`, 'idx egg_collection_header');
    await safe(client, `CREATE INDEX IF NOT EXISTS idx_ecs_header ON egg_collection_slots(header_id)`, 'idx egg_collection_slots');
    await safe(client, `CREATE INDEX IF NOT EXISTS idx_ecr_slot ON egg_collection_rows(slot_id)`, 'idx egg_collection_rows(slot)');
    await safe(client, `CREATE INDEX IF NOT EXISTS idx_ecr_header ON egg_collection_rows(header_id)`, 'idx egg_collection_rows(header)');
    await safe(client, `CREATE INDEX IF NOT EXISTS idx_cs_flock ON cull_sales_header(flock_no, entry_date)`, 'idx cull_sales_header');

    console.log('\n✅ Complete DB Setup Done!\n');
    console.log('Tables created/updated:');
    console.log('  egg_collection_header, egg_collection_slots');
    console.log('  cull_sales_header, cull_sales_load_detail');
    console.log('  mortality_log, cull_kill_log, flock_feeding_log, flock_bird_weight (sap cols)');
    console.log('  broiler_stock_location, broiler_sales_rate, broiler_sales_emp_default');
    console.log('  vehicle_type_cost, customer_type_master, sales_type_master\n');

  } catch(err) {
    console.error('Fatal:', err.message);
    process.exit(1);
  } finally {
    client.release();
    process.exit(0);
  }
}
run();
