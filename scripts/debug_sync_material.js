require('dotenv').config();
const ctrl = require('../src/controllers/dailyActivityController');

const req = {
  body: {
    sync_all: true,
    plant_code: '1901',
    module: 'Breeder',
  },
  user: { username: 'debug-admin' },
};

const res = {
  statusCode: 200,
  status(code) { this.statusCode = code; return this; },
  json(payload) {
    console.log(JSON.stringify({ statusCode: this.statusCode, payload }, null, 2));
    return payload;
  },
};

ctrl.syncSAPToMaster(req, res).catch((e) => {
  console.error(e);
  process.exit(1);
});
