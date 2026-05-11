require('dotenv').config();
const pool = require('../src/config/db');

async function runMigration() {
  const client = await pool.connect();
  try {
    console.log('\n🚀 Running Vaccination Master Migration...\n');
    await client.query('BEGIN');

    // ── 1. VACCINATION PROGRAM HEADER ─────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS vaccination_program_header (
        id           SERIAL PRIMARY KEY,
        program_name VARCHAR(200) NOT NULL,
        doc_date     DATE,
        start_date   DATE,
        end_date     DATE,
        season       VARCHAR(20) DEFAULT 'all'
                     CHECK (season IN ('summer','winter','all')),
        remarks      TEXT,
        is_active    BOOLEAN DEFAULT TRUE,
        created_by   VARCHAR(100),
        created_at   TIMESTAMP DEFAULT NOW(),
        updated_by   VARCHAR(100),
        updated_at   TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('  ✔ Table: vaccination_program_header');

    // ── 2. VACCINATION PROGRAM DETAIL (multi-line per header) ─────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS vaccination_program_detail (
        id            SERIAL PRIMARY KEY,
        header_id     INT NOT NULL
                      REFERENCES vaccination_program_header(id) ON DELETE CASCADE,
        s_no          INT,
        day_number    INT NOT NULL,
        week_number   NUMERIC(5,2),
        disease       VARCHAR(200),
        vaccine_name  VARCHAR(200),
        vaccine_type  VARCHAR(20)
                      CHECK (vaccine_type IN ('Live','Killed','Antibiotic','Activity','Other') OR vaccine_type IS NULL),
        manufacturer  VARCHAR(100),
        dose          VARCHAR(50),
        route         VARCHAR(50),
        category      VARCHAR(20) DEFAULT 'vaccine',
        is_active     BOOLEAN DEFAULT TRUE,
        created_at    TIMESTAMP DEFAULT NOW(),
        updated_at    TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_vpd_header_id  ON vaccination_program_detail(header_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_vpd_day_number ON vaccination_program_detail(day_number);`);
    console.log('  ✔ Table: vaccination_program_detail');

    // ── 3. SEED HEADER — BD-8 Vencobb 430Y ───────────────────────────────
    const headerRes = await client.query(`
      INSERT INTO vaccination_program_header
        (program_name, doc_date, season, remarks, created_by)
      VALUES ($1, CURRENT_DATE, 'all', 'BD-8 Vencobb 430Y Breeder Vaccination Program seeded from Excel', 'system')
      ON CONFLICT DO NOTHING
      RETURNING id
    `, ['BD-8 Vencobb 430Y Breeder Vaccination Program']);

    let headerId;
    if (headerRes.rowCount > 0) {
      headerId = headerRes.rows[0].id;
    } else {
      const existing = await client.query(
        `SELECT id FROM vaccination_program_header WHERE program_name = $1`,
        ['BD-8 Vencobb 430Y Breeder Vaccination Program']
      );
      headerId = existing.rows[0].id;
    }
    console.log(`  ✔ Header seeded: id=${headerId}`);

    // ── 4. SEED DETAIL — All 82 records from Excel ───────────────────────
    const details = [
      [1,  1,   0.1,  'IB L V - 1',          'IB H120',                    'Live',       'Phibro',  '0.03ml',     'Eye Drop',  'vaccine'],
      [2,  1,   0.1,  'MD L - 1/1',           "Prevexxion (Marek's Booster)",'Live',      'Merial',  '0.2ml',      'S/C Neck',  'vaccine'],
      [3,  3,   0.4,  'AB',                   'Antibiotic',                 'Antibiotic', 'Elanco',  null,         'D/W',       'antibiotic'],
      [4,  7,   1.0,  'ND B1',                'ND B1',                      'Live',       'Ventri',  '0.03ml',     'Eye Drop',  'vaccine'],
      [5,  8,   1.1,  'ND+IBD K - 1',         'ND + IBD',                   'Killed',     'Ventri',  '0.25ml',     'S/C Neck',  'vaccine'],
      [6,  9,   1.3,  'Debeak - 1/2',         'Beak Debeaking, 3 days',     'Activity',   null,      null,         null,        'activity'],
      [7,  12,  1.7,  'IBD L - 1/2',          'IBD Intermediate plus',       'Live',       'Ventri',  '0.03ml',     'Eye Drop',  'vaccine'],
      [8,  13,  1.9,  'AMP. 5Days',           'AMP.20mg/kg',                'Antibiotic', 'Elanco',  null,         'D/W',       'antibiotic'],
      [9,  14,  2.0,  'IBH K - 1/7',          'IBH Killed',                 'Killed',     'Ventri',  '0.3ml',      'S/C Neck',  'vaccine'],
      [10, 15,  2.1,  'Grading - 1/5',        'Grading 100% 1/5',           'Activity',   null,      null,         null,        'activity'],
      [11, 24,  3.4,  'IBD L - 2/2',          'IBD Intermediate Plus',       'Live',       'Ventri',  '0.03ml',     'Eye Drop',  'vaccine'],
      [12, 26,  3.7,  'IB - 1/3',             'IB MA5',                     'Live',       'MSD',     '0.03ml',     'Eye Drop',  'vaccine'],
      [13, 33,  4.7,  'ND L',                 'Lasota',                     'Live',       'Ventri',  '0.03ml',     'Eye Drop',  'vaccine'],
      [14, 39,  5.6,  'AMP. 5Days',           'AMP.20mg/kg',                'Antibiotic', 'Elanco',  null,         'D/W',       'antibiotic'],
      [15, 40,  5.7,  'F.Px L - 1/2',         'Fowl Pox',                   'Live',       'Ventri',  '0.03ml',     'W/W',       'vaccine'],
      [16, 42,  6.0,  'Transfer',             'Transfer to Growing Shed',    'Activity',   null,      null,         null,        'activity'],
      [17, 44,  6.3,  'Grading - 2/5',        'Grading 100% 2/5',           'Activity',   null,      null,         null,        'activity'],
      [18, 46,  6.6,  'VVND - 1/2',           'VENGEN (VVND)',              'Killed',     'Ventri',  '0.5ml',      'S/C Neck',  'vaccine'],
      [19, 52,  7.4,  'Deworming - 1/2',      'Deworming',                  'Activity',   null,      null,         null,        'activity'],
      [20, 54,  7.7,  'IC K - 1/2',           'Coryza (IC) K, Temp 38C',   'Killed',     'Zoetis',  '0.5ml',      'I/M Right', 'vaccine'],
      [21, 55,  7.9,  'IB - 2/3',             'IB MA5',                     'Live',       'MSD',     '0.03ml',     'Eye Drop',  'vaccine'],
      [22, 58,  8.3,  'FC K -1',              'Fowl Cholera (FC) K',        'Killed',     'Phibro',  '0.5ml',      'I/M Right', 'vaccine'],
      [23, 60,  8.6,  'ND L G7 -1/2',         'Dalguban N Plus',            'Live',       'Virbac',  '0.03ml',     'Eye Drop',  'vaccine'],
      [24, 65,  9.3,  'AMP. 5Days',           'AMP.20mg/kg',                'Antibiotic', 'Elanco',  null,         'D/W',       'antibiotic'],
      [25, 65,  9.3,  'REO K - 1/4',          'TRI REO K',                  'Killed',     'Zoetis',  '0.5ml',      'S/C Neck',  'vaccine'],
      [26, 71,  10.1, 'Grading - 3/5',        'Grading 100% 3/5',           'Activity',   null,      null,         null,        'activity'],
      [27, 72,  10.3, 'IBH K - 2/7',          'IBH Killed',                 'Killed',     'Ventri',  '0.5ml',      'I/M Left',  'vaccine'],
      [28, 75,  10.7, 'ND R2B',               'ND R2B',                     'Live',       'Ventri',  '0.5ml',      'S/C Neck',  'vaccine'],
      [29, 80,  11.4, 'Sal. L - 1/1',         'Salmonella Live SG9R',       'Live',       'MSD',     '0.2ml',      'S/C Neck',  'vaccine'],
      [30, 82,  11.7, 'IB - 3/3',             'IB MA5',                     'Live',       'MSD',     '0.03ml',     'Eye Drop',  'vaccine'],
      [31, 83,  11.9, 'IB MASS M K, Ven',     'IB MASS K',                  'Killed',     'Ventri',  '0.5ml',      'I/M Right', 'vaccine'],
      [32, 84,  12.0, 'ND L G7 -2/2',         'Dalguban N Plus',            'Live',       'Virbac',  '0.03ml',     'Eye Drop',  'vaccine'],
      [33, 88,  12.6, 'Debeak - 2/2',         'Beak Debeaking, 4 days',     'Activity',   null,      null,         null,        'activity'],
      [34, 91,  13.0, 'FC K -2',              'Fowl Cholera (FC) K',        'Killed',     'Phibro',  '0.5ml',      'I/M Left',  'vaccine'],
      [35, 93,  13.3, 'AE (1/1) +F.POX (2/2)','AE +F.POX',                 'Live',       'Ventri',  '0.03ml',     'W/W',       'vaccine'],
      [36, 93,  13.3, 'AMP. 5Days',           'AMP.20mg/kg',                'Antibiotic', 'Elanco',  null,         'D/W',       'antibiotic'],
      [37, 99,  14.1, 'Grading - 4/5',        'Grading 100% 4/5',           'Activity',   null,      null,         null,        'activity'],
      [38, 102, 14.6, 'VVND - 2/2',           'VENGEN (VVND)',              'Killed',     'Ventri',  '0.5ml',      'I/M Right', 'vaccine'],
      [39, 109, 15.6, 'IC K - 2/2',           'Coryza (IC) K, Temp 38C',   'Killed',     'Zoetis',  '0.5ml',      'I/M Left',  'vaccine'],
      [40, 110, 15.7, 'Deworming -2/2',       'Deworming',                  'Activity',   null,      null,         null,        'activity'],
      [41, 114, 16.3, 'AMP. 5Days',           'AMP.20mg/kg',                'Antibiotic', 'Elanco',  null,         'D/W',       'antibiotic'],
      [42, 116, 16.6, 'REO K - 2/4',          'TRI REO K',                  'Killed',     'Zoetis',  '0.5ml',      'I/M Right', 'vaccine'],
      [43, 118, 16.9, 'Transfer',             'Transfer to Layer Shed',      'Activity',   null,      null,         null,        'activity'],
      [44, 121, 17.3, 'AMP. 5Days',           'AMP.20mg/kg',                'Antibiotic', 'Elanco',  null,         'D/W',       'antibiotic'],
      [45, 123, 17.6, 'IBH K - 3/7',          'IBH Killed',                 'Killed',     'Ventri',  '0.5ml',      'S/C Neck',  'vaccine'],
      [46, 125, 17.9, 'Grading - 5/5',        'Grading 100% 5/5',           'Activity',   null,      null,         null,        'activity'],
      [47, 130, 18.6, 'ND L',                 'ND CLONE30',                 'Live',       'MSD',     '0.03ml',     'Eye Drop',  'vaccine'],
      [48, 131, 18.7, 'ND + IB K M MSD',      'ND + IB VARIANT',            'Killed',     'MSD',     '0.5ml',      'I/M Right', 'vaccine'],
      [49, 137, 19.6, 'IBD K - 2/5',          'IBD K',                      'Killed',     'Ventri',  '0.5ml',      'S/C Neck',  'vaccine'],
      [50, 144, 20.6, 'IBH K - 4/7',          'IBH Killed',                 'Killed',     'Ventri',  '0.5ml',      'I/M Left',  'vaccine'],
      [51, 149, 21.3, 'AMP. 5Days',           'AMP.20mg/kg',                'Antibiotic', 'Elanco',  null,         'D/W',       'antibiotic'],
      [52, 179, 25.6, 'AMP. 3Days',           'AMP. 25mg/kg',               'Antibiotic', 'ECO',     null,         'D/W',       'antibiotic'],
      [53, 205, 29.3, 'ND L',                 'ND CLONE30',                 'Live',       'MSD',     '0.03ml',     'Eye Drop',  'vaccine'],
      [54, 207, 29.6, 'AMP. 3Days',           'AMP. 25mg/kg',               'Antibiotic', 'ECO',     null,         'D/W',       'antibiotic'],
      [55, 225, 32.1, 'ND + IB K',            'ND + IB K',                  'Killed',     'MSD',     '0.5ml',      'I/M Right', 'vaccine'],
      [56, 232, 33.1, 'IBD K - 3/5',          'IBD K',                      'Killed',     'Ventri',  '0.5ml',      'S/C Neck',  'vaccine'],
      [57, 235, 33.6, 'AMP. 3Days',           'AMP. 25mg/kg',               'Antibiotic', 'ECO',     null,         'D/W',       'antibiotic'],
      [58, 239, 34.1, 'REO K - 3/4',          'TRI REO K',                  'Killed',     'Zoetis',  '0.5ml',      'I/M Left',  'vaccine'],
      [59, 240, 34.3, 'ND L',                 'Lasota',                     'Live',       'Ventri',  '1.5D/1000',  'D/W',       'vaccine'],
      [60, 263, 37.6, 'AMP. 3Days',           'AMP. 25mg/kg',               'Antibiotic', 'ECO',     null,         'D/W',       'antibiotic'],
      [61, 275, 39.3, 'ND VH',                'ND VH',                      'Live',       'Phibro',  '0.03ml',     'Eye Drop',  'vaccine'],
      [62, 288, 41.1, 'IBH K - 5/7',          'IBH Killed',                 'Killed',     'Globion', '0.5ml',      'S/C Neck',  'vaccine'],
      [63, 291, 41.6, 'AMP. 3Days',           'AMP. 25mg/kg',               'Antibiotic', 'ECO',     null,         'D/W',       'antibiotic'],
      [64, 295, 42.1, 'ND + IB K',            'ND + IB K',                  'Killed',     'MSD',     '0.5ml',      'I/M Right', 'vaccine'],
      [65, 302, 43.1, 'IBD K - 4/5',          'IBD K',                      'Killed',     'Ventri',  '0.5ml',      'S/C Neck',  'vaccine'],
      [66, 309, 44.1, 'REO K - 4/4',          'TRI REO K',                  'Killed',     'Zoetis',  '0.5ml',      'I/M Left',  'vaccine'],
      [67, 310, 44.3, 'ND L',                 'Lasota',                     'Live',       'Ventri',  '1.5D/1000',  'D/W',       'vaccine'],
      [68, 319, 45.6, 'AMP. 3Days',           'AMP. 25mg/kg',               'Antibiotic', 'ECO',     null,         'D/W',       'antibiotic'],
      [69, 345, 49.3, 'ND L',                 'ND CLONE30',                 'Live',       'MSD',     '1.5D/1000',  'D/W',       'vaccine'],
      [70, 347, 49.6, 'AMP. 5Days',           'AMP.20mg/kg',                'Antibiotic', 'Elanco',  null,         'D/W',       'antibiotic'],
      [71, 365, 52.1, 'IBH K - 6/7',          'IBH Killed',                 'Killed',     'Ventri',  '0.5ml',      'S/C Neck',  'vaccine'],
      [72, 375, 53.6, 'AMP. 5Days',           'AMP.20mg/kg',                'Antibiotic', 'Elanco',  null,         'D/W',       'antibiotic'],
      [73, 379, 54.1, 'ND+IB+IBD+REO',        '4 Way K',                    'Killed',     'Zoetis',  '0.5ml',      'I/M Right', 'vaccine'],
      [74, 380, 54.3, 'ND L',                 'Lasota',                     'Live',       'Ventri',  '1.5D/1000',  'D/W',       'vaccine'],
      [75, 401, 57.3, 'AMP. 5Days',           'AMP.20mg/kg',                'Antibiotic', 'Elanco',  null,         'D/W',       'antibiotic'],
      [76, 415, 59.3, 'ND VH',                'ND VH',                      'Live',       'Phibro',  '0.03ml',     'Eye Drop',  'vaccine'],
      [77, 429, 61.3, 'AMP. 5Days',           'AMP.20mg/kg',                'Antibiotic', 'Elanco',  null,         'D/W',       'antibiotic'],
      [78, 449, 64.1, 'IBH K - 7/7',          'IBH Killed',                 'Killed',     'Ventri',  '0.5ml',      'I/M Left',  'vaccine'],
      [79, 450, 64.3, 'ND L',                 'Lasota',                     'Live',       'Ventri',  '1.5D/1000',  'D/W',       'vaccine'],
      [80, 457, 65.3, 'AMP. 5Days',           'AMP.20mg/kg',                'Antibiotic', 'Elanco',  null,         'D/W',       'antibiotic'],
      [81, 485, 69.3, 'AMP. 5Days',           'AMP.20mg/kg',                'Antibiotic', 'Elanco',  null,         'D/W',       'antibiotic'],
      [82, 486, 69.4, 'ND L',                 'ND CLONE30',                 'Live',       'MSD',     '1.5D/1000',  'D/W',       'vaccine'],
    ];

    for (const [sno, day, week, disease, vname, vtype, maker, dose, route, cat] of details) {
      await client.query(`
        INSERT INTO vaccination_program_detail
          (header_id, s_no, day_number, week_number, disease, vaccine_name,
           vaccine_type, manufacturer, dose, route, category)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        ON CONFLICT DO NOTHING
      `, [headerId, sno, day, week, disease, vname, vtype, maker, dose, route, cat]);
    }
    console.log('  ✔ Seeded: 82 vaccination detail records');

    await client.query('COMMIT');
    console.log(`
✅ Vaccination Master Migration Complete!
──────────────────────────────────────────────────────────
  Tables:
    vaccination_program_header  — program header with dates/season
    vaccination_program_detail  — 82 detail lines per program
  Seeded:
    1 program header: BD-8 Vencobb 430Y Breeder Vaccination Program
    82 detail records: vaccines, antibiotics, activities
──────────────────────────────────────────────────────────
  APIs:
    GET    /api/vaccination-master/programs
    GET    /api/vaccination-master/programs/:id
    POST   /api/vaccination-master/programs
    PUT    /api/vaccination-master/programs/:id
    DELETE /api/vaccination-master/programs/:id
    GET    /api/vaccination-master/programs/:id/details
    POST   /api/vaccination-master/programs/:id/details
    PUT    /api/vaccination-master/details/:id
    DELETE /api/vaccination-master/details/:id
    POST   /api/vaccination-master/programs/:id/upload-excel
──────────────────────────────────────────────────────────`);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration error:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration();
