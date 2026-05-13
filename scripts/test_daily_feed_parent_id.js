/**
 * Quick checks for daily-feed parent_id parse/build (no DB, no SAP).
 * Run: node scripts/test_daily_feed_parent_id.js
 */
const assert = require('assert');
const {
  buildDailyFeedParentId,
  parseDailyFeedParentId,
} = require('../src/utils/dailyFeedParentId');

const built = buildDailyFeedParentId('1904', '2026-05-08', 'LY000001');
assert.strictEqual(built, '1904_2026-05-08_LY000001');

const parsed = parseDailyFeedParentId('1904_2026-05-08_LY000001');
assert.deepStrictEqual(parsed, {
  plant_code: '1904',
  feed_date: '2026-05-08',
  flock_no: 'LY000001',
});

assert.strictEqual(parseDailyFeedParentId(''), null);
assert.strictEqual(parseDailyFeedParentId('nope'), null);

const round = buildDailyFeedParentId('1902', '2026-04-21', 'LY000011');
assert.deepStrictEqual(parseDailyFeedParentId(round), {
  plant_code: '1902',
  feed_date: '2026-04-21',
  flock_no: 'LY000011',
});

console.log('dailyFeedParentId tests: OK');
