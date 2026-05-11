const { parseDate, todayDate, formatRow } = require('../utils/dateUtils');
const pool = require('../config/db');
const path = require('path');
const fs   = require('fs');

// ═══════════════════════════════════════════════════════════════════════════
// DROPDOWN CHAIN: Plant → Shed → Part/Row → Line → auto-fill cum+total birds
// ═══════════════════════════════════════════════════════════════════════════

exports.getSheds = async (req, res) => {
  const { plant_code } = req.query;
  if (!plant_code) return res.status(422).json({ success:false, message:'plant_code required' });
  try {
    const r = await pool.query(
      `SELECT id, shed_no, shed_name FROM shed_master WHERE plant_code=$1 AND is_active=TRUE ORDER BY shed_no`,
      [plant_code]
    );
    return res.json({ success:true, data:r.rows });
  } catch(err) { return res.status(500).json({ success:false, message:err.message }); }
};

exports.getParts = async (req, res) => {
  const { shed_id } = req.query;
  if (!shed_id) return res.status(422).json({ success:false, message:'shed_id required' });
  try {
    const r = await pool.query(
      `SELECT id, part_row_no, cum_birds FROM shed_part_master WHERE shed_id=$1 AND is_active=TRUE ORDER BY part_row_no`,
      [shed_id]
    );
    return res.json({ success:true, data:r.rows });
  } catch(err) { return res.status(500).json({ success:false, message:err.message }); }
};

exports.getLines = async (req, res) => {
  const { part_id } = req.query;
  if (!part_id) return res.status(422).json({ success:false, message:'part_id required' });
  try {
    const r = await pool.query(
      `SELECT id, line_no, male_birds, female_birds,
              total_birds
       FROM shed_line_master WHERE part_id=$1 AND is_active=TRUE ORDER BY line_no`,
      [part_id]
    );
    return res.json({ success:true, data:r.rows });
  } catch(err) { return res.status(500).json({ success:false, message:err.message }); }
};

// GET /api/mortality/line-info?line_id=1  — auto-fills cum_birds + total male/female
exports.getLineInfo = async (req, res) => {
  const { line_id } = req.query;
  if (!line_id) return res.status(422).json({ success:false, message:'line_id required' });
  try {
    const r = await pool.query(`
      SELECT slm.id, slm.line_no, slm.male_birds, slm.female_birds,
             slm.total_birds,
             spm.cum_birds, spm.part_row_no,
             sm.shed_no, sm.shed_name, sm.plant_code
      FROM shed_line_master slm
      JOIN shed_part_master spm ON spm.id = slm.part_id
      JOIN shed_master sm       ON sm.id  = spm.shed_id
      WHERE slm.id=$1
    `, [line_id]);
    if (r.rowCount === 0) return res.status(404).json({ success:false, message:'Line not found' });
    return res.json({ success:true, data:r.rows[0] });
  } catch(err) { return res.status(500).json({ success:false, message:err.message }); }
};

exports.getMortalityReasons   = async (req,res) => {
  const r = await pool.query(`SELECT id,reason_name FROM mortality_reason_master WHERE is_active=TRUE ORDER BY reason_name`);
  return res.json({ success:true, data:r.rows });
};
exports.getCullKillReasons    = async (req,res) => {
  const r = await pool.query(`SELECT id,reason_name FROM cull_kill_reason_master WHERE is_active=TRUE ORDER BY reason_name`);
  return res.json({ success:true, data:r.rows });
};
exports.getMortalityPhotoTypes = async (req,res) => {
  const r = await pool.query(`SELECT id,type_name,is_multiple FROM mortality_photo_type WHERE is_active=TRUE ORDER BY sort_order`);
  return res.json({ success:true, data:r.rows });
};
exports.getCullKillPhotoTypes  = async (req,res) => {
  const r = await pool.query(`SELECT id,type_name,is_multiple FROM cull_kill_photo_type WHERE is_active=TRUE ORDER BY sort_order`);
  return res.json({ success:true, data:r.rows });
};

// ═══════════════════════════════════════════════════════════════════════════
// SAVE MORTALITY — POST /api/mortality/save
// Form-data fields:
//   flock_no, plant_code, shed_id, part_id, line_id, entry_date
//   schedule = JSON: [{slot:"morning",male:2,female:1},{slot:"afternoon"...},{slot:"evening"...}]
//   reasons  = JSON: [{reason_id:1,reason_name:"Disease",male:2,female:1,remarks:"..."}]
//   photo_type_1   = file (single)
//   photo_type_1_0 = file, photo_type_1_1 = file (multiple)
//   photo_type_2   = file
//   ...etc
// ═══════════════════════════════════════════════════════════════════════════
exports.saveMortality = async (req, res) => {
  const { flock_no, plant_code, order_no, shed_id, part_id, line_id, entry_date, schedule, reasons } = req.body;
  if (!flock_no || !plant_code) return res.status(422).json({ success:false, message:'flock_no and plant_code required' });

  const date = parseDate(entry_date);
  if (date > todayDate()) return res.status(400).json({ success:false, message:'Cannot enter future date' });

  let scheduleArr=[], reasonsArr=[];
  try {
    if (schedule) scheduleArr = typeof schedule==='string' ? JSON.parse(schedule) : schedule;
    if (reasons)  reasonsArr  = typeof reasons ==='string' ? JSON.parse(reasons)  : reasons;
  } catch(e) { return res.status(400).json({ success:false, message:'Invalid JSON in schedule or reasons' }); }

  // Auto-fill from line master
  let cum_birds=0, total_male=0, total_female=0;
  if (line_id) {
    const lr = await pool.query(
      `SELECT slm.male_birds,slm.female_birds,spm.cum_birds FROM shed_line_master slm JOIN shed_part_master spm ON spm.id=slm.part_id WHERE slm.id=$1`,
      [line_id]
    );
    if (lr.rowCount>0) { total_male=lr.rows[0].male_birds||0; total_female=lr.rows[0].female_birds||0; cum_birds=lr.rows[0].cum_birds||0; }
  }

  const g = (slot) => scheduleArr.find(s=>s.slot===slot)||{};
  const M=g('morning'), A=g('afternoon'), E=g('evening');
  const mm=+M.male||0, mf=+M.female||0;
  const am=+A.male||0, af=+A.female||0;
  const em=+E.male||0, ef=+E.female||0;
  const tmc=mm+am+em, tfc=mf+af+ef, tq=tmc+tfc;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const logRes = await client.query(`
      INSERT INTO mortality_log
        (flock_no,plant_code,order_no,shed_id,part_id,line_id,entry_date,cum_birds,total_male,total_female,
         morning_male,morning_female,morning_qty,afternoon_male,afternoon_female,afternoon_qty,
         evening_male,evening_female,evening_qty,total_qty,entered_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
      ON CONFLICT (flock_no,shed_id,part_id,line_id,entry_date)
      DO UPDATE SET
        order_no=EXCLUDED.order_no,
        morning_male=EXCLUDED.morning_male,morning_female=EXCLUDED.morning_female,morning_qty=EXCLUDED.morning_qty,
        afternoon_male=EXCLUDED.afternoon_male,afternoon_female=EXCLUDED.afternoon_female,afternoon_qty=EXCLUDED.afternoon_qty,
        evening_male=EXCLUDED.evening_male,evening_female=EXCLUDED.evening_female,evening_qty=EXCLUDED.evening_qty,
        total_male=EXCLUDED.total_male,total_female=EXCLUDED.total_female,total_qty=EXCLUDED.total_qty,
        entered_by=EXCLUDED.entered_by,updated_at=NOW()
      RETURNING id
    `, [flock_no,plant_code,order_no||null,shed_id||null,part_id||null,line_id||null,date,
        cum_birds,total_male,total_female,
        mm,mf,mm+mf, am,af,am+af, em,ef,em+ef, tq,
        req.user?.id||null]);

    const mortality_id = logRes.rows[0].id;

    // Save reasons
    await client.query(`DELETE FROM mortality_reason_log WHERE mortality_id=$1`,[mortality_id]);
    for (const r of reasonsArr) {
      const male=+(r.male_count||r.male||0), female=+(r.female_count||r.female||0);
      await client.query(
        `INSERT INTO mortality_reason_log (mortality_id,reason_id,reason_name,male_count,female_count,total_count,remarks) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [mortality_id,r.reason_id||null,r.reason_name||null,male,female,male+female,r.remarks||null]
      );
    }

    // Save photos
    const savedPhotos=[];
    if (req.files && Object.keys(req.files).length > 0) {
      const old = await client.query(`SELECT image_path FROM mortality_photo_log WHERE mortality_id=$1`,[mortality_id]);
      for (const op of old.rows) { try { fs.unlinkSync(path.join(__dirname,'..','..','uploads',path.basename(op.image_path))); }catch(_){} }
      await client.query(`DELETE FROM mortality_photo_log WHERE mortality_id=$1`,[mortality_id]);

      for (const [field, fileArr] of Object.entries(req.files)) {
        const match = field.match(/^photo_type_(\d+)/);
        if (!match) continue;
        const pt_id = +match[1];
        const tr = await client.query(`SELECT type_name FROM mortality_photo_type WHERE id=$1`,[pt_id]);
        const type_name = tr.rows[0]?.type_name||null;
        const files = Array.isArray(fileArr)?fileArr:[fileArr];
        for (const file of files) {
          const ip = `/uploads/${file.filename}`;
          await client.query(`INSERT INTO mortality_photo_log (mortality_id,photo_type_id,type_name,image_path) VALUES ($1,$2,$3,$4)`,[mortality_id,pt_id,type_name,ip]);
          savedPhotos.push({ photo_type_id:pt_id, type_name, image_path:ip });
        }
      }
    }

    await client.query('COMMIT');
    return res.status(201).json({
      success:true, message:`✅ Mortality saved for ${flock_no} on ${date}`,
      mortality_id, flock_no, plant_code, entry_date:date,
      schedule:{morning_qty:mm+mf, afternoon_qty:am+af, evening_qty:em+ef, total_qty:tq},
      reasons_saved:reasonsArr.length, photos_saved:savedPhotos.length, photos:savedPhotos,
    });
  } catch(err) {
    await client.query('ROLLBACK');
    console.error('[saveMortality]',err.message);
    return res.status(500).json({ success:false, message:err.message });
  } finally { client.release(); }
};

// ═══════════════════════════════════════════════════════════════════════════
// SAVE CULL KILL — POST /api/cull-kill/save (same structure as mortality)
// ═══════════════════════════════════════════════════════════════════════════
exports.saveCullKill = async (req, res) => {
  const { flock_no, plant_code, order_no, shed_id, part_id, line_id, entry_date, schedule, reasons } = req.body;
  if (!flock_no || !plant_code) return res.status(422).json({ success:false, message:'flock_no and plant_code required' });

  const date = parseDate(entry_date);
  if (date > todayDate()) return res.status(400).json({ success:false, message:'Cannot enter future date' });

  let scheduleArr=[], reasonsArr=[];
  try {
    if (schedule) scheduleArr = typeof schedule==='string' ? JSON.parse(schedule) : schedule;
    if (reasons)  reasonsArr  = typeof reasons ==='string' ? JSON.parse(reasons)  : reasons;
  } catch(e) { return res.status(400).json({ success:false, message:'Invalid JSON' }); }

  let cum_birds=0, total_male=0, total_female=0;
  if (line_id) {
    const lr = await pool.query(
      `SELECT slm.male_birds,slm.female_birds,spm.cum_birds FROM shed_line_master slm JOIN shed_part_master spm ON spm.id=slm.part_id WHERE slm.id=$1`,
      [line_id]
    );
    if (lr.rowCount>0) { total_male=lr.rows[0].male_birds||0; total_female=lr.rows[0].female_birds||0; cum_birds=lr.rows[0].cum_birds||0; }
  }

  const g = (slot) => scheduleArr.find(s=>s.slot===slot)||{};
  const M=g('morning'), A=g('afternoon'), E=g('evening');
  const mm=+M.male||0, mf=+M.female||0;
  const am=+A.male||0, af=+A.female||0;
  const em=+E.male||0, ef=+E.female||0;
  const tmc=mm+am+em, tfc=mf+af+ef, tq=tmc+tfc;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const logRes = await client.query(`
      INSERT INTO cull_kill_log
        (flock_no,plant_code,order_no,shed_id,part_id,line_id,entry_date,cum_birds,total_male,total_female,
         morning_male,morning_female,morning_qty,afternoon_male,afternoon_female,afternoon_qty,
         evening_male,evening_female,evening_qty,total_qty,entered_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
      ON CONFLICT (flock_no,shed_id,part_id,line_id,entry_date)
      DO UPDATE SET
        order_no=EXCLUDED.order_no,
        morning_male=EXCLUDED.morning_male,morning_female=EXCLUDED.morning_female,morning_qty=EXCLUDED.morning_qty,
        afternoon_male=EXCLUDED.afternoon_male,afternoon_female=EXCLUDED.afternoon_female,afternoon_qty=EXCLUDED.afternoon_qty,
        evening_male=EXCLUDED.evening_male,evening_female=EXCLUDED.evening_female,evening_qty=EXCLUDED.evening_qty,
        total_male=EXCLUDED.total_male,total_female=EXCLUDED.total_female,total_qty=EXCLUDED.total_qty,
        entered_by=EXCLUDED.entered_by,updated_at=NOW()
      RETURNING id
    `, [flock_no,plant_code,order_no||null,shed_id||null,part_id||null,line_id||null,date,
        cum_birds,total_male,total_female,
        mm,mf,mm+mf, am,af,am+af, em,ef,em+ef, tq,
        req.user?.id||null]);

    const cull_kill_id = logRes.rows[0].id;

    await client.query(`DELETE FROM cull_kill_reason_log WHERE cull_kill_id=$1`,[cull_kill_id]);
    for (const r of reasonsArr) {
      const male=+(r.male_count||r.male||0), female=+(r.female_count||r.female||0);
      await client.query(
        `INSERT INTO cull_kill_reason_log (cull_kill_id,reason_id,reason_name,male_count,female_count,total_count,remarks) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [cull_kill_id,r.reason_id||null,r.reason_name||null,male,female,male+female,r.remarks||null]
      );
    }

    const savedPhotos=[];
    if (req.files && Object.keys(req.files).length > 0) {
      const old = await client.query(`SELECT image_path FROM cull_kill_photo_log WHERE cull_kill_id=$1`,[cull_kill_id]);
      for (const op of old.rows) { try { fs.unlinkSync(path.join(__dirname,'..','..','uploads',path.basename(op.image_path))); }catch(_){} }
      await client.query(`DELETE FROM cull_kill_photo_log WHERE cull_kill_id=$1`,[cull_kill_id]);

      for (const [field, fileArr] of Object.entries(req.files)) {
        const match = field.match(/^photo_type_(\d+)/);
        if (!match) continue;
        const pt_id = +match[1];
        const tr = await client.query(`SELECT type_name FROM cull_kill_photo_type WHERE id=$1`,[pt_id]);
        const type_name = tr.rows[0]?.type_name||null;
        const files = Array.isArray(fileArr)?fileArr:[fileArr];
        for (const file of files) {
          const ip = `/uploads/${file.filename}`;
          await client.query(`INSERT INTO cull_kill_photo_log (cull_kill_id,photo_type_id,type_name,image_path) VALUES ($1,$2,$3,$4)`,[cull_kill_id,pt_id,type_name,ip]);
          savedPhotos.push({ photo_type_id:pt_id, type_name, image_path:ip });
        }
      }
    }

    await client.query('COMMIT');
    return res.status(201).json({
      success:true, message:`✅ Cull Kill saved for ${flock_no} on ${date}`,
      cull_kill_id, flock_no, plant_code, entry_date:date,
      schedule:{morning_qty:mm+mf, afternoon_qty:am+af, evening_qty:em+ef, total_qty:tq},
      reasons_saved:reasonsArr.length, photos_saved:savedPhotos.length, photos:savedPhotos,
    });
  } catch(err) {
    await client.query('ROLLBACK');
    console.error('[saveCullKill]',err.message);
    return res.status(500).json({ success:false, message:err.message });
  } finally { client.release(); }
};

// ═══════════════════════════════════════════════════════════════════════════
// GET saved data
// ═══════════════════════════════════════════════════════════════════════════
exports.getMortality = async (req, res) => {
  const { flock_no } = req.params;
  const date = req.query.date || todayDate();
  try {
    const lr = await pool.query(`
      SELECT ml.*, TO_CHAR(ml.entry_date,'YYYY-MM-DD') AS entry_date, sm.shed_no, spm.part_row_no, slm.line_no
      FROM mortality_log ml
      LEFT JOIN shed_master sm       ON sm.id =ml.shed_id
      LEFT JOIN shed_part_master spm ON spm.id=ml.part_id
      LEFT JOIN shed_line_master slm ON slm.id=ml.line_id
      WHERE ml.flock_no=$1 AND ml.entry_date=$2
    `,[flock_no,date]);
    if (lr.rowCount===0) return res.json({ success:true, has_entry:false, flock_no, date, data:null });
    const log = lr.rows[0];
    const reasons = (await pool.query(`SELECT * FROM mortality_reason_log WHERE mortality_id=$1`,[log.id])).rows;
    const photosR = (await pool.query(`SELECT * FROM mortality_photo_log  WHERE mortality_id=$1 ORDER BY photo_type_id`,[log.id])).rows;
    const photos  = {};
    for (const p of photosR) {
      if (!photos[p.photo_type_id]) photos[p.photo_type_id]={type_name:p.type_name,images:[]};
      photos[p.photo_type_id].images.push(p.image_path);
    }
    return res.json({ success:true, has_entry:true, flock_no, date, data:{...formatRow(log),reasons,photos} });
  } catch(err) { return res.status(500).json({ success:false, message:err.message }); }
};

exports.getCullKill = async (req, res) => {
  const { flock_no } = req.params;
  const date = req.query.date || todayDate();
  try {
    const lr = await pool.query(`
      SELECT ckl.*, TO_CHAR(ckl.entry_date,'YYYY-MM-DD') AS entry_date, sm.shed_no, spm.part_row_no, slm.line_no
      FROM cull_kill_log ckl
      LEFT JOIN shed_master sm       ON sm.id =ckl.shed_id
      LEFT JOIN shed_part_master spm ON spm.id=ckl.part_id
      LEFT JOIN shed_line_master slm ON slm.id=ckl.line_id
      WHERE ckl.flock_no=$1 AND ckl.entry_date=$2
    `,[flock_no,date]);
    if (lr.rowCount===0) return res.json({ success:true, has_entry:false, flock_no, date, data:null });
    const log = lr.rows[0];
    const reasons = (await pool.query(`SELECT * FROM cull_kill_reason_log WHERE cull_kill_id=$1`,[log.id])).rows;
    const photosR = (await pool.query(`SELECT * FROM cull_kill_photo_log  WHERE cull_kill_id=$1 ORDER BY photo_type_id`,[log.id])).rows;
    const photos  = {};
    for (const p of photosR) {
      if (!photos[p.photo_type_id]) photos[p.photo_type_id]={type_name:p.type_name,images:[]};
      photos[p.photo_type_id].images.push(p.image_path);
    }
    return res.json({ success:true, has_entry:true, flock_no, date, data:{...formatRow(log),reasons,photos} });
  } catch(err) { return res.status(500).json({ success:false, message:err.message }); }
};

// ═══════════════════════════════════════════════════════════════════════════
// ADMIN MASTERS CRUD
// ═══════════════════════════════════════════════════════════════════════════
const mGet = async (t,res) => { const r=await pool.query(`SELECT * FROM ${t} WHERE is_active=TRUE ORDER BY id`); return res.json({success:true,total:r.rowCount,data:r.rows}); };
const mAdd = async (t,nf,body,res) => { const n=body[nf]; if(!n) return res.status(422).json({success:false,message:`${nf} required`}); const r=await pool.query(`INSERT INTO ${t} (${nf}) VALUES ($1) RETURNING *`,[n]); return res.status(201).json({success:true,data:r.rows[0]}); };
const mUpd = async (t,nf,id,body,res) => { const {is_active}=body; const n=body[nf]; const sets=[],vals=[];let idx=1; if(n!==undefined){sets.push(`${nf}=$${idx++}`);vals.push(n);} if(is_active!==undefined){sets.push(`is_active=$${idx++}`);vals.push(is_active);} if(!sets.length) return res.status(400).json({success:false,message:'Nothing to update'}); sets.push(`updated_at=NOW()`);vals.push(id); const r=await pool.query(`UPDATE ${t} SET ${sets.join(',')} WHERE id=$${idx} RETURNING *`,vals); if(r.rowCount===0) return res.status(404).json({success:false,message:'Not found'}); return res.json({success:true,data:r.rows[0]}); };
const mDel = async (t,id,res) => { const r=await pool.query(`UPDATE ${t} SET is_active=FALSE WHERE id=$1 RETURNING id`,[id]); if(r.rowCount===0) return res.status(404).json({success:false,message:'Not found'}); return res.json({success:true,message:'Deleted'}); };

exports.getMortalityReasonMaster    = (req,res)=>mGet('mortality_reason_master',res);
exports.addMortalityReason          = (req,res)=>mAdd('mortality_reason_master','reason_name',req.body,res);
exports.updateMortalityReason       = (req,res)=>mUpd('mortality_reason_master','reason_name',req.params.id,req.body,res);
exports.deleteMortalityReason       = (req,res)=>mDel('mortality_reason_master',req.params.id,res);

exports.getCullKillReasonMaster     = (req,res)=>mGet('cull_kill_reason_master',res);
exports.addCullKillReason           = (req,res)=>mAdd('cull_kill_reason_master','reason_name',req.body,res);
exports.updateCullKillReason        = (req,res)=>mUpd('cull_kill_reason_master','reason_name',req.params.id,req.body,res);
exports.deleteCullKillReason        = (req,res)=>mDel('cull_kill_reason_master',req.params.id,res);

exports.getMortalityPhotoTypeMaster = (req,res)=>mGet('mortality_photo_type',res);
exports.addMortalityPhotoType       = async (req,res)=>{const{type_name,is_multiple}=req.body;if(!type_name)return res.status(422).json({success:false,message:'type_name required'});const r=await pool.query(`INSERT INTO mortality_photo_type (type_name,is_multiple) VALUES ($1,$2) RETURNING *`,[type_name,is_multiple??true]);return res.status(201).json({success:true,data:r.rows[0]});};
exports.updateMortalityPhotoType    = (req,res)=>mUpd('mortality_photo_type','type_name',req.params.id,req.body,res);
exports.deleteMortalityPhotoType    = (req,res)=>mDel('mortality_photo_type',req.params.id,res);

exports.getCullKillPhotoTypeMaster  = (req,res)=>mGet('cull_kill_photo_type',res);
exports.addCullKillPhotoType        = async (req,res)=>{const{type_name,is_multiple}=req.body;if(!type_name)return res.status(422).json({success:false,message:'type_name required'});const r=await pool.query(`INSERT INTO cull_kill_photo_type (type_name,is_multiple) VALUES ($1,$2) RETURNING *`,[type_name,is_multiple??true]);return res.status(201).json({success:true,data:r.rows[0]});};
exports.updateCullKillPhotoType     = (req,res)=>mUpd('cull_kill_photo_type','type_name',req.params.id,req.body,res);
exports.deleteCullKillPhotoType     = (req,res)=>mDel('cull_kill_photo_type',req.params.id,res);

// Shed Master CRUD
exports.addShed    = async (req,res)=>{const{plant_code,shed_no,shed_name}=req.body;if(!plant_code||!shed_no)return res.status(422).json({success:false,message:'plant_code and shed_no required'});try{const r=await pool.query(`INSERT INTO shed_master (plant_code,shed_no,shed_name) VALUES ($1,$2,$3) RETURNING *`,[plant_code,shed_no,shed_name||null]);return res.status(201).json({success:true,data:r.rows[0]});}catch(err){return res.status(500).json({success:false,message:err.message});}};
exports.updateShed = (req,res)=>mUpd('shed_master','shed_name',req.params.id,req.body,res);
exports.deleteShed = (req,res)=>mDel('shed_master',req.params.id,res);

exports.addPart    = async (req,res)=>{const{shed_id,part_row_no,cum_birds}=req.body;if(!shed_id||!part_row_no)return res.status(422).json({success:false,message:'shed_id and part_row_no required'});try{const r=await pool.query(`INSERT INTO shed_part_master (shed_id,part_row_no,cum_birds) VALUES ($1,$2,$3) RETURNING *`,[shed_id,part_row_no,cum_birds||0]);return res.status(201).json({success:true,data:r.rows[0]});}catch(err){return res.status(500).json({success:false,message:err.message});}};
exports.updatePart = async (req,res)=>{const{part_row_no,cum_birds,is_active}=req.body;const sets=[],vals=[];let idx=1;if(part_row_no!==undefined){sets.push(`part_row_no=$${idx++}`);vals.push(part_row_no);}if(cum_birds!==undefined){sets.push(`cum_birds=$${idx++}`);vals.push(cum_birds);}if(is_active!==undefined){sets.push(`is_active=$${idx++}`);vals.push(is_active);}if(!sets.length)return res.status(400).json({success:false,message:'Nothing to update'});vals.push(req.params.id);const r=await pool.query(`UPDATE shed_part_master SET ${sets.join(',')} WHERE id=$${idx} RETURNING *`,vals);if(r.rowCount===0)return res.status(404).json({success:false,message:'Not found'});return res.json({success:true,data:r.rows[0]});};
exports.deletePart = (req,res)=>mDel('shed_part_master',req.params.id,res);

exports.addLine    = async (req,res)=>{const{part_id,line_no,total_male,total_female}=req.body;if(!part_id||!line_no)return res.status(422).json({success:false,message:'part_id and line_no required'});try{const r=await pool.query(`INSERT INTO shed_line_master (part_id,line_no,male_birds,female_birds) VALUES ($1,$2,$3,$4) RETURNING *`,[part_id,line_no,total_male||0,total_female||0]);return res.status(201).json({success:true,data:r.rows[0]});}catch(err){return res.status(500).json({success:false,message:err.message});}};
exports.updateLine = async (req,res)=>{const{line_no,total_male,total_female,is_active}=req.body;const sets=[],vals=[];let idx=1;if(line_no!==undefined){sets.push(`line_no=$${idx++}`);vals.push(line_no);}if(total_male!==undefined){sets.push(`male_birds=$${idx++}`);vals.push(total_male);}if(total_female!==undefined){sets.push(`female_birds=$${idx++}`);vals.push(total_female);}if(is_active!==undefined){sets.push(`is_active=$${idx++}`);vals.push(is_active);}if(!sets.length)return res.status(400).json({success:false,message:'Nothing to update'});vals.push(req.params.id);const r=await pool.query(`UPDATE shed_line_master SET ${sets.join(',')} WHERE id=$${idx} RETURNING *`,vals);if(r.rowCount===0)return res.status(404).json({success:false,message:'Not found'});return res.json({success:true,data:r.rows[0]});};
exports.deleteLine = (req,res)=>mDel('shed_line_master',req.params.id,res);
