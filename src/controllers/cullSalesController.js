const { parseDate, todayDate, formatRow } = require('../utils/dateUtils');
const pool    = require('../config/db');
const puppeteer = require('puppeteer');
const ejs       = require('ejs');
const path      = require('path');
const fs        = require('fs');

// ── to-words for bill amount in words ─────────────────────────────────────
let toWords;
try {
  const { ToWords } = require('to-words');
  toWords = new ToWords({ localeCode:'en-IN', converterOptions:{ currency:true, ignoreDecimal:false } });
} catch(e) {
  toWords = { convert: (n) => `Rs. ${n}` };
}

// ═══════════════════════════════════════════════════════════════════════════
// STEP 1 DROPDOWNS
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/cull-sales/flocks?plant_code=1902
exports.getFlocks = async (req, res) => {
  const { plant_code } = req.query;
  if (!plant_code) return res.status(422).json({ success:false, message:'plant_code required' });
  try {
    const r = await pool.query(`
      SELECT flock_no, flock_name, farm_code,
        CASE WHEN hatchery_date IS NOT NULL
             THEN (CURRENT_DATE - hatchery_date::date) ELSE 0 END AS age_days,
        CASE
          WHEN hatchery_date IS NULL THEN 'Laying'
          WHEN (CURRENT_DATE - hatchery_date::date) <= 42  THEN 'Brooming'
          WHEN (CURRENT_DATE - hatchery_date::date) <= 126 THEN 'Grooming'
          ELSE 'Laying'
        END AS stage
      FROM flock_master
      WHERE (farm_code=$1 OR farm_code LIKE '%'||$1||'%')
        AND status='A' AND COALESCE(deletion_flag,'') != 'X'
      ORDER BY flock_no
    `, [plant_code]);
    return res.json({ success:true, data: r.rows.map(f => ({
      flock_no:   f.flock_no,
      flock_name: f.flock_name || f.flock_no,
      age_days:   parseInt(f.age_days)||0,
      stage:      f.stage,
      label:      `${f.flock_no} — ${f.flock_name||f.flock_no}`
    }))});
  } catch(err) { return res.status(500).json({ success:false, message:err.message }); }
};

// GET /api/cull-sales/sheds?plant_code=1902
exports.getSheds = async (req, res) => {
  const { plant_code } = req.query;
  if (!plant_code) return res.status(422).json({ success:false, message:'plant_code required' });
  try {
    const r = await pool.query(
      `SELECT id, shed_no, shed_name FROM shed_master WHERE plant_code=$1 AND is_active=TRUE ORDER BY shed_no`,
      [plant_code]
    );
    return res.json({ success:true, data: r.rows.map(s => ({
      id: s.id, shed_no: s.shed_no, shed_name: s.shed_name,
      label: `${s.shed_no} — ${s.shed_name||s.shed_no}`
    }))});
  } catch(err) { return res.status(500).json({ success:false, message:err.message }); }
};

// GET /api/cull-sales/parts?shed_id=1
exports.getParts = async (req, res) => {
  const { shed_id } = req.query;
  if (!shed_id) return res.status(422).json({ success:false, message:'shed_id required' });
  try {
    const r = await pool.query(
      `SELECT id, part_row_no, cum_birds FROM shed_part_master WHERE shed_id=$1 AND is_active=TRUE ORDER BY part_row_no`,
      [shed_id]
    );
    return res.json({ success:true, data: r.rows.map(p => ({
      id: p.id, part_row_no: p.part_row_no, cum_birds: p.cum_birds,
      label: `Part/Row ${p.part_row_no} (${p.cum_birds} birds)`
    }))});
  } catch(err) { return res.status(500).json({ success:false, message:err.message }); }
};

// GET /api/cull-sales/lines?part_id=1
// Returns lines + auto-fills batch(flock_no), age, bird_stock
exports.getLines = async (req, res) => {
  const { part_id } = req.query;
  if (!part_id) return res.status(422).json({ success:false, message:'part_id required' });
  try {
    const partRes = await pool.query(
      `SELECT sp.cum_birds, sm.shed_no, sm.plant_code
       FROM shed_part_master sp JOIN shed_master sm ON sm.id=sp.shed_id
       WHERE sp.id=$1`, [part_id]
    );
    const lineRes = await pool.query(
      `SELECT id, line_no, male_birds, female_birds, total_birds
       FROM shed_line_master WHERE part_id=$1 AND is_active=TRUE ORDER BY line_no`,
      [part_id]
    );
    return res.json({
      success:   true,
      cum_birds: partRes.rows[0]?.cum_birds || 0,
      data: lineRes.rows.map(l => ({
        id:           l.id,
        line_no:      l.line_no,
        male_birds:   l.male_birds,
        female_birds: l.female_birds,
        total_birds:  l.total_birds,
        label:        `Line ${l.line_no} (M:${l.male_birds} F:${l.female_birds})`,
      }))
    });
  } catch(err) { return res.status(500).json({ success:false, message:err.message }); }
};

// ═══════════════════════════════════════════════════════════════════════════
// STEP 3 — LOAD CALCULATION (Get button per row)
// GET /api/cull-sales/calculate-load
// ═══════════════════════════════════════════════════════════════════════════
exports.calculateLoad = async (req, res) => {
  const { empty_weight, load_weight, birds_male, birds_female } = req.query;
  const emptyWt = parseFloat(empty_weight) || 0;
  const loadWt  = parseFloat(load_weight)  || 0;
  const netWt   = Math.max(0, loadWt - emptyWt);
  const totalBirds = (parseInt(birds_male)||0) + (parseInt(birds_female)||0);
  const avgWeight  = totalBirds > 0 ? (netWt / totalBirds).toFixed(3) : 0;
  return res.json({
    success:      true,
    empty_weight: emptyWt,
    load_weight:  loadWt,
    net_weight:   parseFloat(netWt.toFixed(3)),
    total_birds:  totalBirds,
    avg_weight:   parseFloat(avgWeight),
  });
};

// ═══════════════════════════════════════════════════════════════════════════
// GENERATE DC PDF (internal helper)
// ═══════════════════════════════════════════════════════════════════════════
async function generateDC(data) {
  try {
    const templatePath = path.join(process.cwd(), 'templates', 'breeder', 'cull_sales_dc.ejs');
    const templateData = {
      ...data,
      bill_value_in_words: toWords.convert(Number(data.bill_value||0)),
    };

    const htmlContent = await ejs.renderFile(templatePath, templateData);

    const reportsDir = path.join(process.cwd(), 'uploads', 'cull_sales');
    if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive:true });

    const fileName  = `DC_${data.dc_no_auto.replace(/\//g,'-')}_${Date.now()}.pdf`;
    const filePath  = path.join(reportsDir, fileName);
    const publicUrl = `${process.env.SERVER_URL || 'http://localhost:3000'}/uploads/cull_sales/${fileName}`;

    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil:'networkidle0' });
    await page.pdf({
      path: filePath,
      format: 'A4',
      printBackground: true,
      margin: { top:'30px', bottom:'30px', left:'30px', right:'30px' },
    });
    await browser.close();

    return { success:true, pdf_link: publicUrl, fileName };
  } catch(err) {
    console.error('[generateDC]', err.message);
    return { success:false, error: err.message };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SAVE + GENERATE BILL (POST /api/cull-sales/save)
//
// Step 1 body fields:
//   flock_no, plant_code, entry_date, shed_id, part_id, line_id,
//   batch_no, age, bird_stock
//
// Step 2 body fields (same as broiler supply):
//   customer_type, dc_no, customer, sales_type,
//   transport_by, vehicle_no, driver_name, driver_mobile,
//   order_by, dispatched_by
//
// Step 3 body fields (Load Details + Rate):
//   load_details: [{ cage_no, empty_weight, birds_male, birds_female, load_weight }]
//   rate, net_weight_male, net_weight_female,
//   avg_weight_male, avg_weight_female,
//   gross_value, bill_value, remarks
// ═══════════════════════════════════════════════════════════════════════════
exports.saveCullSales = async (req, res) => {
  const {
    flock_no, plant_code, entry_date,
    order_no,
    shed_id, part_id, line_id,
    batch_no, age, bird_stock,
    customer_type, dc_no, customer, sales_type,
    transport_by, vehicle_no, driver_name, driver_mobile,
    order_by, dispatched_by,
    load_details,
    rate, net_weight_male, net_weight_female,
    avg_weight_male, avg_weight_female,
    gross_value, bill_value,
    remarks,
  } = req.body;

  if (!flock_no || !plant_code)
    return res.status(422).json({ success:false, message:'flock_no and plant_code required' });

  const date = parseDate(entry_date);
  const today = todayDate();
  if (date > today) return res.status(400).json({ success:false, message:'Cannot enter future date' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Auto-generate bill number + DC number
    const seqRes = await client.query(
      `SELECT COUNT(*)+1 AS seq FROM cull_sales_header WHERE plant_code=$1 AND entry_date::date=CURRENT_DATE`,
      [plant_code]
    );
    const seq      = String(seqRes.rows[0].seq).padStart(4,'0');
    const billNo   = `CS-${plant_code}-${date.replace(/-/g,'')}-${seq}`;
    const dcNoAuto = `CS/DC/${seqRes.rows[0].seq + 11000}`;

    // Get shed_no for DC display
    let shed_no = '';
    if (shed_id) {
      const sRes = await client.query(`SELECT shed_no FROM shed_master WHERE id=$1`, [shed_id]);
      shed_no = sRes.rows[0]?.shed_no || '';
    }

    // Save header — ON CONFLICT upsert (same flock+date = update, new date = insert)
    const headerRes = await client.query(`
      INSERT INTO cull_sales_header (
        flock_no, plant_code, order_no, entry_date,
        shed_id, part_id, line_id, batch_no, age, bird_stock,
        customer_type, dc_no, customer, sales_type,
        transport_by, vehicle_no, driver_name, driver_mobile,
        order_by, dispatched_by,
        rate, net_weight_male, net_weight_female,
        avg_weight_male, avg_weight_female,
        gross_value, bill_value,
        bill_no, dc_no_auto, status, remarks, entered_by
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
        $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
        $21,$22,$23,$24,$25,$26,$27,$28,$29,'completed',$30,$31
      )
      ON CONFLICT (flock_no, entry_date)
      DO UPDATE SET
        order_no=$3,
        shed_id=$5, part_id=$6, line_id=$7, batch_no=$8, age=$9, bird_stock=$10,
        customer_type=$11, dc_no=$12, customer=$13, sales_type=$14,
        transport_by=$15, vehicle_no=$16, driver_name=$17, driver_mobile=$18,
        order_by=$19, dispatched_by=$20,
        rate=$21, net_weight_male=$22, net_weight_female=$23,
        avg_weight_male=$24, avg_weight_female=$25,
        gross_value=$26, bill_value=$27,
        remarks=$30, updated_at=NOW()
      RETURNING *, (xmax = 0) AS is_new_record
    `, [
      flock_no, plant_code, order_no || null, date,
      shed_id||null, part_id||null, line_id||null,
      batch_no||flock_no, age||null, bird_stock||0,
      customer_type||null, dc_no||null, customer||null, sales_type||null,
      transport_by||null, vehicle_no||null, driver_name||null, driver_mobile||null,
      order_by||null, dispatched_by||null,
      rate||0, net_weight_male||0, net_weight_female||0,
      avg_weight_male||0, avg_weight_female||0,
      gross_value||0, bill_value||0,
      billNo, dcNoAuto, remarks||null, req.user?.id||null
    ]);

    const csId = headerRes.rows[0].id;

    // Save load details — delete old rows first, then re-insert
    // This handles both insert (new) and update (existing date) correctly
    const details = Array.isArray(load_details) ? load_details : [];
    await client.query(`DELETE FROM cull_sales_load_detail WHERE cull_sales_id=$1`, [csId]);
    for (let i=0; i<details.length; i++) {
      const d = details[i];
      const emptyWt = parseFloat(d.empty_weight)||0;
      const loadWt  = parseFloat(d.load_weight)||0;
      const netWt   = Math.max(0, loadWt - emptyWt);
      await client.query(`
        INSERT INTO cull_sales_load_detail
          (cull_sales_id, s_no, cage_no, empty_weight, birds_male, birds_female, load_weight, net_weight)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      `, [csId, i+1, d.cage_no||(i+1), emptyWt,
          parseInt(d.birds_male)||0, parseInt(d.birds_female)||0,
          loadWt, parseFloat(netWt.toFixed(3))]);
    }

    await client.query('COMMIT');

    // Generate PDF DC (after DB commit so failure doesn't rollback)
    const dcData = {
      ...headerRes.rows[0],
      shed_no,
      load_details: details,
      dc_no_auto:   dcNoAuto,
      bill_no:      billNo,
      gross_value:  gross_value||0,
      bill_value:   bill_value||0,
    };

    const dcResult = await generateDC(dcData);

    // Update pdf_link in DB
    if (dcResult.success) {
      await pool.query(
        `UPDATE cull_sales_header SET pdf_link=$1 WHERE id=$2`,
        [dcResult.pdf_link, csId]
      );
    }

    return res.status(201).json({
      success:    true,
      message:    headerRes.rows[0].is_new_record
                    ? `✅ Cull Sales bill created — ${billNo}`
                    : `✅ Cull Sales bill updated — ${billNo}`,
      is_new:     headerRes.rows[0].is_new_record,
      bill_no:    billNo,
      dc_no:      dcNoAuto,
      id:         csId,
      flock_no,
      order_no:   order_no || null,
      entry_date: date,
      load_details_saved: details.length,
      pdf_link:   dcResult.success ? dcResult.pdf_link : null,
      pdf_error:  dcResult.success ? null : dcResult.error,
    });
  } catch(err) {
    await client.query('ROLLBACK');
    console.error('[saveCullSales]', err.message);
    return res.status(500).json({ success:false, message:err.message });
  } finally {
    client.release();
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// GET ALL  GET /api/cull-sales/getAll
// ═══════════════════════════════════════════════════════════════════════════
exports.getAll = async (req, res) => {
  const { plant_code, flock_no, from_date, to_date, status } = req.query;
  try {
    let where=[]; let params=[]; let idx=1;
    if (plant_code) { where.push(`csh.plant_code=$${idx++}`); params.push(plant_code); }
    if (flock_no)   { where.push(`csh.flock_no=$${idx++}`);   params.push(flock_no); }
    if (from_date)  { where.push(`csh.entry_date>=$${idx++}`);params.push(from_date); }
    if (to_date)    { where.push(`csh.entry_date<=$${idx++}`); params.push(to_date); }
    if (status)     { where.push(`csh.status=$${idx++}`);      params.push(status); }

    const r = await pool.query(`
      SELECT csh.*, TO_CHAR(csh.entry_date,'YYYY-MM-DD') AS entry_date,
             sm.shed_no, sm.shed_name,
             sp.part_row_no, sl.line_no,
             COALESCE(csh.sap_synced, FALSE) AS sap_synced,
             csh.sap_synced_at
      FROM cull_sales_header csh
      LEFT JOIN shed_master sm      ON sm.id = csh.shed_id
      LEFT JOIN shed_part_master sp ON sp.id = csh.part_id
      LEFT JOIN shed_line_master sl ON sl.id = csh.line_id
      ${where.length ? 'WHERE '+where.join(' AND ') : ''}
      ORDER BY csh.created_at DESC
    `, params);
    return res.json({ success:true, total:r.rowCount, data:r.rows });
  } catch(err) { return res.status(500).json({ success:false, message:err.message }); }
};

// ═══════════════════════════════════════════════════════════════════════════
// GET ONE  GET /api/cull-sales/getOne/:id
// ═══════════════════════════════════════════════════════════════════════════
exports.getOne = async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT csh.*,
             sm.shed_no, sm.shed_name,
             sp.part_row_no, sl.line_no,
             sl.male_birds, sl.female_birds,
             COALESCE(csh.sap_synced, FALSE) AS sap_synced,
             csh.sap_synced_at
      FROM cull_sales_header csh
      LEFT JOIN shed_master sm      ON sm.id = csh.shed_id
      LEFT JOIN shed_part_master sp ON sp.id = csh.part_id
      LEFT JOIN shed_line_master sl ON sl.id = csh.line_id
      WHERE csh.id=$1
    `, [req.params.id]);

    if (r.rowCount===0)
      return res.status(404).json({ success:false, message:'Not found' });

    const ld = await pool.query(
      `SELECT * FROM cull_sales_load_detail WHERE cull_sales_id=$1 ORDER BY s_no`,
      [req.params.id]
    );
    return res.json({ success:true, data:{ ...formatRow(r.rows[0]), load_details:ld.rows } });
  } catch(err) { return res.status(500).json({ success:false, message:err.message }); }
};

// ═══════════════════════════════════════════════════════════════════════════
// GET BY FLOCK  GET /api/cull-sales/flock/:flock_no?date=
// ═══════════════════════════════════════════════════════════════════════════
exports.getByFlock = async (req, res) => {
  const { flock_no } = req.params;
  const { date }     = req.query;
  const actDate = parseDate(date);
  try {
    const r = await pool.query(`
      SELECT * FROM cull_sales_header
      WHERE flock_no=$1 AND entry_date=$2
      ORDER BY created_at DESC
    `, [flock_no, actDate]);
    return res.json({ success:true, flock_no, date:actDate, total:r.rowCount, data:r.rows });
  } catch(err) { return res.status(500).json({ success:false, message:err.message }); }
};

// ═══════════════════════════════════════════════════════════════════════════
// REGENERATE DC PDF  GET /api/cull-sales/dc/:id
// ═══════════════════════════════════════════════════════════════════════════
exports.getDC = async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT csh.*, sm.shed_no FROM cull_sales_header csh
       LEFT JOIN shed_master sm ON sm.id=csh.shed_id
       WHERE csh.id=$1`, [req.params.id]
    );
    if (r.rowCount===0)
      return res.status(404).json({ success:false, message:'Not found' });

    const ld = await pool.query(
      `SELECT * FROM cull_sales_load_detail WHERE cull_sales_id=$1 ORDER BY s_no`,
      [req.params.id]
    );

    const data = { ...r.rows[0], load_details: ld.rows };

    // If PDF already exists return it
    if (data.pdf_link) {
      return res.json({ success:true, pdf_link: data.pdf_link, data });
    }

    // Regenerate
    const dcResult = await generateDC(data);
    if (dcResult.success) {
      await pool.query(`UPDATE cull_sales_header SET pdf_link=$1 WHERE id=$2`, [dcResult.pdf_link, req.params.id]);
      return res.json({ success:true, pdf_link: dcResult.pdf_link, data });
    }

    return res.status(500).json({ success:false, message: dcResult.error });
  } catch(err) { return res.status(500).json({ success:false, message:err.message }); }
};

// ═══════════════════════════════════════════════════════════════════════════
// STEP 2 DROPDOWNS — All dropdowns for the cull sales form (screen 2)
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/cull-sales/dropdowns?plant_code=1902
// Returns ALL step 2 dropdowns in one call:
//   customer_types[], customers[], sales_types[],
//   transport_types[], order_by_list[], dispatched_by_list[]
exports.getAllDropdowns = async (req, res) => {
  const { plant_code } = req.query;
  try {
    const [ctRes, custRes, stRes, ttRes, empRes] = await Promise.all([
      // Customer Types (no plant filter — global)
      pool.query(`SELECT id, type_name AS label FROM customer_type_master WHERE is_active=TRUE ORDER BY type_name`),
      // Customers by plant
      pool.query(
        `SELECT id, customer_code, customer_name AS label, address, mobile
         FROM cull_customer_master
         WHERE is_active=TRUE ${plant_code ? 'AND (plant_code=$1 OR plant_code IS NULL)' : ''}
         ORDER BY customer_name`,
        plant_code ? [plant_code] : []
      ),
      // Sales Types (global)
      pool.query(`SELECT id, type_name AS label FROM sales_type_master WHERE is_active=TRUE ORDER BY type_name`),
      // Transport Types (global)
      pool.query(`SELECT id, transport_name AS label FROM transport_type_master WHERE is_active=TRUE ORDER BY transport_name`),
      // Employees by plant (both order_by and dispatched_by)
      pool.query(
        `SELECT id, emp_code, emp_name AS label, role
         FROM cull_sales_emp_master
         WHERE is_active=TRUE ${plant_code ? 'AND (plant_code=$1 OR plant_code IS NULL)' : ''}
         ORDER BY emp_name`,
        plant_code ? [plant_code] : []
      ),
    ]);

    const emps = empRes.rows;
    return res.json({
      success: true,
      data: {
        customer_types:    ctRes.rows,
        customers:         custRes.rows,
        sales_types:       stRes.rows,
        transport_types:   ttRes.rows,
        order_by_list:     emps.filter(e => e.role === 'both' || e.role === 'order_by'),
        dispatched_by_list:emps.filter(e => e.role === 'both' || e.role === 'dispatched_by'),
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/cull-sales/customer-types
exports.getCustomerTypes = async (req, res) => {
  try {
    const r = await pool.query(`SELECT id, type_name AS label FROM customer_type_master WHERE is_active=TRUE ORDER BY type_name`);
    return res.json({ success: true, data: r.rows });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

// GET /api/cull-sales/customers?plant_code=1902
exports.getCustomers = async (req, res) => {
  const { plant_code } = req.query;
  try {
    const r = await pool.query(
      `SELECT id, customer_code, customer_name AS label, address, mobile
       FROM cull_customer_master
       WHERE is_active=TRUE AND (plant_code=$1 OR plant_code IS NULL)
       ORDER BY customer_name`,
      [plant_code || '']
    );
    return res.json({ success: true, data: r.rows });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

// GET /api/cull-sales/sales-types
exports.getSalesTypes = async (req, res) => {
  try {
    const r = await pool.query(`SELECT id, type_name AS label FROM sales_type_master WHERE is_active=TRUE ORDER BY type_name`);
    return res.json({ success: true, data: r.rows });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

// GET /api/cull-sales/transport-types
exports.getTransportTypes = async (req, res) => {
  try {
    const r = await pool.query(`SELECT id, transport_name AS label FROM transport_type_master WHERE is_active=TRUE ORDER BY transport_name`);
    return res.json({ success: true, data: r.rows });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

// GET /api/cull-sales/employees?plant_code=1902&role=both
exports.getEmployees = async (req, res) => {
  const { plant_code, role } = req.query;
  try {
    const conds = ['is_active=TRUE'];
    const vals = [];
    let idx = 1;
    if (plant_code) { conds.push(`(plant_code=$${idx++} OR plant_code IS NULL)`); vals.push(plant_code); }
    if (role && role !== 'both') { conds.push(`(role=$${idx++} OR role='both')`); vals.push(role); }
    const r = await pool.query(
      `SELECT id, emp_code, emp_name AS label, role FROM cull_sales_emp_master WHERE ${conds.join(' AND ')} ORDER BY emp_name`,
      vals
    );
    return res.json({ success: true, data: r.rows });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

// ═══════════════════════════════════════════════════════════════════════════
// ADMIN CRUD for dropdown masters
// ═══════════════════════════════════════════════════════════════════════════

// POST /api/cull-sales/admin/customer-types   { type_name }
exports.addCustomerType = async (req, res) => {
  const { type_name } = req.body;
  if (!type_name) return res.status(422).json({ success:false, message:'type_name required' });
  try {
    const r = await pool.query(`INSERT INTO customer_type_master (type_name) VALUES ($1) RETURNING *`, [type_name]);
    return res.status(201).json({ success:true, data:r.rows[0] });
  } catch (err) { return res.status(500).json({ success:false, message:err.message }); }
};

// POST /api/cull-sales/admin/customers   { plant_code, customer_code, customer_name, address, mobile }
exports.addCustomer = async (req, res) => {
  const { plant_code, customer_code, customer_name, address, mobile } = req.body;
  if (!customer_name) return res.status(422).json({ success:false, message:'customer_name required' });
  try {
    const r = await pool.query(
      `INSERT INTO cull_customer_master (plant_code, customer_code, customer_name, address, mobile) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [plant_code||null, customer_code||null, customer_name, address||null, mobile||null]
    );
    return res.status(201).json({ success:true, data:r.rows[0] });
  } catch (err) { return res.status(500).json({ success:false, message:err.message }); }
};

// POST /api/cull-sales/admin/sales-types   { type_name }
exports.addSalesType = async (req, res) => {
  const { type_name } = req.body;
  if (!type_name) return res.status(422).json({ success:false, message:'type_name required' });
  try {
    const r = await pool.query(`INSERT INTO sales_type_master (type_name) VALUES ($1) RETURNING *`, [type_name]);
    return res.status(201).json({ success:true, data:r.rows[0] });
  } catch (err) { return res.status(500).json({ success:false, message:err.message }); }
};

// POST /api/cull-sales/admin/transport-types   { transport_name }
exports.addTransportType = async (req, res) => {
  const { transport_name } = req.body;
  if (!transport_name) return res.status(422).json({ success:false, message:'transport_name required' });
  try {
    const r = await pool.query(`INSERT INTO transport_type_master (transport_name) VALUES ($1) RETURNING *`, [transport_name]);
    return res.status(201).json({ success:true, data:r.rows[0] });
  } catch (err) { return res.status(500).json({ success:false, message:err.message }); }
};

// POST /api/cull-sales/admin/employees   { plant_code, emp_code, emp_name, role }
exports.addEmployee = async (req, res) => {
  const { plant_code, emp_code, emp_name, role } = req.body;
  if (!emp_name) return res.status(422).json({ success:false, message:'emp_name required' });
  try {
    const r = await pool.query(
      `INSERT INTO cull_sales_emp_master (plant_code, emp_code, emp_name, role) VALUES ($1,$2,$3,$4) RETURNING *`,
      [plant_code||null, emp_code||null, emp_name, role||'both']
    );
    return res.status(201).json({ success:true, data:r.rows[0] });
  } catch (err) { return res.status(500).json({ success:false, message:err.message }); }
};

// ═══════════════════════════════════════════════════════════════════════════
// DELETE /api/cull-sales/:id  — blocked if SAP synced
// ═══════════════════════════════════════════════════════════════════════════
exports.deleteCullSales = async (req, res) => {
  try {
    const r = await pool.query(`SELECT id, bill_no, sap_synced FROM cull_sales_header WHERE id=$1`, [req.params.id]);
    if (r.rowCount === 0) return res.status(404).json({ success:false, message:'Record not found' });
    if (r.rows[0].sap_synced) {
      return res.status(403).json({ success:false, message:'Cannot delete — record is SAP Synced', sap_synced:true });
    }
    await pool.query(`DELETE FROM cull_sales_header WHERE id=$1`, [req.params.id]);
    return res.json({ success:true, message:'Cull sales record deleted' });
  } catch(err) { return res.status(500).json({ success:false, message:err.message }); }
};
