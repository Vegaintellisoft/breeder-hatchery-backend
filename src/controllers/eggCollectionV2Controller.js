/**
 * eggCollectionV2Controller.js — matches actual DB structure
 *
 * DB Tables (from breeder_db1.sql):
 *   egg_collection_header  — flock_no, plant_code, collection_date, age_days, season, shed_id, part_id, line_id
 *   egg_collection_slots   — header_id, schedule_time, table_egg, jumbo_egg, crack_egg, waste_reject_egg, hatching_egg, total_eggs(generated), egg_weight, egg_weight_time
 *   egg_collection_rows    — slot_id, header_id, sno, shed_id, part_id, line_id, T, J, C, W, HE, total_eggs(generated)
 *   egg_collection_summary_v2 — header_id, slot_id, summary_type, schedule_time, T,J,C,W,HE,total_eggs
 */

const pool = require('../config/db');
const { parseDate, todayDate, formatRow } = require('../utils/dateUtils');

const SCHEDULE_SLOTS = ['7-8','9-10','11-12','1-2','3-4','5-6','7-8pm'];

async function getActiveEggTypes(client = pool) {
  const r = await client.query(
    `SELECT id, egg_type_id, egg_type_name, sap_field_key, sort_order
     FROM egg_type_lookup
     WHERE is_active=TRUE
     ORDER BY sort_order, egg_type_id`
  );
  return r.rows;
}

function computeTotalsFromItems(items = [], eggTypes = []) {
  const fieldById = new Map(eggTypes.map((e) => [e.egg_type_id, e.sap_field_key]));
  const totals = {
    table_egg: 0,
    jumbo_egg: 0,
    crack_egg: 0,
    waste_reject_egg: 0,
    hatching_egg: 0,
  };

  for (const item of items) {
    const eggTypeId = String(item.egg_type_id || '').trim();
    if (!eggTypeId) continue;
    const key = fieldById.get(eggTypeId);
    if (!key) continue;
    totals[key] += parseInt(item.qty) || 0;
  }
  return totals;
}

function buildEggTypeItemsFromTotals(totals = {}, eggTypes = []) {
  return eggTypes.map((eggType) => ({
    egg_type_id: eggType.egg_type_id,
    egg_type_name: eggType.egg_type_name,
    sap_field_key: eggType.sap_field_key,
    qty: parseInt(totals[eggType.sap_field_key]) || 0,
  }));
}

exports.getEggTypes = async (req, res) => {
  try {
    const data = await getActiveEggTypes();
    return res.json({ success: true, total: data.length, data });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/egg-collection/v2/dropdowns?plant_code=&flock_no=
exports.getDropdowns = async (req, res) => {
  try {
    const { plant_code, flock_no } = req.query;
    let age_days = null, flock_name = null;
    if (flock_no) {
      const fr = await pool.query(`SELECT flock_name, hatchery_date FROM flock_master WHERE flock_no=$1`, [flock_no]);
      if (fr.rowCount > 0) {
        flock_name = fr.rows[0].flock_name;
        if (fr.rows[0].hatchery_date) {
          const IST = 5.5*60*60*1000;
          const ist = new Date(new Date().getTime()+IST);
          const hatch = new Date(fr.rows[0].hatchery_date);
          age_days = Math.floor((ist - hatch) / 86400000);
        }
      }
    }
    let sheds = [];
    if (plant_code) {
      const sr = await pool.query(`SELECT id, shed_no, shed_name FROM shed_master WHERE plant_code=$1 AND is_active=TRUE ORDER BY shed_no`, [plant_code]);
      sheds = sr.rows;
    }
    const egg_types = await getActiveEggTypes();
    return res.json({
      success:true,
      data:{
        flock_name,
        age_days,
        sheds,
        egg_types,
        schedule_slots:SCHEDULE_SLOTS,
        seasons:['Summer','Winter','Rainy','Spring']
      }
    });
  } catch(err) { return res.status(500).json({ success:false, message:err.message }); }
};

// GET /api/egg-collection/v2/sheds?plant_code=1902
exports.getSheds = async (req, res) => {
  try {
    const { plant_code } = req.query;
    if (!plant_code) return res.status(400).json({ success:false, message:'plant_code required' });
    const r = await pool.query(`SELECT id, shed_no, shed_name FROM shed_master WHERE plant_code=$1 AND is_active=TRUE ORDER BY shed_no`, [plant_code]);
    return res.json({ success:true, data:r.rows });
  } catch(err) { return res.status(500).json({ success:false, message:err.message }); }
};

// GET /api/egg-collection/v2/parts?shed_id=1
exports.getParts = async (req, res) => {
  try {
    const { shed_id } = req.query;
    if (!shed_id) return res.status(400).json({ success:false, message:'shed_id required' });
    const r = await pool.query(`SELECT id, part_row_no, cum_birds FROM shed_part_master WHERE shed_id=$1 AND is_active=TRUE ORDER BY part_row_no`, [shed_id]);
    return res.json({ success:true, data:r.rows });
  } catch(err) { return res.status(500).json({ success:false, message:err.message }); }
};

// GET /api/egg-collection/v2/lines?part_id=1
exports.getLines = async (req, res) => {
  try {
    const { part_id } = req.query;
    if (!part_id) return res.status(400).json({ success:false, message:'part_id required' });
    const r = await pool.query(`SELECT id, line_no, male_birds, female_birds, total_birds FROM shed_line_master WHERE part_id=$1 AND is_active=TRUE ORDER BY line_no`, [part_id]);
    return res.json({ success:true, data:r.rows });
  } catch(err) { return res.status(500).json({ success:false, message:err.message }); }
};

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/egg-collection/v2/save
// Body: {
//   flock_no, plant_code, collection_date, age_days, season, shed_id, part_id, line_id,
//   slots: [{ schedule_time, egg_weight_time, egg_weight,
//             rows: [{ shed_id, part_id, line_id, table_egg, jumbo_egg, crack_egg, waste_reject_egg, hatching_egg }] }]
// }
// ═══════════════════════════════════════════════════════════════════════════
exports.saveCollection = async (req, res) => {
  const client = await pool.connect();
  try {
    const { flock_no, plant_code, order_no, collection_date: raw_date, age_days, season,
            slots = [] } = req.body;
    const collection_date = parseDate(raw_date);

    if (!flock_no || !plant_code || !collection_date)
      return res.status(422).json({ success:false, message:'flock_no, plant_code, collection_date required' });
    if (!slots.length)
      return res.status(422).json({ success:false, message:'slots array required' });

    await client.query('BEGIN');
    const eggTypes = await getActiveEggTypes(client);

    // ── 1. Upsert header ──────────────────────────────────────────────────
    const hRes = await client.query(
      `INSERT INTO egg_collection_header
         (flock_no, plant_code, order_no, collection_date, age_days, season, entered_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (flock_no, plant_code, collection_date)
       DO UPDATE SET order_no=$3, age_days=$5, season=$6, updated_at=NOW()
       RETURNING *`,
      [flock_no, plant_code, order_no || null, collection_date, age_days||null, season||null,
       req.user?.id||null]
    );
    const headerId = hRes.rows[0].id;
    const savedSlots = [];
    let grandTotals = { table_egg:0, jumbo_egg:0, crack_egg:0, waste_reject_egg:0, hatching_egg:0, total_eggs:0 };

    for (const slot of slots) {
      const { schedule_time, egg_weight_time=null, egg_weight=null, rows=[] } = slot;
      if (!schedule_time) return res.status(422).json({ success:false, message:'schedule_time required in each slot' });

      // Aggregate T,J,C,W,HE from all rows in this slot
      const totals = { table_egg:0, jumbo_egg:0, crack_egg:0, waste_reject_egg:0, hatching_egg:0 };
      for (const row of rows) {
        // New format: row.egg_type_items = [{ egg_type_id, qty }]
        const itemTotals = Array.isArray(row.egg_type_items)
          ? computeTotalsFromItems(row.egg_type_items, eggTypes)
          : null;

        totals.table_egg        += itemTotals ? itemTotals.table_egg : (parseInt(row.table_egg)||0);
        totals.jumbo_egg        += itemTotals ? itemTotals.jumbo_egg : (parseInt(row.jumbo_egg)||0);
        totals.crack_egg        += itemTotals ? itemTotals.crack_egg : (parseInt(row.crack_egg)||0);
        totals.waste_reject_egg += itemTotals ? itemTotals.waste_reject_egg : (parseInt(row.waste_reject_egg)||0);
        totals.hatching_egg     += itemTotals ? itemTotals.hatching_egg : (parseInt(row.hatching_egg)||0);
      }

      // ── 2. Upsert slot (stores aggregated totals) ─────────────────────
      const sRes = await client.query(
        `INSERT INTO egg_collection_slots
           (header_id, schedule_time, egg_weight_time, egg_weight,
            table_egg, jumbo_egg, crack_egg, waste_reject_egg, hatching_egg)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (header_id, schedule_time)
         DO UPDATE SET
           egg_weight_time=$3, egg_weight=$4,
           table_egg=$5, jumbo_egg=$6, crack_egg=$7, waste_reject_egg=$8, hatching_egg=$9,
           updated_at=NOW()
         RETURNING *`,
        [headerId, schedule_time, egg_weight_time, egg_weight,
         totals.table_egg, totals.jumbo_egg, totals.crack_egg, totals.waste_reject_egg, totals.hatching_egg]
      );
      const slotId = sRes.rows[0].id;

      // ── 3. Save rows to egg_collection_rows (if table exists) ────────
      const savedRows = [];
      const rowsTableExists = await client.query(
        `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='egg_collection_rows'`
      );
      if (rowsTableExists.rowCount > 0 && rows.length > 0) {
        for (let i=0; i<rows.length; i++) {
          const row = rows[i];
          const { shed_id: rShedId, part_id: rPartId, line_id: rLineId } = row;
          if (!rShedId || !rPartId || !rLineId) continue;

          const itemTotals = Array.isArray(row.egg_type_items)
            ? computeTotalsFromItems(row.egg_type_items, eggTypes)
            : null;
          const t = itemTotals ? itemTotals.table_egg : (parseInt(row.table_egg)||0);
          const j = itemTotals ? itemTotals.jumbo_egg : (parseInt(row.jumbo_egg)||0);
          const c = itemTotals ? itemTotals.crack_egg : (parseInt(row.crack_egg)||0);
          const w = itemTotals ? itemTotals.waste_reject_egg : (parseInt(row.waste_reject_egg)||0);
          const he = itemTotals ? itemTotals.hatching_egg : (parseInt(row.hatching_egg)||0);

          const shedInfo = await client.query(`SELECT shed_no FROM shed_master WHERE id=$1`, [rShedId]);
          const partInfo = await client.query(`SELECT part_row_no FROM shed_part_master WHERE id=$1`, [rPartId]);
          const lineInfo = await client.query(`SELECT line_no FROM shed_line_master WHERE id=$1`, [rLineId]);

          const rRes = await client.query(
            `INSERT INTO egg_collection_rows
               (slot_id, header_id, sno, shed_id, shed_no, part_id, part_row_no, line_id, line_no,
                table_egg, jumbo_egg, crack_egg, waste_reject_egg, hatching_egg)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
             ON CONFLICT (slot_id, shed_id, part_id, line_id)
             DO UPDATE SET sno=$3, shed_no=$5, part_row_no=$7, line_no=$9,
               table_egg=$10, jumbo_egg=$11, crack_egg=$12, waste_reject_egg=$13, hatching_egg=$14,
               updated_at=NOW()
             RETURNING *`,
            [slotId, headerId, i+1,
             rShedId, shedInfo.rows[0]?.shed_no||'',
             rPartId, partInfo.rows[0]?.part_row_no||'',
             rLineId, lineInfo.rows[0]?.line_no||'',
             t, j, c, w, he]
          );
          savedRows.push({
            ...rRes.rows[0],
            egg_type_items: buildEggTypeItemsFromTotals(
              {
                table_egg: t,
                jumbo_egg: j,
                crack_egg: c,
                waste_reject_egg: w,
                hatching_egg: he,
              },
              eggTypes
            ),
          });
        }
      }

      grandTotals.table_egg        += totals.table_egg;
      grandTotals.jumbo_egg        += totals.jumbo_egg;
      grandTotals.crack_egg        += totals.crack_egg;
      grandTotals.waste_reject_egg += totals.waste_reject_egg;
      grandTotals.hatching_egg     += totals.hatching_egg;
      grandTotals.total_eggs       += (totals.table_egg+totals.jumbo_egg+totals.crack_egg+totals.waste_reject_egg+totals.hatching_egg);

      savedSlots.push({
        ...sRes.rows[0],
        egg_type_items: buildEggTypeItemsFromTotals(totals, eggTypes),
        rows:savedRows,
        summary:totals
      });
    }

    await client.query('COMMIT');

    return res.status(201).json({
      success:true,
      message: 'Egg collection saved',
      data: {
        id:headerId,
        flock_no,
        plant_code,
        order_no: order_no || null,
        collection_date,
        age_days,
        season,
        egg_types: eggTypes,
        slots:savedSlots,
        grand_summary: {
          ...grandTotals,
          egg_type_items: buildEggTypeItemsFromTotals(grandTotals, eggTypes),
        }
      }
    });
  } catch(err) {
    await client.query('ROLLBACK');
    console.error('[saveCollection v2] FULL ERROR:', err.message);
    console.error('[saveCollection v2] DETAIL:', err.detail);
    console.error('[saveCollection v2] CONSTRAINT:', err.constraint);
    console.error('[saveCollection v2] TABLE:', err.table);
    return res.status(500).json({ success:false, message:err.message, detail:err.detail, constraint:err.constraint, table:err.table });
  } finally { client.release(); }
};

// GET /api/egg-collection/v2/entry?flock_no=&date=
exports.getEntry = async (req, res) => {
  try {
    const { flock_no, date } = req.query;
    if (!flock_no || !date) return res.status(400).json({ success:false, message:'flock_no and date required' });

    const hRes = await pool.query(
      `SELECT h.*, TO_CHAR(h.collection_date,'YYYY-MM-DD') AS collection_date,
              COALESCE(f.plant_name,h.plant_code) AS plant_name,
              COALESCE(fm.flock_name,h.flock_no) AS flock_name
       FROM egg_collection_header h
       LEFT JOIN farms f ON f.plant_code=h.plant_code
       LEFT JOIN flock_master fm ON fm.flock_no=h.flock_no
       WHERE h.flock_no=$1 AND h.collection_date=$2 LIMIT 1`,
      [flock_no, date]
    );
    if (!hRes.rowCount) return res.json({ success:true, has_entry:false, flock_no, date, data:null });
    const header = hRes.rows[0];

    const slotsRes = await pool.query(`SELECT * FROM egg_collection_slots WHERE header_id=$1 ORDER BY id`, [header.id]);
    const eggTypes = await getActiveEggTypes();

    const slots = [];
    for (const slot of slotsRes.rows) {
      // Get rows if table exists
      let rowsData = [];
      try {
        const rowsRes = await pool.query(`SELECT * FROM egg_collection_rows WHERE slot_id=$1 ORDER BY sno`, [slot.id]);
        rowsData = rowsRes.rows;
      } catch(e) { /* rows table may not exist */ }

      const summary = {
        table_egg:        slot.table_egg,
        jumbo_egg:        slot.jumbo_egg,
        crack_egg:        slot.crack_egg,
        waste_reject_egg: slot.waste_reject_egg,
        hatching_egg:     slot.hatching_egg,
        total_eggs:       slot.total_eggs,
      };
      slots.push({
        ...slot,
        egg_type_items: buildEggTypeItemsFromTotals(summary, eggTypes),
        rows: rowsData.map((r) => ({
          ...r,
          egg_type_items: buildEggTypeItemsFromTotals(r, eggTypes),
        })),
        summary
      });
    }

    // Grand total from slots
    const grand = slots.reduce((acc, s) => {
      acc.table_egg        += s.table_egg||0;
      acc.jumbo_egg        += s.jumbo_egg||0;
      acc.crack_egg        += s.crack_egg||0;
      acc.waste_reject_egg += s.waste_reject_egg||0;
      acc.hatching_egg     += s.hatching_egg||0;
      acc.total_eggs       += s.total_eggs||0;
      return acc;
    }, { table_egg:0, jumbo_egg:0, crack_egg:0, waste_reject_egg:0, hatching_egg:0, total_eggs:0 });

    return res.json({
      success:true,
      has_entry:true,
      flock_no,
      date,
      data:{
        ...header,
        egg_types: eggTypes,
        slots,
        grand_summary:{
          ...grand,
          egg_type_items: buildEggTypeItemsFromTotals(grand, eggTypes),
        }
      }
    });
  } catch(err) { return res.status(500).json({ success:false, message:err.message }); }
};

// GET /api/egg-collection/v2/list
exports.listCollections = async (req, res) => {
  try {
    const { flock_no, plant_code, date, from_date, to_date, limit=20, offset=0 } = req.query;
    const conds=[], vals=[]; let idx=1;
    if (flock_no)   { conds.push(`h.flock_no=$${idx++}`);         vals.push(flock_no); }
    if (plant_code) { conds.push(`h.plant_code=$${idx++}`);       vals.push(plant_code); }
    if (date)       { conds.push(`h.collection_date=$${idx++}`);  vals.push(date); }
    if (from_date)  { conds.push(`h.collection_date>=$${idx++}`); vals.push(from_date); }
    if (to_date)    { conds.push(`h.collection_date<=$${idx++}`); vals.push(to_date); }
    const where = conds.length ? 'WHERE '+conds.join(' AND ') : '';

    const countRes = await pool.query(`SELECT COUNT(*) FROM egg_collection_header h ${where}`, vals);
    const total = parseInt(countRes.rows[0].count);
    vals.push(parseInt(limit)); const li=idx++;
    vals.push(parseInt(offset)); const oi=idx++;

    const result = await pool.query(
      `SELECT h.id,
              TO_CHAR(h.collection_date,'YYYY-MM-DD') AS collection_date,
              h.flock_no,
              h.order_no,
              COALESCE(fm.flock_name,h.flock_no) AS flock_name,
              h.plant_code,
              COALESCE(f.plant_name,h.plant_code) AS plant_name,
              h.age_days, h.season,
              COALESCE(h.sap_synced,FALSE) AS sap_synced,
              h.sap_synced_at,
              sv.table_egg, sv.jumbo_egg, sv.crack_egg,
              sv.waste_reject_egg, sv.hatching_egg, sv.total_eggs,
              h.created_at
       FROM egg_collection_header h
       LEFT JOIN farms f ON f.plant_code=h.plant_code
       LEFT JOIN flock_master fm ON fm.flock_no=h.flock_no
       LEFT JOIN (
         SELECT header_id,
                SUM(table_egg) AS table_egg, SUM(jumbo_egg) AS jumbo_egg,
                SUM(crack_egg) AS crack_egg, SUM(waste_reject_egg) AS waste_reject_egg,
                SUM(hatching_egg) AS hatching_egg, SUM(total_eggs) AS total_eggs
         FROM egg_collection_slots GROUP BY header_id
       ) sv ON sv.header_id=h.id
       ${where}
       ORDER BY h.collection_date DESC, h.id DESC
       LIMIT $${li} OFFSET $${oi}`,
      vals
    );
    return res.json({ success:true, total, limit:parseInt(limit), offset:parseInt(offset),
      data: result.rows.map((r,i)=>({sno:parseInt(offset)+i+1,...formatRow(r)})) });
  } catch(err) { return res.status(500).json({ success:false, message:err.message }); }
};

// DELETE /api/egg-collection/v2/:id
exports.deleteCollection = async (req, res) => {
  try {
    await pool.query(`DELETE FROM egg_collection_header WHERE id=$1`, [req.params.id]);
    return res.json({ success:true, message:'Egg collection deleted' });
  } catch(err) { return res.status(500).json({ success:false, message:err.message }); }
};
