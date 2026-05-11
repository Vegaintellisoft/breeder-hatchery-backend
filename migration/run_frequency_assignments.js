require('dotenv').config();
const pool = require('../src/config/db');

async function runMigration() {
  const client = await pool.connect();
  try {
    console.log('\n🚀 Assigning activities to all frequencies...\n');
    await client.query('BEGIN');

    // ── Define which activities go to which frequencies ───────────────────
    // Weekly activities (every 7 days)
    const weeklyActivities = [
      'water_ph_tds',         // Water Quality Checking
      'water_sanitation',     // Water Sanitation
      'subtank_cleaning',     // Sub Tank Cleaning
      'linewise_feed_weighing',// Line-wise Feed Weighing
      'feed_shortage',        // Feed Shortage/Excess
      'feather_control',      // Feather Control
      'fly_larvae',           // Fly Larvae Control
      'wet_litter',           // Wet Litter Removal
      'mortality_removal',    // Mortality Removal
      'weak_birds_removal',   // Weak Birds Removal
      'birds_stock',          // Birds Stock
      'daily_egg_prod',       // Daily Egg Production
      'semen_collection_d',   // Semen Collection
      'ai_insemination',      // AI Insemination
      'equipment_check',      // Equipment Check
      'generator_check',      // Generator Check
      'shed_disinfect',       // Shed Disinfection
      'medicine_stock',       // Medicine Stock Check
    ];

    // Fortnightly activities (every 15 days)
    const fortnightlyActivities = [
      'water_ph_tds',
      'subtank_cleaning',
      'linewise_feed_alloc',  // Line-wise Feed Allocation
      'feedbox_marking',      // Feed Box Marking
      'sample_weighing_50kg', // Sample Weighing
      'fly_larvae',
      'litter_lime',          // Litter Treatment
      'adult_fly_spray',      // Adult Fly Spray
      'adult_fly_tape',       // Adult Fly Tape
      'platform_clean',       // Platform Cleaning
      'non_layer_removal',    // Non Layer Removal
      'line_stock_adj',       // Line Stock Adjustment
      'equipment_check',
      'water_pump_check',     // Water Pump Check
      'lighting_check',       // Lighting Check
      'shed_disinfect',
      'corridor_disinfect',   // Corridor Disinfection
    ];

    // Monthly activities (every 30 days)
    const monthlyActivities = [
      'water_ph_tds',
      'subtank_cleaning',
      'linewise_feed_alloc',
      'sample_weighing_50kg',
      'feather_control',
      'fly_larvae',
      'litter_lime',
      'adult_fly_spray',
      'weak_birds_stock',     // Weak Birds Stock
      'cut_line_stock',       // Cut Line Stock
      'used_pp_bags',         // Used PP Bags
      'genset_fuel',          // Genset Fuel Stock
      'semen_collection_d',
      'ai_insemination',
      'equipment_check',
      'generator_check',
      'water_pump_check',
      'lighting_check',
      'egg_dispatch',         // Egg Dispatch
      'reject_egg_sale',      // Reject Egg Sale
      'shed_disinfect',
      'corridor_disinfect',
      'medicine_stock',
    ];

    // Quarterly activities (every 90 days)
    const quarterlyActivities = [
      'water_ph_tds',
      'subtank_cleaning',
      'linewise_feed_alloc',
      'feather_control',
      'equipment_check',
      'generator_check',
      'water_pump_check',
      'lighting_check',
      'shed_disinfect',
      'corridor_disinfect',
      'medicine_stock',
      'genset_fuel',
    ];

    // Bi-annually activities (every 180 days)
    const biAnnuallyActivities = [
      'water_ph_tds',
      'equipment_check',
      'generator_check',
      'water_pump_check',
      'lighting_check',
      'shed_disinfect',
      'corridor_disinfect',
      'medicine_stock',
    ];

    const frequencyMap = {
      'weekly':       weeklyActivities,
      'fortnightly':  fortnightlyActivities,
      'monthly':      monthlyActivities,
      'quarterly':    quarterlyActivities,
      'bi_annually':  biAnnuallyActivities,
    };

    let totalInserted = 0;

    for (const [frequency, codes] of Object.entries(frequencyMap)) {
      let inserted = 0;
      for (const code of codes) {
        // Get activity id by code
        const actRes = await client.query(
          `SELECT id FROM activities WHERE code = $1`, [code]
        );
        if (actRes.rowCount === 0) {
          console.log(`  ⚠️  Activity not found: ${code}`);
          continue;
        }
        const actId = actRes.rows[0].id;

        await client.query(`
          INSERT INTO activity_frequency_assignments
            (activity_id, frequency, is_active, image_required, sample_fields_required)
          VALUES ($1, $2, TRUE, FALSE, FALSE)
          ON CONFLICT (activity_id, frequency) DO UPDATE SET
            is_active = TRUE
        `, [actId, frequency]);
        inserted++;
      }
      console.log(`  ✔ ${frequency}: ${inserted} activities assigned`);
      totalInserted += inserted;
    }

    await client.query('COMMIT');
    console.log(`\n✅ Done! Total assignments: ${totalInserted}`);
    console.log('\nNow test:');
    console.log('  GET /api/mobile/activities?frequency=weekly');
    console.log('  GET /api/mobile/activities?frequency=fortnightly');
    console.log('  GET /api/mobile/activities?frequency=monthly');
    console.log('  GET /api/mobile/activities?frequency=quarterly');
    console.log('  GET /api/mobile/activities?frequency=bi_annually\n');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration();
