/**
 * KRISHI - Activities & Biosecurity Migration
 * (Farms, Flocks, Categories, Activities, Frequency Assignments, Master Entries)
 * Run: node migration/run_activities.js
 */

const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     process.env.DB_PORT     || 5432,
  database: process.env.DB_NAME     || 'krishi_db',
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});

async function run() {
  const client = await pool.connect();
  try {
    console.log('\n🚀 Running Activities & Biosecurity Migration...\n');
    await client.query('BEGIN');

    // ── 1. FARMS ──────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS farms (
        id          SERIAL PRIMARY KEY,
        plant_code  VARCHAR(20) UNIQUE NOT NULL,
        plant_name  VARCHAR(120) NOT NULL,
        location    VARCHAR(80),
        division    VARCHAR(40)  DEFAULT 'Breeder',
        farm_type   VARCHAR(20)  DEFAULT 'Own',
        created_at  TIMESTAMPTZ  DEFAULT NOW()
      );
    `);
    console.log('  ✔ Table: farms');

    // ── 2. FARM FLOCKS (uses farm_flocks to avoid conflict with breeder flocks table) ─
    await client.query(`
      CREATE TABLE IF NOT EXISTS farm_flocks (
        id              SERIAL PRIMARY KEY,
        farm_id         INT REFERENCES farms(id) ON DELETE CASCADE,
        flock_no        VARCHAR(20) NOT NULL,
        stage           VARCHAR(30),
        date_of_receipt DATE,
        male_chicks     INT DEFAULT 0,
        female_chicks   INT DEFAULT 0,
        age_weeks       INT DEFAULT 0,
        created_at      TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('  ✔ Table: farm_flocks');

    // ── 3. ACTIVITY CATEGORIES ────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS activity_categories (
        id         SERIAL PRIMARY KEY,
        code       VARCHAR(60) UNIQUE NOT NULL,
        label      VARCHAR(120) NOT NULL,
        icon       VARCHAR(30),
        sort_order INT     DEFAULT 0,
        is_active  BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('  ✔ Table: activity_categories');

    // ── 4. ACTIVITIES ─────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS activities (
        id          SERIAL PRIMARY KEY,
        category_id INT REFERENCES activity_categories(id) ON DELETE CASCADE,
        code        VARCHAR(80) UNIQUE NOT NULL,
        label       VARCHAR(150) NOT NULL,
        sort_order  INT DEFAULT 0,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('  ✔ Table: activities');

    // ── 5. FREQUENCY ASSIGNMENTS ──────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS activity_frequency_assignments (
        id                     SERIAL PRIMARY KEY,
        activity_id            INT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
        frequency              VARCHAR(20) NOT NULL CHECK (frequency IN (
                                 'daily','weekly','fortnightly','monthly',
                                 'two_month_once','quarterly','bi_annually'
                               )),
        is_active              BOOLEAN DEFAULT TRUE,
        image_required         BOOLEAN DEFAULT FALSE,
        sample_fields_required BOOLEAN DEFAULT FALSE,
        created_at             TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(activity_id, frequency)
      );
      CREATE INDEX IF NOT EXISTS idx_freq_assign_active
        ON activity_frequency_assignments(activity_id, frequency, is_active);
      CREATE INDEX IF NOT EXISTS idx_afa_sample_fields
        ON activity_frequency_assignments(activity_id, frequency, sample_fields_required);
    `);
    console.log('  ✔ Table: activity_frequency_assignments');

    // ── 6. FARM BIOSECURITY MASTER ────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS farm_biosecurity_master (
        id              SERIAL PRIMARY KEY,
        farm_id         INT NOT NULL REFERENCES farms(id),
        flock_id        INT REFERENCES farm_flocks(id),
        activity_id     INT NOT NULL REFERENCES activities(id),
        frequency       VARCHAR(20) NOT NULL,
        target_date     DATE NOT NULL,

        toggle_enabled  BOOLEAN DEFAULT FALSE,
        value           TEXT,
        image_path      VARCHAR(500),
        remarks         TEXT,
        recorded_time   TEXT,

        ph_level        NUMERIC(5,2),
        tds_level       NUMERIC(7,2),
        male_count      INT,
        female_count    INT,
        quantity        NUMERIC(10,2),
        opening_stock   NUMERIC(10,2),
        consumed_qty    NUMERIC(10,2),

        sample_date_time    TEXT,
        sample_flock        TEXT,
        sample_age          TEXT,
        sample_shed_no      TEXT,
        sample_type         TEXT,
        no_of_samples       INT,
        organ_name          TEXT,
        collected_by        TEXT,
        sample_sent_date    DATE,
        sample_sent_through TEXT,
        pod_slip_no         TEXT,
        lab_name            TEXT,

        entered_by      VARCHAR(60),
        entered_at      TIMESTAMPTZ DEFAULT NOW(),
        updated_at      TIMESTAMPTZ DEFAULT NOW(),

        CONSTRAINT uq_master_entry UNIQUE (farm_id, flock_id, activity_id, target_date)
      );
      CREATE INDEX IF NOT EXISTS idx_master_farm_freq_date
        ON farm_biosecurity_master(farm_id, frequency, target_date DESC);
      CREATE INDEX IF NOT EXISTS idx_master_activity_date
        ON farm_biosecurity_master(activity_id, target_date DESC);
    `);
    console.log('  ✔ Table: farm_biosecurity_master');

    // ── 7. SEED CATEGORIES ────────────────────────────────────────────────
    await client.query(`
      INSERT INTO activity_categories (code, label, sort_order) VALUES
        ('biosecurity',      'Biosecurity & Disinfection',  1),
        ('water_quality',    'Water Quality',               2),
        ('feed_inventory',   'Feed Inventory',              3),
        ('fly_feather',      'Fly & Feather Control',       4),
        ('flock_inventory',  'Flock Inventory',             5),
        ('semen_collection', 'Semen Collection',            6),
        ('insemination',     'Artificial Insemination',     7),
        ('maintenance',      'Maintenance',                 8),
        ('sales',            'Sales',                       9),
        ('supportives_male', 'Supportives - Males',        10),
        ('supportives_fem',  'Supportives - Female',       11),
        ('disinfectant',     'DisInfectant Spray',         12),
        ('stock',            'Stock',                      13),
        ('body_weight',      'Body Weight',                14),
        ('weekly_planner',   'Weekly Planner',             15),
        ('farm_req',         'Farm Requirements',          16),
        ('cleaning',         'Cleaning',                   17),
        ('grading',          'Grading',                    18),
        ('medication',       'Medication',                 19),
        ('requirement',      'Requirement',                20),
        ('monthly_planner',  'Monthly Planner',            21),
        ('testing',          'Testing',                    22),
        ('male_mgmt',        'Male Management',            23)
      ON CONFLICT (code) DO NOTHING;
    `);
    console.log('  ✔ Seeded: 23 activity categories');

    // ── 8. SEED DAILY ACTIVITIES ──────────────────────────────────────────
    const dailyActivities = [
      // biosecurity (4)
      ['biosecurity','refill_handwash',       'Refill Hand Wash Solution - At gate/Office/Shed', 1],
      ['biosecurity','footdip_water',          'Foot dip water changed - At gate/Office/Shed',    2],
      ['biosecurity','vehicle_spray',          'Vehicle spray running condition',                  3],
      ['biosecurity','coldstore_mopping',      'Cold Store Mopping (4 times/day)',                 4],
      // water_quality (11)
      ['water_quality','water_ph_tds',         'Water Quality Checking (PH/TDS)',                  5],
      ['water_quality','water_sanitation',     'Water Sanitation - 1st/2nd/3rd time',              6],
      ['water_quality','subtank_cleaning',     'Sub Tank cleaning',                                7],
      ['water_quality','nipple_pressure',      'Nipple Pressure Checking',                         8],
      ['water_quality','nipple_leakage',       'Nipple Leakage Checking',                          9],
      ['water_quality','fogger_tank',          'Fogger Tank Sanitation',                          10],
      ['water_quality','fogger_nozzle',        'Fogger Nozzle Leakage checking',                  11],
      ['water_quality','waste_egg',            'Waste Egg collection (Litter)',                   12],
      ['water_quality','feeder_cleaning',      'Feeder Cleaning - Wet cloth only',                13],
      ['water_quality','mat_cleaning',         'Mat Cleaning - Dry & Wet cleaning',               14],
      ['water_quality','egg_rope',             'Egg Rope Tension Checking',                       15],
      // feed_inventory (5)
      ['feed_inventory','linewise_feed_alloc', 'Line-wise Feed allocation',                       16],
      ['feed_inventory','feedbox_marking',     'Arrange Line-wise Feed Box with marking',         17],
      ['feed_inventory','sample_weighing_50kg','10 bags sample weighing for 50kg',                18],
      ['feed_inventory','linewise_feed_weighing','Line-wise Feed Weighing',                       19],
      ['feed_inventory','feed_shortage',       'Feed Shortage /Excess',                           20],
      // fly_feather (7)
      ['fly_feather','feather_control',        'Feather Control',                                 21],
      ['fly_feather','fly_larvae',             'Fly Larvae Control - Spray',                      22],
      ['fly_feather','wet_litter',             'Wet Litter Removal/Racking',                      23],
      ['fly_feather','litter_lime',            'Litter Treatment - Lime Powder',                  24],
      ['fly_feather','adult_fly_spray',        'Adult Fly control - Spray',                       25],
      ['fly_feather','adult_fly_tape',         'Adult Fly control - Tape/bait',                   26],
      ['fly_feather','platform_clean',         'Platform cleaning',                               27],
      // flock_inventory (12)
      ['flock_inventory','mortality_removal',  'Mortality Removal (3 times)',                     28],
      ['flock_inventory','weak_birds_removal', 'Weak Birds Removal - Female & Male',              29],
      ['flock_inventory','non_layer_removal',  'Non Layer Removal',                               30],
      ['flock_inventory','weak_birds_stock',   'Weak Birds Stock',                                31],
      ['flock_inventory','line_stock_adj',     'Line Stock Adjustment',                           32],
      ['flock_inventory','cut_line_stock',     'Cut line stock for feed allocation',              33],
      ['flock_inventory','birds_stock',        'Birds Stock',                                     34],
      ['flock_inventory','used_pp_bags',       'Used PP Bags - fold and stack it in store room',  35],
      ['flock_inventory','genset_fuel',        'Genset Fuel Stock: Min. 200 lit',                 36],
      ['flock_inventory','daily_egg_prod',     'Daily Egg Production',                            37],
      ['flock_inventory','semen_collection_d', 'Semen Collection',                                38],
      ['flock_inventory','ai_insemination',    'Artificial Insemination',                         39],
      // semen_collection (3)
      ['semen_collection','semen_male_prep',   'Male Preparation for Semen Collection',           40],
      ['semen_collection','semen_quality',     'Semen Quality Check',                             41],
      ['semen_collection','semen_volume',      'Semen Volume Recording',                          42],
      // insemination (4)
      ['insemination','ai_female_prep',        'Female Preparation for AI',                       43],
      ['insemination','ai_dose_record',        'AI Dose Recording',                               44],
      ['insemination','ai_time_record',        'AI Time Recording',                               45],
      ['insemination','ai_completion',         'AI Completion Check',                             46],
      // maintenance (4)
      ['maintenance','equipment_check',        'Equipment Check',                                 47],
      ['maintenance','generator_check',        'Generator Check',                                 48],
      ['maintenance','water_pump_check',       'Water Pump Check',                                49],
      ['maintenance','lighting_check',         'Lighting Check',                                  50],
      // sales (2)
      ['sales','egg_dispatch',                 'Egg Dispatch Record',                             51],
      ['sales','reject_egg_sale',              'Reject Egg Sale Record',                          52],
      // supportives_male (2)
      ['supportives_male','male_supplement',   'Male Supplement Dosing',                          53],
      ['supportives_male','male_health_check', 'Male Health Check',                               54],
      // supportives_fem (2)
      ['supportives_fem','fem_supplement',     'Female Supplement Dosing',                        55],
      ['supportives_fem','fem_health_check',   'Female Health Check',                             56],
      // disinfectant (2)
      ['disinfectant','shed_disinfect',        'Shed Disinfection Spray',                         57],
      ['disinfectant','corridor_disinfect',    'Corridor Disinfection Spray',                     58],
      // stock (1)
      ['stock','medicine_stock',               'Medicine Stock Check',                            59],
    ];

    for (const [cat, code, label, sort] of dailyActivities) {
      await client.query(`
        INSERT INTO activities (category_id, code, label, sort_order)
        SELECT id, $1, $2, $3 FROM activity_categories WHERE code=$4
        ON CONFLICT (code) DO NOTHING
      `, [code, label, sort, cat]);
    }
    console.log(`  ✔ Seeded: ${dailyActivities.length} daily activities`);

    // ── 9. ASSIGN ALL DAILY ACTIVITIES TO 'daily' FREQUENCY ──────────────
    await client.query(`
      INSERT INTO activity_frequency_assignments (activity_id, frequency, is_active)
      SELECT a.id, 'daily', TRUE
      FROM activities a
      ON CONFLICT (activity_id, frequency) DO NOTHING;
    `);
    console.log('  ✔ Assigned: all activities to daily frequency');

    // ── 10. SEED SAMPLE FARM + FLOCK ─────────────────────────────────────
    await client.query(`
      INSERT INTO farms (plant_code, plant_name, location, division, farm_type)
      VALUES ('FARM001', 'KRISHI Breeder Farm - Main', 'Tamil Nadu', 'Breeder', 'Own')
      ON CONFLICT (plant_code) DO NOTHING;
    `);
    const farmRes = await client.query(`SELECT id FROM farms WHERE plant_code='FARM001'`);
    const farmId  = farmRes.rows[0].id;

    await client.query(`
      INSERT INTO farm_flocks (farm_id, flock_no, stage, date_of_receipt, male_chicks, female_chicks, age_weeks)
      VALUES ($1, 'FLOCK-2025-001', 'Broiler Breeder', CURRENT_DATE - 30, 500, 2000, 4)
      ON CONFLICT DO NOTHING;
    `, [farmId]);
    console.log('  ✔ Seeded: sample farm (FARM001) + flock');

    await client.query('COMMIT');

    console.log('\n✅ Activities Migration completed!');
    console.log('──────────────────────────────────────────────────────────────');
    console.log('  Tables  : farms, farm_flocks, activity_categories, activities');
    console.log('            activity_frequency_assignments, farm_biosecurity_master');
    console.log('  Seeded  : 23 categories, 59 daily activities');
    console.log('  Sample  : 1 farm (FARM001), 1 flock');
    console.log('  Frequencies: daily | weekly | fortnightly | monthly');
    console.log('               two_month_once | quarterly | bi_annually');
    console.log('──────────────────────────────────────────────────────────────\n');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n❌ Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
