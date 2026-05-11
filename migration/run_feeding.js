/**
 * KRISHI - Feeding (Feed / Medicine / Other) Migration
 * Run: node migration/run_feeding.js
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
    console.log('\n🚀 Running KRISHI Feeding Migration...\n');
    await client.query('BEGIN');

    // ── 1. FEEDING ITEMS MASTER ───────────────────────────────────────────
    // Stores all items for Feed, Medicine, Other tabs
    // Feed & Medicine = fixed (seeded), Other = dynamic (user can add)
    await client.query(`
      CREATE TABLE IF NOT EXISTS feeding_items (
        id          SERIAL PRIMARY KEY,
        category    VARCHAR(20) NOT NULL CHECK (category IN ('feed','medicine','other')),
        item_name   VARCHAR(200) NOT NULL,
        unit        VARCHAR(50),
        is_active   BOOLEAN DEFAULT TRUE,
        is_dynamic  BOOLEAN DEFAULT FALSE,   -- TRUE = user-added (Other tab)
        created_at  TIMESTAMP DEFAULT NOW(),
        updated_at  TIMESTAMP DEFAULT NOW(),
        CONSTRAINT uq_category_item UNIQUE (category, item_name)
      );
    `);
    console.log('  ✔ Table: feeding_items');

    // ── 2. OPENING STOCK (pushed from SAP, saved to DB) ───────────────────
    // SAP pushes opening stock per item per date → saved here automatically
    await client.query(`
      CREATE TABLE IF NOT EXISTS feeding_opening_stock (
        id           SERIAL PRIMARY KEY,
        item_id      INT NOT NULL REFERENCES feeding_items(id) ON DELETE CASCADE,
        stock_date   DATE NOT NULL,
        opening_qty  NUMERIC(10,3) NOT NULL DEFAULT 0,
        sap_ref      VARCHAR(100),           -- SAP reference/doc number
        created_at   TIMESTAMP DEFAULT NOW(),
        updated_at   TIMESTAMP DEFAULT NOW(),
        CONSTRAINT uq_item_stock_date UNIQUE (item_id, stock_date)
      );
    `);
    console.log('  ✔ Table: feeding_opening_stock');

    // ── 3. CONSUMPTION ENTRIES ────────────────────────────────────────────
    // User enters Con Qty per item per date
    await client.query(`
      CREATE TABLE IF NOT EXISTS feeding_consumption (
        id              SERIAL PRIMARY KEY,
        item_id         INT NOT NULL REFERENCES feeding_items(id) ON DELETE CASCADE,
        entry_date      DATE NOT NULL,
        opening_qty     NUMERIC(10,3) NOT NULL DEFAULT 0,
        consumed_qty    NUMERIC(10,3) NOT NULL DEFAULT 0,
        umo             VARCHAR(10)   DEFAULT NULL,
        closing_qty     NUMERIC(10,3) GENERATED ALWAYS AS (opening_qty - consumed_qty) STORED,
        created_at      TIMESTAMP DEFAULT NOW(),
        updated_at      TIMESTAMP DEFAULT NOW(),
        CONSTRAINT uq_consumption_item_date UNIQUE (item_id, entry_date)
      );
    `);
    console.log('  ✔ Table: feeding_consumption (closing_qty auto-calculated)');

    // ── 4. INDEXES ────────────────────────────────────────────────────────
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_fos_item_id    ON feeding_opening_stock(item_id);
      CREATE INDEX IF NOT EXISTS idx_fos_date       ON feeding_opening_stock(stock_date);
      CREATE INDEX IF NOT EXISTS idx_fc_item_id     ON feeding_consumption(item_id);
      CREATE INDEX IF NOT EXISTS idx_fc_entry_date  ON feeding_consumption(entry_date);
      CREATE INDEX IF NOT EXISTS idx_fi_category    ON feeding_items(category);
    `);
    console.log('  ✔ Indexes created');

    // ── 5. SEED FEED ITEMS ────────────────────────────────────────────────
    await client.query(`
      INSERT INTO feeding_items (category, item_name, unit, is_dynamic) VALUES
        ('feed', 'Broiler Breeder Chick Crumbles', '50 kg',  FALSE),
        ('feed', 'Broiler Breeder Grower Mash',    '50 kg',  FALSE),
        ('feed', 'Broiler Finisher Pellet',        '50 kg',  FALSE)
      ON CONFLICT (category, item_name) DO NOTHING;
    `);
    console.log('  ✔ Seeded: Feed items (3)');

    // ── 6. SEED MEDICINE ITEMS ────────────────────────────────────────────
    await client.query(`
      INSERT INTO feeding_items (category, item_name, unit, is_dynamic) VALUES
        ('medicine', 'BVCLO2-10GM Tablet',                  'tablet',    FALSE),
        ('medicine', 'Amikacin Injection I.P 100ml',        '100ml',     FALSE),
        ('medicine', 'Microflex-10%',                       'ml',        FALSE),
        ('medicine', 'Kohrsolin TH-500ml',                  '500ml',     FALSE),
        ('medicine', 'SUPEROX',                             'kg',        FALSE),
        ('medicine', 'IBH K - 1000 Doses',                  '1000 dose', FALSE),
        ('medicine', 'Kaysol Forte 50gm',                   '50gm',      FALSE),
        ('medicine', 'Selko PH (IN)',                       'ltr',       FALSE),
        ('medicine', 'Bleaching Powder - Calcium Hypochlorite 35%', 'kg', FALSE),
        ('medicine', 'Inactivated ND 2000 (VND)',           'dose',      FALSE),
        ('medicine', 'Biospark V (5 Liter)',                '5 ltr',     FALSE),
        ('medicine', 'Stresvel (5 Liter)',                  '5 ltr',     FALSE),
        ('medicine', 'Aquamax (5 Liter)',                   '5 ltr',     FALSE),
        ('medicine', 'B904 (5 Liter)',                      '5 ltr',     FALSE),
        ('medicine', 'IB Multi Killed - 1000 Doses',        '1000 dose', FALSE),
        ('medicine', 'Fowl Pox - 1000 Doses',               '1000 dose', FALSE),
        ('medicine', 'Diluent',                             'ltr',       FALSE),
        ('medicine', 'Formalin',                            'ltr',       FALSE),
        ('medicine', 'Brotone Vet',                         'kg',        FALSE),
        ('medicine', 'ND R2Blive - 1000 Doses',             '1000 dose', FALSE),
        ('medicine', 'Roundup Herbicide',                   'ltr',       FALSE),
        ('medicine', 'Super Erazer Liquid',                 '1 ltr',     FALSE),
        ('medicine', 'Flyact Power Pellets',                '500gms',    FALSE),
        ('medicine', 'Dynamutilin 80%',                     'kg',        FALSE)
      ON CONFLICT (category, item_name) DO NOTHING;
    `);
    console.log('  ✔ Seeded: Medicine items (24)');

    // ── 7. SEED SAMPLE OPENING STOCK (SAP placeholder) ───────────────────
    // This simulates what SAP would push — for testing only
    const today = new Date().toISOString().split('T')[0];
    await client.query(`
      INSERT INTO feeding_opening_stock (item_id, stock_date, opening_qty, sap_ref)
      SELECT fi.id, $1, sample.qty, 'SAP-SEED-001'
      FROM feeding_items fi
      JOIN (VALUES
        ('Broiler Breeder Chick Crumbles', 500),
        ('Broiler Breeder Grower Mash',    300),
        ('Broiler Finisher Pellet',        200),
        ('BVCLO2-10GM Tablet',             100),
        ('Amikacin Injection I.P 100ml',   50),
        ('Microflex-10%',                  80),
        ('Kohrsolin TH-500ml',             40),
        ('SUPEROX',                        60),
        ('IBH K - 1000 Doses',             20),
        ('Kaysol Forte 50gm',              35),
        ('Selko PH (IN)',                  25),
        ('Bleaching Powder - Calcium Hypochlorite 35%', 45),
        ('Inactivated ND 2000 (VND)',      15),
        ('Biospark V (5 Liter)',           10),
        ('Stresvel (5 Liter)',             12),
        ('Aquamax (5 Liter)',              18),
        ('B904 (5 Liter)',                 8),
        ('IB Multi Killed - 1000 Doses',   6),
        ('Fowl Pox - 1000 Doses',          5),
        ('Diluent',                        30),
        ('Formalin',                       22),
        ('Brotone Vet',                    14),
        ('ND R2Blive - 1000 Doses',        9),
        ('Roundup Herbicide',              7),
        ('Super Erazer Liquid',            11),
        ('Flyact Power Pellets',           16),
        ('Dynamutilin 80%',                13)
      ) AS sample(name, qty) ON fi.item_name = sample.name
      ON CONFLICT (item_id, stock_date) DO UPDATE SET
        opening_qty = EXCLUDED.opening_qty,
        sap_ref     = EXCLUDED.sap_ref,
        updated_at  = NOW();
    `, [today]);
    console.log(`  ✔ Seeded: Opening stock for all items on ${today}`);

    await client.query('COMMIT');

    console.log('\n✅ Feeding Migration completed!');
    console.log('─────────────────────────────────────────────────────────────');
    console.log('  Tables : feeding_items, feeding_opening_stock, feeding_consumption');
    console.log('  Feed   : 3 items seeded');
    console.log('  Medicine: 24 items seeded');
    console.log('  Other  : dynamic (add via POST /api/feeding/other/item)');
    console.log('  Stock  : sample opening stock seeded for today');
    console.log('  Note   : closing_qty auto-calculated (opening - consumed)');
    console.log('─────────────────────────────────────────────────────────────\n');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n❌ Migration failed:', err.message);
    console.error(err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
