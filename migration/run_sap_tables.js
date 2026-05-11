require('dotenv').config();
const pool = require('../src/config/db');

async function runMigration() {
  const client = await pool.connect();
  try {
    console.log('Running SAP tables migration...\n');

    // Drop existing tables to recreate with correct schema
    const drops = [
      'sap_bird_receipt','sap_feed_medicine','sap_laying',
      'sap_mortality','sap_culls_kill','sap_sale_receipt','sap_estimated_cost'
    ];
    for (const t of drops) {
      await client.query(`DROP TABLE IF EXISTS ${t} CASCADE`);
    }
    console.log('  ✔ Dropped existing SAP tables (if any)\n');

    // ── 1. sap_bird_receipt (zbird_receipt) ──────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS sap_bird_receipt (
        id         SERIAL PRIMARY KEY,
        lifnr      VARCHAR(20),
        werks      VARCHAR(10),
        ebeln      VARCHAR(20),
        ebelp      VARCHAR(10),
        mblnr      VARCHAR(20),
        zeile      VARCHAR(10),
        matnr      VARCHAR(20),
        maktx      VARCHAR(100),
        bldat      DATE,
        budat      DATE,
        menge      NUMERIC(15,3) DEFAULT 0,
        erfmg      NUMERIC(15,3) DEFAULT 0,
        uname      VARCHAR(30),
        uzeit      VARCHAR(20),
        hatchdt    DATE,
        erdat      DATE,
        loekz      VARCHAR(5)    DEFAULT '',
        synced_at  TIMESTAMP     DEFAULT NOW(),
        updated_at TIMESTAMP     DEFAULT NOW(),
        UNIQUE (mblnr, zeile)
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_sbr_werks  ON sap_bird_receipt(werks);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_sbr_lifnr  ON sap_bird_receipt(lifnr);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_sbr_bldat  ON sap_bird_receipt(bldat);`);
    console.log('  ✔ sap_bird_receipt');

    // ── 2. sap_feed_medicine (zfeed_med) ─────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS sap_feed_medicine (
        id         SERIAL PRIMARY KEY,
        lifnr      VARCHAR(20),
        werks      VARCHAR(10),
        ebeln      VARCHAR(20),
        ebelp      VARCHAR(10),
        mblnr      VARCHAR(20),
        zeile      VARCHAR(10),
        matnr      VARCHAR(20),
        maktx      VARCHAR(100),
        bldat      DATE,
        budat      DATE,
        menge      NUMERIC(15,3) DEFAULT 0,
        erfmg      NUMERIC(15,3) DEFAULT 0,
        uname      VARCHAR(30),
        uzeit      VARCHAR(20),
        loekz      VARCHAR(5)    DEFAULT '',
        synced_at  TIMESTAMP     DEFAULT NOW(),
        updated_at TIMESTAMP     DEFAULT NOW(),
        UNIQUE (mblnr, zeile)
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_sfm_werks  ON sap_feed_medicine(werks);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_sfm_lifnr  ON sap_feed_medicine(lifnr);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_sfm_bldat  ON sap_feed_medicine(bldat);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_sfm_matnr  ON sap_feed_medicine(matnr);`);
    console.log('  ✔ sap_feed_medicine');

    // ── 3. sap_laying (zlaying_prelay) ───────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS sap_laying (
        id         SERIAL PRIMARY KEY,
        zzflock    VARCHAR(20),
        zzflockn   VARCHAR(100),
        werks      VARCHAR(10),
        lifnr      VARCHAR(20),
        bldat      DATE,
        budat      DATE,
        zzfbirds   NUMERIC(12,3) DEFAULT 0,
        zzmbirds   NUMERIC(12,3) DEFAULT 0,
        zzeggs     NUMERIC(12,3) DEFAULT 0,
        zzdeadegg  NUMERIC(12,3) DEFAULT 0,
        zzfloor    NUMERIC(12,3) DEFAULT 0,
        uname      VARCHAR(30),
        uzeit      VARCHAR(20),
        loekz      VARCHAR(5)    DEFAULT '',
        synced_at  TIMESTAMP     DEFAULT NOW(),
        updated_at TIMESTAMP     DEFAULT NOW(),
        UNIQUE (zzflock, bldat, werks)
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_sl_werks   ON sap_laying(werks);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_sl_zzflock ON sap_laying(zzflock);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_sl_bldat   ON sap_laying(bldat);`);
    console.log('  ✔ sap_laying');

    // ── 4. sap_mortality (zmortality_ent) ────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS sap_mortality (
        id         SERIAL PRIMARY KEY,
        zzflock    VARCHAR(20),
        zzflockn   VARCHAR(100),
        werks      VARCHAR(10),
        lifnr      VARCHAR(20),
        bldat      DATE,
        budat      DATE,
        zzmort     NUMERIC(12,3) DEFAULT 0,
        zzculls    NUMERIC(12,3) DEFAULT 0,
        uname      VARCHAR(30),
        uzeit      VARCHAR(20),
        loekz      VARCHAR(5)    DEFAULT '',
        synced_at  TIMESTAMP     DEFAULT NOW(),
        updated_at TIMESTAMP     DEFAULT NOW(),
        UNIQUE (zzflock, bldat, werks)
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_sm_werks   ON sap_mortality(werks);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_sm_zzflock ON sap_mortality(zzflock);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_sm_bldat   ON sap_mortality(bldat);`);
    console.log('  ✔ sap_mortality');

    // ── 5. sap_culls_kill (zculls_kill) ──────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS sap_culls_kill (
        id         SERIAL PRIMARY KEY,
        lifnr      VARCHAR(20),
        werks      VARCHAR(10),
        vbeln      VARCHAR(20),
        posnr      VARCHAR(10),
        matnr      VARCHAR(20),
        maktx      VARCHAR(100),
        bldat      DATE,
        budat      DATE,
        menge      NUMERIC(15,3) DEFAULT 0,
        erfmg      NUMERIC(15,3) DEFAULT 0,
        uname      VARCHAR(30),
        uzeit      VARCHAR(20),
        loekz      VARCHAR(5)    DEFAULT '',
        synced_at  TIMESTAMP     DEFAULT NOW(),
        updated_at TIMESTAMP     DEFAULT NOW(),
        UNIQUE (vbeln, posnr)
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_sck_werks ON sap_culls_kill(werks);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_sck_lifnr ON sap_culls_kill(lifnr);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_sck_bldat ON sap_culls_kill(bldat);`);
    console.log('  ✔ sap_culls_kill');

    // ── 6. sap_sale_receipt (zculls_sale) ────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS sap_sale_receipt (
        id         SERIAL PRIMARY KEY,
        lifnr      VARCHAR(20),
        werks      VARCHAR(10),
        vbeln      VARCHAR(20),
        posnr      VARCHAR(10),
        matnr      VARCHAR(20),
        maktx      VARCHAR(100),
        bldat      DATE,
        budat      DATE,
        menge      NUMERIC(15,3) DEFAULT 0,
        erfmg      NUMERIC(15,3) DEFAULT 0,
        uname      VARCHAR(30),
        uzeit      VARCHAR(20),
        loekz      VARCHAR(5)    DEFAULT '',
        synced_at  TIMESTAMP     DEFAULT NOW(),
        updated_at TIMESTAMP     DEFAULT NOW(),
        UNIQUE (vbeln, posnr)
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ssr_werks ON sap_sale_receipt(werks);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ssr_lifnr ON sap_sale_receipt(lifnr);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ssr_bldat ON sap_sale_receipt(bldat);`);
    console.log('  ✔ sap_sale_receipt');

    // ── 7. sap_estimated_cost (zestimated_cost) ──────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS sap_estimated_cost (
        id         SERIAL PRIMARY KEY,
        werks      VARCHAR(10),
        lifnr      VARCHAR(20),
        matnr      VARCHAR(20),
        maktx      VARCHAR(100),
        bldat      DATE,
        budat      DATE,
        menge      NUMERIC(15,3) DEFAULT 0,
        erfmg      NUMERIC(15,3) DEFAULT 0,
        uname      VARCHAR(30),
        uzeit      VARCHAR(20),
        loekz      VARCHAR(5)    DEFAULT '',
        synced_at  TIMESTAMP     DEFAULT NOW(),
        updated_at TIMESTAMP     DEFAULT NOW(),
        UNIQUE (werks, matnr, bldat)
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_sec_werks ON sap_estimated_cost(werks);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_sec_lifnr ON sap_estimated_cost(lifnr);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_sec_bldat ON sap_estimated_cost(bldat);`);
    console.log('  ✔ sap_estimated_cost');

    console.log(`
✅ SAP tables migration complete!
──────────────────────────────────────────────
  Tables created (7):
    sap_bird_receipt    ← zbird_receipt
    sap_feed_medicine   ← zfeed_med
    sap_laying          ← zlaying_prelay
    sap_mortality       ← zmortality_ent
    sap_culls_kill      ← zculls_kill
    sap_sale_receipt    ← zculls_sale
    sap_estimated_cost  ← zestimated_cost
──────────────────────────────────────────────
  Sync endpoints:
    GET /api/sap/sync/bird-receipt
    GET /api/sap/sync/feed-medicine
    GET /api/sap/sync/laying
    GET /api/sap/sync/mortality
    GET /api/sap/sync/culls-kill
    GET /api/sap/sync/culls-sale
    GET /api/sap/sync/estimated-cost
──────────────────────────────────────────────`);

  } catch (err) {
    console.error('Migration error:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration();
