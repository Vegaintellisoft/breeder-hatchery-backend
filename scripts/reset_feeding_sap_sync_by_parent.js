/**
 * Reset SAP sync flags for all flock_feeding_log rows matching a daily-feed parent_id
 * so POST /api/sap-sync?parent_id=... can be retried.
 *
 * Usage:
 *   node scripts/reset_feeding_sap_sync_by_parent.js
 *   node scripts/reset_feeding_sap_sync_by_parent.js 1902_2026-05-05_LY000001
 *
 * Requires .env DB_* (same as API) or defaults to localhost krishi_db.
 */
require('dotenv').config();
const pool = require('../src/config/db');
const { parseDailyFeedParentId } = require('../src/utils/dailyFeedParentId');

async function main() {
  const parentId = process.argv[2] || '1902_2026-05-05_LY000001';
  const parsed = parseDailyFeedParentId(parentId);
  if (!parsed) {
    console.error('Invalid parent_id:', parentId);
    process.exit(1);
  }

  const sel = await pool.query(
    `SELECT id, feed_type, sap_synced FROM flock_feeding_log
      WHERE plant_code = $1 AND feed_date = $2::date AND flock_no = $3
      ORDER BY id`,
    [parsed.plant_code, parsed.feed_date, parsed.flock_no]
  );

  if (sel.rowCount === 0) {
    console.log('No rows for', parentId, parsed);
    await pool.end();
    return;
  }

  const upd = await pool.query(
    `UPDATE flock_feeding_log
        SET sap_synced = FALSE,
            sap_synced_at = NULL,
            sap_synced_by = NULL,
            updated_at = NOW()
      WHERE plant_code = $1 AND feed_date = $2::date AND flock_no = $3
      RETURNING id, feed_type`,
    [parsed.plant_code, parsed.feed_date, parsed.flock_no]
  );

  console.log('parent_id:', parentId);
  console.log('Before:', sel.rows);
  console.log('Updated', upd.rowCount, 'row(s):', upd.rows.map((r) => `${r.id}(${r.feed_type})`).join(', '));
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
