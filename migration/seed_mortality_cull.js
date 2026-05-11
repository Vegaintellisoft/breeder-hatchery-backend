// seed_mortality_cull.js
// Run: node migration/seed_mortality_cull.js
// Seeds test data for mortality_log, cull_kill_log and their reason logs
// Uses existing shed/part/line/flock/plant data from migrations

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const pool = require("../src/config/db");

async function seed() {
  const client = await pool.connect();
  try {
    console.log('🌱 Seeding mortality and cull kill test data...\n');

    // ── Get shed/part/line IDs from DB ──────────────────────────────────
    const shedRes = await client.query(
      `SELECT id, shed_no, plant_code FROM shed_master ORDER BY id LIMIT 6`
    );
    if (!shedRes.rowCount) {
      console.error('❌ No sheds found. Run run_mortality_cull.js migration first.');
      return;
    }

    const shed1 = shedRes.rows[0]; // SH-01, plant 1902
    const shed2 = shedRes.rows[1] || shed1;

    const partRes = await client.query(
      `SELECT id, part_row_no FROM shed_part_master WHERE shed_id = $1 LIMIT 3`,
      [shed1.id]
    );
    const part1 = partRes.rows[0];
    const part2 = partRes.rows[1] || part1;

    const lineRes = await client.query(
      `SELECT id, line_no FROM shed_line_master WHERE part_id = $1 LIMIT 2`,
      [part1.id]
    );
    const line1 = lineRes.rows[0];
    const line2 = lineRes.rows[1] || line1;

    // ── Get reason IDs ───────────────────────────────────────────────────
    const mortReasons = await client.query(
      `SELECT id, reason_name FROM mortality_reason_master WHERE is_active=TRUE LIMIT 4`
    );
    const cullReasons = await client.query(
      `SELECT id, reason_name FROM cull_kill_reason_master WHERE is_active=TRUE LIMIT 4`
    );

    const mr = mortReasons.rows;
    const cr = cullReasons.rows;

    console.log(`  Shed: ${shed1.shed_no} (id=${shed1.id}), Plant: ${shed1.plant_code}`);
    console.log(`  Part: ${part1.part_row_no} (id=${part1.id})`);
    console.log(`  Line: ${line1.line_no} (id=${line1.id})`);
    console.log(`  Mortality reasons: ${mr.map(r=>r.reason_name).join(', ')}`);
    console.log(`  Cull reasons:      ${cr.map(r=>r.reason_name).join(', ')}\n`);

    // ── MORTALITY DATA ───────────────────────────────────────────────────
    const mortalityData = [
      // { flock_no, plant_code, shed_id, part_id, line_id, entry_date, cum_birds,
      //   total_male, total_female,
      //   mm, mf, am, af, em, ef,
      //   reasons: [{reason_id, reason_name, male, female, remarks}] }
      {
        flock_no: 'LY000001', plant_code: shed1.plant_code,
        shed_id: shed1.id, part_id: part1.id, line_id: line1.id,
        entry_date: '2026-04-10', cum_birds: 9436, total_male: 989, total_female: 8447,
        mm: 2, mf: 3, am: 1, af: 1, em: 0, ef: 1,
        reasons: [{ id: mr[0]?.id, name: mr[0]?.reason_name || 'Disease', male: 3, female: 5, remarks: 'Respiratory infection' }]
      },
      {
        flock_no: 'LY000001', plant_code: shed1.plant_code,
        shed_id: shed1.id, part_id: part1.id, line_id: line1.id,
        entry_date: '2026-04-11', cum_birds: 9428, total_male: 986, total_female: 8442,
        mm: 1, mf: 2, am: 0, af: 1, em: 1, ef: 0,
        reasons: [{ id: mr[1]?.id, name: mr[1]?.reason_name || 'Injury', male: 2, female: 3, remarks: '' }]
      },
      {
        flock_no: 'LY000001', plant_code: shed1.plant_code,
        shed_id: shed1.id, part_id: part2.id, line_id: line2?.id || line1.id,
        entry_date: '2026-04-12', cum_birds: 9420, total_male: 984, total_female: 8436,
        mm: 3, mf: 4, am: 2, af: 1, em: 1, ef: 2,
        reasons: [
          { id: mr[0]?.id, name: mr[0]?.reason_name || 'Disease',  male: 4, female: 5, remarks: 'Viral' },
          { id: mr[2]?.id, name: mr[2]?.reason_name || 'Weakness', male: 2, female: 2, remarks: '' }
        ]
      },
      {
        flock_no: 'LY000001', plant_code: shed1.plant_code,
        shed_id: shed2.id, part_id: part1.id, line_id: line1.id,
        entry_date: '2026-04-13', cum_birds: 9407, total_male: 981, total_female: 8426,
        mm: 0, mf: 2, am: 1, af: 1, em: 0, ef: 1,
        reasons: [{ id: mr[1]?.id, name: mr[1]?.reason_name || 'Injury', male: 1, female: 4, remarks: 'Found dead' }]
      },
      {
        flock_no: 'LY000001', plant_code: shed1.plant_code,
        shed_id: shed1.id, part_id: part1.id, line_id: line1.id,
        entry_date: '2026-04-14', cum_birds: 9402, total_male: 980, total_female: 8422,
        mm: 1, mf: 1, am: 0, af: 2, em: 1, ef: 0,
        reasons: [{ id: mr[0]?.id, name: mr[0]?.reason_name || 'Disease', male: 2, female: 3, remarks: '' }]
      },
    ];

    console.log('Inserting mortality records...');
    for (const d of mortalityData) {
      const tmc = d.mm + d.am + d.em;
      const tfc = d.mf + d.af + d.ef;
      const tq  = tmc + tfc;

      const logRes = await client.query(
        `INSERT INTO mortality_log
           (flock_no, plant_code, shed_id, part_id, line_id, entry_date,
            cum_birds, total_male, total_female,
            morning_male, morning_female, morning_qty,
            afternoon_male, afternoon_female, afternoon_qty,
            evening_male, evening_female, evening_qty,
            total_qty)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
         ON CONFLICT (flock_no, shed_id, part_id, line_id, entry_date)
         DO UPDATE SET
           morning_male=$10, morning_female=$11, morning_qty=$12,
           afternoon_male=$13, afternoon_female=$14, afternoon_qty=$15,
           evening_male=$16, evening_female=$17, evening_qty=$18,
           total_male=$8, total_female=$9, total_qty=$19,
           updated_at=NOW()
         RETURNING id`,
        [
          d.flock_no, d.plant_code, d.shed_id, d.part_id, d.line_id, d.entry_date,
          d.cum_birds, d.total_male, d.total_female,
          d.mm, d.mf, d.mm+d.mf,
          d.am, d.af, d.am+d.af,
          d.em, d.ef, d.em+d.ef,
          tq
        ]
      );

      const mortId = logRes.rows[0].id;
      await client.query(`DELETE FROM mortality_reason_log WHERE mortality_id=$1`, [mortId]);
      for (const r of d.reasons) {
        await client.query(
          `INSERT INTO mortality_reason_log (mortality_id, reason_id, reason_name, male_count, female_count, total_count, remarks)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [mortId, r.id || null, r.name, r.male, r.female, r.male + r.female, r.remarks || '']
        );
      }
      console.log(`  ✔ Mortality ${d.entry_date} | ${d.flock_no} | ${d.shed_id} | total=${tq}`);
    }

    // ── CULL KILL DATA ───────────────────────────────────────────────────
    const cullData = [
      {
        flock_no: 'LY000001', plant_code: shed1.plant_code,
        shed_id: shed1.id, part_id: part1.id, line_id: line1.id,
        entry_date: '2026-04-10', cum_birds: 9436, total_male: 989, total_female: 8447,
        mm: 1, mf: 2, am: 0, af: 1, em: 1, ef: 1,
        reasons: [{ id: cr[0]?.id, name: cr[0]?.reason_name || 'Injured', male: 2, female: 4, remarks: 'Leg injury' }]
      },
      {
        flock_no: 'LY000001', plant_code: shed1.plant_code,
        shed_id: shed1.id, part_id: part1.id, line_id: line1.id,
        entry_date: '2026-04-11', cum_birds: 9430, total_male: 987, total_female: 8443,
        mm: 0, mf: 1, am: 1, af: 1, em: 0, ef: 0,
        reasons: [{ id: cr[1]?.id, name: cr[1]?.reason_name || 'Sick', male: 1, female: 2, remarks: '' }]
      },
      {
        flock_no: 'LY000001', plant_code: shed1.plant_code,
        shed_id: shed2.id, part_id: part1.id, line_id: line1.id,
        entry_date: '2026-04-12', cum_birds: 9425, total_male: 985, total_female: 8440,
        mm: 2, mf: 3, am: 1, af: 2, em: 0, ef: 1,
        reasons: [
          { id: cr[0]?.id, name: cr[0]?.reason_name || 'Injured', male: 3, female: 4, remarks: 'Wing injury' },
          { id: cr[2]?.id, name: cr[2]?.reason_name || 'Culled',  male: 0, female: 2, remarks: 'Poor layer' }
        ]
      },
      {
        flock_no: 'LY000001', plant_code: shed1.plant_code,
        shed_id: shed1.id, part_id: part2.id, line_id: line2?.id || line1.id,
        entry_date: '2026-04-13', cum_birds: 9416, total_male: 982, total_female: 8434,
        mm: 1, mf: 1, am: 0, af: 1, em: 1, ef: 0,
        reasons: [{ id: cr[1]?.id, name: cr[1]?.reason_name || 'Sick', male: 2, female: 2, remarks: '' }]
      },
      {
        flock_no: 'LY000001', plant_code: shed1.plant_code,
        shed_id: shed1.id, part_id: part1.id, line_id: line1.id,
        entry_date: '2026-04-14', cum_birds: 9408, total_male: 980, total_female: 8428,
        mm: 0, mf: 2, am: 1, af: 1, em: 0, ef: 1,
        reasons: [{ id: cr[0]?.id, name: cr[0]?.reason_name || 'Injured', male: 1, female: 4, remarks: 'Pecking injury' }]
      },
    ];

    console.log('\nInserting cull kill records...');
    for (const d of cullData) {
      const tmc = d.mm + d.am + d.em;
      const tfc = d.mf + d.af + d.ef;
      const tq  = tmc + tfc;

      const logRes = await client.query(
        `INSERT INTO cull_kill_log
           (flock_no, plant_code, shed_id, part_id, line_id, entry_date,
            cum_birds, total_male, total_female,
            morning_male, morning_female, morning_qty,
            afternoon_male, afternoon_female, afternoon_qty,
            evening_male, evening_female, evening_qty,
            total_qty)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
         ON CONFLICT (flock_no, shed_id, part_id, line_id, entry_date)
         DO UPDATE SET
           morning_male=$10, morning_female=$11, morning_qty=$12,
           afternoon_male=$13, afternoon_female=$14, afternoon_qty=$15,
           evening_male=$16, evening_female=$17, evening_qty=$18,
           total_male=$8, total_female=$9, total_qty=$19,
           updated_at=NOW()
         RETURNING id`,
        [
          d.flock_no, d.plant_code, d.shed_id, d.part_id, d.line_id, d.entry_date,
          d.cum_birds, d.total_male, d.total_female,
          d.mm, d.mf, d.mm+d.mf,
          d.am, d.af, d.am+d.af,
          d.em, d.ef, d.em+d.ef,
          tq
        ]
      );

      const cullId = logRes.rows[0].id;
      await client.query(`DELETE FROM cull_kill_reason_log WHERE cull_kill_id=$1`, [cullId]);
      for (const r of d.reasons) {
        await client.query(
          `INSERT INTO cull_kill_reason_log (cull_kill_id, reason_id, reason_name, male_count, female_count, total_count, remarks)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [cullId, r.id || null, r.name, r.male, r.female, r.male + r.female, r.remarks || '']
        );
      }
      console.log(`  ✔ Cull Kill ${d.entry_date} | ${d.flock_no} | shed=${d.shed_id} | total=${tq}`);
    }

    // ── FEED DATA ────────────────────────────────────────────────────────
    console.log('\nInserting feed/water/medicine data...');
    const plant = shed1.plant_code;

    // Get item IDs
    const feedItems  = await client.query(`SELECT id, item_name, uom FROM feed_master     WHERE is_active=TRUE LIMIT 2`);
    const waterItems = await client.query(`SELECT id, item_name, uom FROM water_master    WHERE is_active=TRUE LIMIT 1`);
    const medItems   = await client.query(`SELECT id, item_name, uom FROM medicine_master WHERE is_active=TRUE LIMIT 1`);

    const feedDates = ['2026-04-10','2026-04-11','2026-04-12','2026-04-13','2026-04-14'];

    for (const date of feedDates) {
      // Feed items
      for (const item of feedItems.rows) {
        await client.query(
          `INSERT INTO flock_feeding_log
             (flock_no, plant_code, feed_date, feed_type, item_id, item_name, uom,
              qty_issued_male, qty_issued_female, stock_in_bags, cum_feed)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           ON CONFLICT (flock_no, feed_date, feed_type, item_id)
           DO UPDATE SET qty_issued_male=$8, qty_issued_female=$9, updated_at=NOW()`,
          ['LY000001', plant, date, 'feed', item.id, item.item_name, item.uom,
           10 + Math.floor(Math.random()*5), 15 + Math.floor(Math.random()*5), 200, 500]
        );
      }
      // Water
      for (const item of waterItems.rows) {
        await client.query(
          `INSERT INTO flock_feeding_log
             (flock_no, plant_code, feed_date, feed_type, item_id, item_name, uom,
              qty_issued_male, qty_issued_female, stock_in_bags, cum_feed)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           ON CONFLICT (flock_no, feed_date, feed_type, item_id)
           DO UPDATE SET qty_issued_male=$8, qty_issued_female=$9, updated_at=NOW()`,
          ['LY000001', plant, date, 'water', item.id, item.item_name, item.uom,
           500, 800, 5000, 15000]
        );
      }
      // Medicine
      for (const item of medItems.rows) {
        await client.query(
          `INSERT INTO flock_feeding_log
             (flock_no, plant_code, feed_date, feed_type, item_id, item_name, uom,
              qty_issued_male, qty_issued_female, stock_in_bags, cum_feed)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           ON CONFLICT (flock_no, feed_date, feed_type, item_id)
           DO UPDATE SET qty_issued_male=$8, qty_issued_female=$9, updated_at=NOW()`,
          ['LY000001', plant, date, 'medicine', item.id, item.item_name, item.uom,
           2, 3, 50, 100]
        );
      }
    }
    console.log(`  ✔ Feed/Water/Medicine for 5 dates (2026-04-10 to 2026-04-14)`);

    // ── flock_daily_activity for stage ───────────────────────────────────
    console.log('\nInserting flock_daily_activity (stage) records...');
    for (const date of feedDates) {
      await client.query(
        `INSERT INTO flock_daily_activity
           (flock_no, plant_code, activity_date, stage, age_days)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (flock_no, activity_date) DO UPDATE SET stage=$4, updated_at=NOW()`,
        ['LY000001', plant, date, 'Laying', 280 + feedDates.indexOf(date)]
      );
    }
    console.log(`  ✔ Stage = "Laying" for all 5 dates`);

    console.log('\n✅ Seed complete!');
    console.log('   5 mortality entries  → GET /api/admin/grid/mortality');
    console.log('   5 cull kill entries  → GET /api/admin/grid/cull-kill');
    console.log('   5 dates feed data    → GET /api/admin/grid/daily-feed');

  } catch (err) {
    console.error('❌ Seed error:', err.message);
    process.exit(1);
    console.error(err.stack);
  } finally {
    client.release();
    process.exit(0);
  }
}

seed();
