/**
 * Daily-feed admin grid parent key (must match GET /api/admin/grid/daily-feed).
 * Format: "{plant_code}_{YYYY-MM-DD}_{flock_no}"
 */

function buildDailyFeedParentId(plant_code, entry_date, flock_no) {
  const p = String(plant_code || '').trim();
  const d = String(entry_date || '').trim();
  const f = String(flock_no || '').trim();
  if (!p || !d || !f) return '';
  return `${p}_${d}_${f}`;
}

/** Inverse of buildDailyFeedParentId — finds YYYY-MM-DD in the string and splits plant / flock. */
function parseDailyFeedParentId(parentId) {
  const s = String(parentId || '').trim();
  const dateRe = /(\d{4}-\d{2}-\d{2})/;
  const dm = s.match(dateRe);
  if (!dm || dm.index <= 0) return null;
  const i = dm.index;
  const plant_code = s.slice(0, Math.max(0, i - 1)).trim();
  const feed_date = dm[1];
  const flock_no = s.slice(i + feed_date.length + 1).trim();
  if (!plant_code || !flock_no) return null;
  return { plant_code, feed_date, flock_no };
}

module.exports = { buildDailyFeedParentId, parseDailyFeedParentId };
