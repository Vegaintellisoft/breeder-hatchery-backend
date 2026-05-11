/**
 * DEFINITIVE DB FIX — based on actual breeder_db__1_.sql
 * Run: npm run migrate:db:fix
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
    console.log('\n🚀 Running DB fix...\n');

    // 1. egg_collection_header — add shed_id, part_id, line_id, sap cols
    await safe(client, `ALTER TABLE egg_collection_header ADD COLUMN IF NOT EXISTS shed_id INT REFERENCES shed_master(id)`, 'egg_collection_header.shed_id');
    await safe(client, `ALTER TABLE egg_collection_header ADD COLUMN IF NOT EXISTS part_id INT REFERENCES shed_part_master(id)`, 'egg_collection_header.part_id');
    await safe(client, `ALTER TABLE egg_collection_header ADD COLUMN IF NOT EXISTS line_id INT REFERENCES shed_line_master(id)`, 'egg_collection_header.line_id');
    await safe(client, `ALTER TABLE egg_collection_header ADD COLUMN IF NOT EXISTS sap_synced BOOLEAN DEFAULT FALSE`, 'egg_collection_header.sap_synced');
    await safe(client, `ALTER TABLE egg_collection_header ADD COLUMN IF NOT EXISTS sap_synced_at TIMESTAMP DEFAULT NULL`, 'egg_collection_header.sap_synced_at');
    await safe(client, `ALTER TABLE egg_collection_header ADD COLUMN IF NOT EXISTS sap_synced_by INT DEFAULT NULL`, 'egg_collection_header.sap_synced_by');

    // 2. egg_collection_slots — add egg count columns
    await safe(client, `ALTER TABLE egg_collection_slots ADD COLUMN IF NOT EXISTS table_egg INT NOT NULL DEFAULT 0`, 'egg_collection_slots.table_egg');
    await safe(client, `ALTER TABLE egg_collection_slots ADD COLUMN IF NOT EXISTS jumbo_egg INT NOT NULL DEFAULT 0`, 'egg_collection_slots.jumbo_egg');
    await safe(client, `ALTER TABLE egg_collection_slots ADD COLUMN IF NOT EXISTS crack_egg INT NOT NULL DEFAULT 0`, 'egg_collection_slots.crack_egg');
    await safe(client, `ALTER TABLE egg_collection_slots ADD COLUMN IF NOT EXISTS waste_reject_egg INT NOT NULL DEFAULT 0`, 'egg_collection_slots.waste_reject_egg');
    await safe(client, `ALTER TABLE egg_collection_slots ADD COLUMN IF NOT EXISTS hatching_egg INT NOT NULL DEFAULT 0`, 'egg_collection_slots.hatching_egg');
    await safe(client, `
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='egg_collection_slots' AND column_name='total_eggs') THEN
          ALTER TABLE egg_collection_slots ADD COLUMN total_eggs INT GENERATED ALWAYS AS (table_egg+jumbo_egg+crack_egg+waste_reject_egg+hatching_egg) STORED;
        END IF;
      END $$
    `, 'egg_collection_slots.total_eggs');

    // 3. cull_sales_header — add missing columns
    await safe(client, `ALTER TABLE cull_sales_header ADD COLUMN IF NOT EXISTS gross_value NUMERIC(12,2) DEFAULT 0`, 'cull_sales_header.gross_value');
    await safe(client, `ALTER TABLE cull_sales_header ADD COLUMN IF NOT EXISTS dc_no_auto VARCHAR(50)`, 'cull_sales_header.dc_no_auto');
    await safe(client, `ALTER TABLE cull_sales_header ADD COLUMN IF NOT EXISTS pdf_link TEXT`, 'cull_sales_header.pdf_link');

    // 4. UNIQUE constraints
    // Drop old UNIQUE (flock_no, collection_date) — wrong, allows only 1 shed per day
    await safe(client, `ALTER TABLE egg_collection_header DROP CONSTRAINT IF EXISTS uq_egg_header_flock_date`, 'drop old egg_header unique');
    await safe(client, `ALTER TABLE egg_collection_header DROP CONSTRAINT IF EXISTS egg_collection_header_flock_no_collection_date_key`, 'drop old egg_header unique2');
    // New UNIQUE — one record per flock + date + shed + part + line
    await safe(client, `ALTER TABLE egg_collection_header ADD CONSTRAINT uq_egg_header_flock_date_shed UNIQUE (flock_no, collection_date, shed_id, part_id, line_id)`, 'egg_collection_header UNIQUE(flock+date+shed+part+line)');
    await safe(client, `ALTER TABLE egg_collection_slots ADD CONSTRAINT uq_slots_header_time UNIQUE (header_id, schedule_time)`, 'egg_collection_slots UNIQUE');
    await safe(client, `ALTER TABLE cull_sales_header ADD CONSTRAINT uq_cull_sales_flock_date UNIQUE (flock_no, entry_date)`, 'cull_sales_header UNIQUE');
    await safe(client, `ALTER TABLE mortality_log ADD CONSTRAINT uq_mortality_flock_shed_date UNIQUE (flock_no, shed_id, part_id, line_id, entry_date)`, 'mortality_log UNIQUE');
    await safe(client, `ALTER TABLE cull_kill_log ADD CONSTRAINT uq_cull_kill_flock_shed_date UNIQUE (flock_no, shed_id, part_id, line_id, entry_date)`, 'cull_kill_log UNIQUE');
    await safe(client, `ALTER TABLE flock_feeding_log ADD CONSTRAINT uq_feeding_flock_date_type_item UNIQUE (flock_no, feed_date, feed_type, item_id)`, 'flock_feeding_log UNIQUE');
    await safe(client, `ALTER TABLE flock_bird_weight ADD CONSTRAINT uq_bird_weight_flock_date UNIQUE (flock_no, weight_date)`, 'flock_bird_weight UNIQUE');

    // 5. Indexes
    await safe(client, `CREATE INDEX IF NOT EXISTS idx_ech_flock_date ON egg_collection_header(flock_no, collection_date)`, 'index egg_collection_header');
    await safe(client, `CREATE INDEX IF NOT EXISTS idx_ecs_header ON egg_collection_slots(header_id)`, 'index egg_collection_slots');
    await safe(client, `CREATE INDEX IF NOT EXISTS idx_ecr_slot ON egg_collection_rows(slot_id)`, 'index egg_collection_rows');

    console.log('\n✅ Done! Run npm start now.\n');
  } catch(err) {
    console.error('Fatal:', err.message);
    process.exit(1);
  } finally {
    client.release();
    process.exit(0);
  }
}
run();
