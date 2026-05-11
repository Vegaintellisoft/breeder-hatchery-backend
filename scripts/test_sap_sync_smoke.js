/**
 * Offline smoke checks for SAP outbound wiring (no DB, no network).
 * Run: node scripts/test_sap_sync_smoke.js
 */
const assert = require('assert');
const {
  buildSapPostUrl,
  interpretSapResponse,
} = require('../src/services/sapOutboundPush');

function run() {
  const url = buildSapPostUrl('zfeed_med', {
    dmfdet: JSON.stringify([{ werks: '1901', matnr: 'X' }]),
  });
  assert(url.includes('sap-client'), 'URL must include sap-client');
  assert(url.includes('dmfdet='), 'URL must include dmfdet');
  assert(url.startsWith('http'), 'URL must be absolute');

  const okRes = { status: 200, data: { ok: true } };
  const irOk = interpretSapResponse(okRes);
  assert(irOk.ok === true, '200 should be ok');

  const badRes = { status: 400, data: '<html>bad request</html>' };
  const irBad = interpretSapResponse(badRes);
  assert(irBad.ok === false, '400 should not be ok');
  assert(typeof irBad.message === 'string' && irBad.message.length > 0, 'should summarize error');

  console.log('✅ sap_sync_smoke: buildSapPostUrl + interpretSapResponse OK');
  console.log('   sample:', url.slice(0, 120) + '…');
}

run();
