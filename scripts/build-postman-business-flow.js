/**
 * Generates KRISHI-SAP-All-Modules-Business-Flow.postman_collection.json
 * Run: node scripts/build-postman-business-flow.js
 */
const fs = require('fs');
const path = require('path');

function req(name, method, urlPath, bodyRaw = null, testScript = null) {
  const h = [{ key: 'Authorization', value: 'Bearer {{token}}' }];
  if (method !== 'GET') h.push({ key: 'Content-Type', value: 'application/json' });
  const r = { name, request: { method, header: h, url: '{{base_url}}' + urlPath } };
  if (bodyRaw) r.request.body = { mode: 'raw', raw: bodyRaw };
  if (testScript) r.event = [{ listen: 'test', script: { type: 'text/javascript', exec: testScript } }];
  return r;
}

const login = {
  name: '00 Login (sets token)',
  request: {
    method: 'POST',
    header: [{ key: 'Content-Type', value: 'application/json' }],
    url: '{{base_url}}/api/admin/login',
    body: {
      mode: 'raw',
      raw: '{\n  "username": "{{username}}",\n  "password": "{{password}}"\n}',
    },
  },
  event: [
    {
      listen: 'test',
      script: {
        type: 'text/javascript',
        exec: [
          'let j = {};',
          'try { j = pm.response.json(); } catch (e) {}',
          'const t = j.token || j.data?.token || "";',
          'if (t) pm.collectionVariables.set("token", t);',
        ],
      },
    },
  ],
};

const feeding = [
  req('01 GET Plants', 'GET', '/api/sap-live/plants'),
  req('02 GET Orders (feeding)', 'GET', '/api/sap-live/orders?module=feeding&werks={{plant_code}}'),
  req('03 GET Flocks (feeding)', 'GET', '/api/sap-live/flocks?module=feeding&werks={{plant_code}}&aufnr={{order_no}}'),
  req('04 GET SAP Materials (feed)', 'GET', '/api/daily-activity/sap/materials?plant_code={{plant_code}}&type=feed'),
  req('05 GET Feeding Items (local master)', 'GET', '/api/daily-activity/feeding/items?plant_code={{plant_code}}&type=feed&module=Breeder'),
  req('06 GET Feeding Stock (local)', 'GET', '/api/daily-activity/feeding/stock?plant_code={{plant_code}}&type=feed&module=Breeder'),
  req('06A GET SAP Material Stock (lgort)', 'GET', '/api/daily-activity/sap/material-stock?plant_code={{plant_code}}&matnr={{sap_matnr}}'),
  req(
    '07 GET Flock Detail / Activity menu',
    'GET',
    '/api/daily-activity/flock-detail/{{flock_no}}?plant_code={{plant_code}}',
    null,
    [
      'let j = {};',
      'try { j = pm.response.json(); } catch (e) {}',
      'const a = j.data?.age_days ?? j.data?.flock_info?.age_days;',
      'if (a != null) pm.collectionVariables.set("age_days", String(a));',
    ]
  ),
  req(
    '08 POST Feeding Save (qty <= SAP stock)',
    'POST',
    '/api/daily-activity/feeding/save',
    [
      '{',
      '  "flock_no": "{{flock_no}}",',
      '  "plant_code": "{{plant_code}}",',
      '  "order_no": "{{order_no}}",',
      '  "batch_no": "{{sap_batch}}",',
      '  "feed_date": "{{today_ymd}}",',
      '  "feed_type": "feed",',
      '  "zzage": {{age_days}},',
      '  "items": [',
      '    {',
      '      "sap_matnr": "{{sap_matnr}}",',
      '      "lgort": "{{sap_lgort}}",',
      '      "qty_issued_male": 1,',
      '      "qty_issued_female": 1,',
      '      "cum_feed": 2',
      '    }',
      '  ]',
      '}',
    ].join('\n'),
    [
      'let j = {};',
      'try { j = pm.response.json(); } catch (e) {}',
      'const id = j.saved?.[0]?.id;',
      'if (id) pm.collectionVariables.set("feeding_record_id", String(id));',
      'const bw = j.bird_weight?.id;',
      'if (bw) pm.collectionVariables.set("bird_weight_record_id", String(bw));',
    ]
  ),
  req(
    '09 POST SAP Sync (marks sap_synced if SAP OK)',
    'POST',
    '/api/sap-sync',
    '{\n  "module": "feeding",\n  "record_id": {{feeding_record_id}}\n}'
  ),
  req('10 GET SAP Sync Status', 'GET', '/api/sap-sync/status?module=feeding&record_id={{feeding_record_id}}'),
];

const egg = [
  req('01 GET Plants', 'GET', '/api/sap-live/plants'),
  req('02 GET Orders (laying)', 'GET', '/api/sap-live/orders?module=laying&werks={{plant_code}}'),
  req('03 GET Flocks (laying)', 'GET', '/api/sap-live/flocks?module=laying&werks={{plant_code}}&aufnr={{order_no}}'),
  req(
    '04 GET Egg Dropdowns',
    'GET',
    '/api/egg-collection/v2/dropdowns?plant_code={{plant_code}}&flock_no={{flock_no}}',
    null,
    [
      'let j = {};',
      'try { j = pm.response.json(); } catch (e) {}',
      'const a = j.age_days ?? j.data?.age_days;',
      'if (a != null) pm.collectionVariables.set("age_days", String(a));',
    ]
  ),
  req('05 GET Sheds', 'GET', '/api/egg-collection/v2/sheds?plant_code={{plant_code}}'),
  req('06 GET Parts', 'GET', '/api/egg-collection/v2/parts?shed_id={{shed_id}}'),
  req('07 GET Lines', 'GET', '/api/egg-collection/v2/lines?part_id={{part_id}}'),
  req('08 GET Egg Types', 'GET', '/api/egg-collection/v2/egg-types'),
  req(
    '09 POST Egg Collection Save',
    'POST',
    '/api/egg-collection/v2/save',
    [
      '{',
      '  "flock_no": "{{flock_no}}",',
      '  "plant_code": "{{plant_code}}",',
      '  "order_no": "{{order_no}}",',
      '  "collection_date": "{{today_ymd}}",',
      '  "age_days": {{age_days}},',
      '  "season": "Summer",',
      '  "slots": [',
      '    {',
      '      "schedule_time": "7-8",',
      '      "egg_weight": 58.5,',
      '      "rows": [',
      '        {',
      '          "shed_id": {{shed_id}},',
      '          "part_id": {{part_id}},',
      '          "line_id": {{line_id}},',
      '          "table_egg": 10,',
      '          "jumbo_egg": 2,',
      '          "crack_egg": 1,',
      '          "waste_reject_egg": 0,',
      '          "hatching_egg": 15',
      '        }',
      '      ]',
      '    }',
      '  ]',
      '}',
    ].join('\n'),
    [
      'let j = {};',
      'try { j = pm.response.json(); } catch (e) {}',
      'const id = j.data?.id;',
      'if (id) pm.collectionVariables.set("egg_record_id", String(id));',
    ]
  ),
  req('10 POST SAP Sync', 'POST', '/api/sap-sync', '{\n  "module": "egg_collection",\n  "record_id": {{egg_record_id}}\n}'),
  req('11 GET SAP Sync Status', 'GET', '/api/sap-sync/status?module=egg_collection&record_id={{egg_record_id}}'),
];

const mort = [
  req('01 GET Plants', 'GET', '/api/sap-live/plants'),
  req('02 GET Orders (mortality)', 'GET', '/api/sap-live/orders?module=mortality&werks={{plant_code}}'),
  req('03 GET Flocks (mortality)', 'GET', '/api/sap-live/flocks?module=mortality&werks={{plant_code}}&aufnr={{order_no}}'),
  req('04 GET Sheds', 'GET', '/api/farm/sheds?plant_code={{plant_code}}'),
  req('05 GET Parts', 'GET', '/api/farm/parts?shed_id={{shed_id}}'),
  req('06 GET Lines', 'GET', '/api/farm/lines?part_id={{part_id}}'),
  req('07 GET Line Info', 'GET', '/api/farm/line-info?line_id={{line_id}}'),
  req('08 GET Mortality Reasons', 'GET', '/api/farm/mortality/reasons'),
  req(
    '09 POST Mortality Save',
    'POST',
    '/api/farm/mortality/save',
    [
      '{',
      '  "flock_no": "{{flock_no}}",',
      '  "plant_code": "{{plant_code}}",',
      '  "order_no": "{{order_no}}",',
      '  "shed_id": {{shed_id}},',
      '  "part_id": {{part_id}},',
      '  "line_id": {{line_id}},',
      '  "entry_date": "{{today_ymd}}",',
      '  "schedule": [{"slot":"morning","male":1,"female":0}],',
      '  "reasons": [{"reason_name":"Test","male":1,"female":0}]',
      '}',
    ].join('\n'),
    [
      'let j = {};',
      'try { j = pm.response.json(); } catch (e) {}',
      'const id = j.mortality_id;',
      'if (id) pm.collectionVariables.set("mortality_record_id", String(id));',
    ]
  ),
  req('10 POST SAP Sync', 'POST', '/api/sap-sync', '{\n  "module": "mortality",\n  "record_id": {{mortality_record_id}}\n}'),
  req('11 GET SAP Sync Status', 'GET', '/api/sap-sync/status?module=mortality&record_id={{mortality_record_id}}'),
];

const ckill = [
  req('01 GET Plants', 'GET', '/api/sap-live/plants'),
  req('02 GET Orders (cull_kill)', 'GET', '/api/sap-live/orders?module=cull_kill&werks={{plant_code}}'),
  req('03 GET Flocks (cull_kill)', 'GET', '/api/sap-live/flocks?module=cull_kill&werks={{plant_code}}&aufnr={{order_no}}'),
  req('04 GET Sheds', 'GET', '/api/farm/sheds?plant_code={{plant_code}}'),
  req('05 GET Parts', 'GET', '/api/farm/parts?shed_id={{shed_id}}'),
  req('06 GET Lines', 'GET', '/api/farm/lines?part_id={{part_id}}'),
  req('07 GET Line Info', 'GET', '/api/farm/line-info?line_id={{line_id}}'),
  req('08 GET Cull-Kill Reasons', 'GET', '/api/farm/cull-kill/reasons'),
  req(
    '09 POST Cull Kill Save',
    'POST',
    '/api/farm/cull-kill/save',
    [
      '{',
      '  "flock_no": "{{flock_no}}",',
      '  "plant_code": "{{plant_code}}",',
      '  "order_no": "{{order_no}}",',
      '  "shed_id": {{shed_id}},',
      '  "part_id": {{part_id}},',
      '  "line_id": {{line_id}},',
      '  "entry_date": "{{today_ymd}}",',
      '  "schedule": [{"slot":"morning","male":1,"female":0}],',
      '  "reasons": [{"reason_name":"Test","male":1,"female":0}]',
      '}',
    ].join('\n'),
    [
      'let j = {};',
      'try { j = pm.response.json(); } catch (e) {}',
      'const id = j.cull_kill_id;',
      'if (id) pm.collectionVariables.set("cull_kill_record_id", String(id));',
    ]
  ),
  req('10 POST SAP Sync', 'POST', '/api/sap-sync', '{\n  "module": "cull_kill",\n  "record_id": {{cull_kill_record_id}}\n}'),
  req('11 GET SAP Sync Status', 'GET', '/api/sap-sync/status?module=cull_kill&record_id={{cull_kill_record_id}}'),
];

const cs = [
  req('01 GET Plants', 'GET', '/api/sap-live/plants'),
  req('02 GET Orders (cull_sale)', 'GET', '/api/sap-live/orders?module=cull_sale&werks={{plant_code}}'),
  req('03 GET Flocks (cull_sale)', 'GET', '/api/sap-live/flocks?module=cull_sale&werks={{plant_code}}&aufnr={{order_no}}'),
  req('04 GET Cull Sales Flocks', 'GET', '/api/cull-sales/flocks?plant_code={{plant_code}}'),
  req('05 GET Sheds', 'GET', '/api/cull-sales/sheds?plant_code={{plant_code}}'),
  req('06 GET Parts', 'GET', '/api/cull-sales/parts?shed_id={{shed_id}}'),
  req('07 GET Lines', 'GET', '/api/cull-sales/lines?part_id={{part_id}}'),
  req('08 GET All Dropdowns', 'GET', '/api/cull-sales/dropdowns?plant_code={{plant_code}}'),
  req('09 GET Calculate Load (optional)', 'GET', '/api/cull-sales/calculate-load?empty_weight=5&load_weight=130&birds_male=10&birds_female=10'),
  req(
    '10 POST Cull Sales Save',
    'POST',
    '/api/cull-sales/save',
    [
      '{',
      '  "flock_no": "{{flock_no}}",',
      '  "plant_code": "{{plant_code}}",',
      '  "order_no": "{{order_no}}",',
      '  "entry_date": "{{today_ymd}}",',
      '  "shed_id": {{shed_id}},',
      '  "part_id": {{part_id}},',
      '  "line_id": {{line_id}},',
      '  "batch_no": "{{sap_batch}}",',
      '  "age": {{age_days}},',
      '  "bird_stock": 1000,',
      '  "customer_type": "Retail",',
      '  "customer": "Test Customer",',
      '  "sales_type": "Cash",',
      '  "transport_by": "Own",',
      '  "vehicle_no": "TN00AA0000",',
      '  "driver_name": "Driver",',
      '  "driver_mobile": "9000000000",',
      '  "order_by": "OB",',
      '  "dispatched_by": "DB",',
      '  "load_details": [{"cage_no":1,"empty_weight":5,"birds_male":5,"birds_female":5,"load_weight":80}],',
      '  "rate": 100,',
      '  "net_weight_male": 25,',
      '  "net_weight_female": 25,',
      '  "avg_weight_male": 5,',
      '  "avg_weight_female": 5,',
      '  "gross_value": 5000,',
      '  "bill_value": 5000,',
      '  "remarks": "test"',
      '}',
    ].join('\n'),
    [
      'let j = {};',
      'try { j = pm.response.json(); } catch (e) {}',
      'const id = j.id;',
      'if (id) pm.collectionVariables.set("cull_sales_record_id", String(id));',
    ]
  ),
  req('11 POST SAP Sync', 'POST', '/api/sap-sync', '{\n  "module": "cull_sales",\n  "record_id": {{cull_sales_record_id}}\n}'),
  req('12 GET SAP Sync Status', 'GET', '/api/sap-sync/status?module=cull_sales&record_id={{cull_sales_record_id}}'),
];

const bird = [
  req('01 GET Plants', 'GET', '/api/sap-live/plants'),
  req('02 GET Orders (bird_receipt)', 'GET', '/api/sap-live/orders?module=bird_receipt&werks={{plant_code}}'),
  req('03 GET Flocks (bird_receipt)', 'GET', '/api/sap-live/flocks?module=bird_receipt&werks={{plant_code}}&aufnr={{order_no}}'),
  req('04 GET SAP Materials (feed)', 'GET', '/api/daily-activity/sap/materials?plant_code={{plant_code}}&type=feed'),
  req(
    '05 POST Feeding Save + bird weights (flock_bird_weight)',
    'POST',
    '/api/daily-activity/feeding/save',
    [
      '{',
      '  "flock_no": "{{flock_no}}",',
      '  "plant_code": "{{plant_code}}",',
      '  "order_no": "{{order_no}}",',
      '  "batch_no": "{{sap_batch}}",',
      '  "feed_date": "{{today_ymd}}",',
      '  "feed_type": "feed",',
      '  "male_weight": 4.5,',
      '  "female_weight": 3.8,',
      '  "items": [',
      '    {"sap_matnr":"{{sap_matnr}}","lgort":"{{sap_lgort}}","qty_issued_male":1,"qty_issued_female":1,"cum_feed":2}',
      '  ]',
      '}',
    ].join('\n'),
    [
      'let j = {};',
      'try { j = pm.response.json(); } catch (e) {}',
      'const bw = j.bird_weight?.id;',
      'if (bw) pm.collectionVariables.set("bird_weight_record_id", String(bw));',
    ]
  ),
  req(
    '06 POST SAP Sync (bird_weighing)',
    'POST',
    '/api/sap-sync',
    '{\n  "module": "bird_weighing",\n  "record_id": {{bird_weight_record_id}}\n}'
  ),
  req('07 GET SAP Sync Status', 'GET', '/api/sap-sync/status?module=bird_weighing&record_id={{bird_weight_record_id}}'),
];

const diag = [
  req('Push only – feeding (no sap_synced flag)', 'POST', '/api/sap-sync/push', '{\n  "module": "feeding",\n  "record_id": {{feeding_record_id}}\n}'),
  req('Push only – egg_collection', 'POST', '/api/sap-sync/push', '{\n  "module": "egg_collection",\n  "record_id": {{egg_record_id}}\n}'),
  req('List unsynced (admin)', 'GET', '/api/sap-sync/unsynced?limit=30'),
];

const collection = {
  info: {
    _postman_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    name: 'KRISHI SAP – All Modules Business Flow (screenshot style)',
    description:
      'Each folder: Plants → Orders → Flocks → module reads → Save → POST /api/sap-sync → GET status. Login first. sap-live requires ?module=… per screen. Bird weighing uses flock_bird_weight id from feeding save response.',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  variable: [
    { key: 'base_url', value: 'http://localhost:3000' },
    { key: 'username', value: 'admin' },
    { key: 'password', value: 'admin123' },
    { key: 'token', value: '' },
    { key: 'plant_code', value: '1902' },
    { key: 'order_no', value: '000010007311' },
    { key: 'flock_no', value: 'LY000001' },
    { key: 'today_ymd', value: '2026-05-07' },
    { key: 'sap_matnr', value: 'FG000096' },
    { key: 'sap_lgort', value: '0012' },
    { key: 'sap_batch', value: 'BD-1' },
    { key: 'age_days', value: '583' },
    { key: 'shed_id', value: '1' },
    { key: 'part_id', value: '1' },
    { key: 'line_id', value: '1' },
    { key: 'feeding_record_id', value: '' },
    { key: 'egg_record_id', value: '' },
    { key: 'mortality_record_id', value: '' },
    { key: 'cull_kill_record_id', value: '' },
    { key: 'cull_sales_record_id', value: '' },
    { key: 'bird_weight_record_id', value: '' },
  ],
  item: [
    login,
    { name: 'A Feeding — Plant → Order → Flock → Materials → Stock → Save → SAP Sync', item: feeding },
    { name: 'B Egg Collection — Plant → Order → Flock → Shed chain → Save → SAP Sync', item: egg },
    { name: 'C Mortality — Plant → Order → Flock → Shed → Save → SAP Sync', item: mort },
    { name: 'D Cull Kill — Plant → Order → Flock → Shed → Save → SAP Sync', item: ckill },
    { name: 'E Cull Sales — Plant → Order → Flock → Dropdowns → Save → SAP Sync', item: cs },
    { name: 'F Bird Weighing — bird_receipt chain → feeding save weights → SAP Sync', item: bird },
    { name: 'Z Diagnostics', item: diag },
  ],
};

const out = path.join(__dirname, '..', 'KRISHI-SAP-All-Modules-Business-Flow.postman_collection.json');
fs.writeFileSync(out, JSON.stringify(collection, null, 2));
console.log('Wrote', out);
