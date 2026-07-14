require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const axios = require('axios');

const codes = (process.argv[2] || 'FG000096,MD000125')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const werks = process.argv[3] || '1902';
const aufnr = process.argv[4] || '000010007311';
const flock = process.argv[5] || 'LY000001';

const SAP_BASE = process.env.SAP_BASE_URL || 'http://krishidevqas.krishinutrition.com:8001/sap/bc/breeder';
const SAP_MASTERS_URL = process.env.SAP_MASTERS_URL || String(SAP_BASE).replace(/\/breeder\/?$/i, '');
const SAP_AUTH = { username: process.env.SAP_USER || 'vega', password: process.env.SAP_PASSWORD || 'Vegaintell@123' };
const SAP_CLIENT = process.env.SAP_CLIENT || '500';

function deepContains(obj, code) {
  const tgt = String(code || '').toUpperCase();
  const stack = [obj];
  while (stack.length) {
    const cur = stack.pop();
    if (cur == null) continue;
    if (typeof cur === 'string' || typeof cur === 'number') {
      if (String(cur).trim().toUpperCase() === tgt) return true;
      continue;
    }
    if (Array.isArray(cur)) {
      for (const v of cur) stack.push(v);
      continue;
    }
    if (typeof cur === 'object') {
      for (const v of Object.values(cur)) stack.push(v);
    }
  }
  return false;
}

async function run() {
  const mRes = await axios.get(`${SAP_MASTERS_URL}/masters/material`, {
    auth: SAP_AUTH,
    params: { 'sap-client': SAP_CLIENT, werks },
    timeout: 30000,
  });
  const materials = Array.isArray(mRes.data) ? mRes.data : (mRes.data?.results || []);
  const byCode = new Map(materials.map((r) => [String(r?.matnr || '').trim(), r]));

  const zRes = await axios.get(`${SAP_BASE}/zfeed_med`, {
    auth: SAP_AUTH,
    params: { 'sap-client': SAP_CLIENT, werks },
    timeout: 30000,
  });
  const zRows = Array.isArray(zRes.data) ? zRes.data : (zRes.data?.results || []);
  const ctx = zRows.find((r) => {
    const rAuf = String(r?.aufnr || r?.generalInfo?.aufnr || '').trim();
    const rFlock = String(r?.plnbez || r?.generalInfo?.plnbez || '').trim();
    return rAuf === aufnr && rFlock === flock;
  });

  const out = codes.map((code) => {
    const hit = byCode.get(code);
    const inOrder = ctx ? deepContains(ctx, code) : false;
    return {
      code,
      found_in_material_master: !!hit,
      maktx: hit ? String(hit.maktx || '') : '',
      meins: hit ? String(hit.meins || '') : '',
      mtart: hit ? String(hit.mtart || '') : '',
      present_in_order_context: inOrder,
    };
  });

  console.log(JSON.stringify({ werks, aufnr, flock, order_context_found: !!ctx, results: out }, null, 2));
}

run().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
