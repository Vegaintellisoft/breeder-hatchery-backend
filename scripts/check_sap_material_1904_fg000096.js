require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const axios = require('axios');

const SAP_MASTERS_URL =
  process.env.SAP_MASTERS_URL ||
  'http://krishidevqas.krishinutrition.com:8001/sap/bc/masters';

const SAP_AUTH = {
  username: process.env.SAP_USER || 'vega',
  password: process.env.SAP_PASSWORD || 'Vegaintell@123',
};

const SAP_CLIENT = process.env.SAP_CLIENT || '500';

async function run() {
  const werks = '1904';
  const matnr = 'FG000096';

  const res = await axios.get(`${SAP_MASTERS_URL}/material`, {
    auth: SAP_AUTH,
    params: { 'sap-client': SAP_CLIENT, werks, matnr },
    timeout: 30000,
  });

  const data = res.data;
  const rows = Array.isArray(data) ? data : (data?.results || []);
  const hits = rows
    .filter((r) => String(r?.matnr || '').trim() === matnr)
    .slice(0, 10)
    .map((r) => ({
      matnr: r.matnr,
      maktx: r.maktx,
      meins: r.meins,
      mtart: r.mtart,
      werks: r.werks,
      lgort: r.lgort,
      labst: r.labst,
      charg: r.charg,
      bwkey: r.bwkey,
    }));

  console.log(
    JSON.stringify(
      {
        http_status: res.status,
        werks,
        matnr,
        total_rows: rows.length,
        hits,
        note:
          'If lgort/labst are present, SAP is returning stock-like fields along with master.',
      },
      null,
      2
    )
  );
}

run().catch((e) => {
  console.error(e.response?.status || 'ERR', e.response?.data || e.message);
  process.exit(1);
});

