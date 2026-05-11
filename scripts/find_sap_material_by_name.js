require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const axios = require('axios');

const plant = process.argv[2] || '1902';
const term = String(process.argv[3] || 'amox').toLowerCase();

const SAP_BASE = process.env.SAP_BASE_URL || 'http://krishidevqas.krishinutrition.com:8001/sap/bc/breeder';
const SAP_MASTERS_URL = process.env.SAP_MASTERS_URL || String(SAP_BASE).replace('/breeder', '');
const SAP_AUTH = { username: process.env.SAP_USER || 'vega', password: process.env.SAP_PASSWORD || 'Vega@1234' };
const SAP_CLIENT = process.env.SAP_CLIENT || '500';

async function run() {
  const res = await axios.get(`${SAP_MASTERS_URL}/masters/material`, {
    auth: SAP_AUTH,
    params: { 'sap-client': SAP_CLIENT, werks: plant },
    timeout: 30000,
  });
  const rows = Array.isArray(res.data) ? res.data : (res.data?.results || []);
  const out = rows
    .filter((r) => String(r?.maktx || '').toLowerCase().includes(term))
    .slice(0, 30)
    .map((r) => ({
      matnr: r.matnr,
      maktx: r.maktx,
      meins: r.meins,
      mtart: r.mtart,
    }));
  console.log(JSON.stringify({ plant, term, count: out.length, rows: out }, null, 2));
}

run().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
