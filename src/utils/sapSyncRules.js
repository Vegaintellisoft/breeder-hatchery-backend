/**
 * Mobile vs admin SAP push rules (business calendar = Asia/Kolkata).
 */
const ADMIN_SYNC_ROLES = new Set(['Super Admin', 'Farm Manager']);
if (process.env.SAP_SYNC_ADMIN_ROLES) {
  for (const r of process.env.SAP_SYNC_ADMIN_ROLES.split(',')) {
    const t = r.trim();
    if (t) ADMIN_SYNC_ROLES.add(t);
  }
}

function canSyncAnyHistoricalDate(user) {
  return user && ADMIN_SYNC_ROLES.has(String(user.role || '').trim());
}

/** YYYY-MM-DD in IST */
function getTodayYmdIST() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function normalizeYmd(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  const s = String(value);
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  return m ? m[1] : s.slice(0, 10);
}

const BUSINESS_DATE_COLUMN = {
  feeding: 'feed_date',
  egg_collection: 'collection_date',
  mortality: 'entry_date',
  cull_kill: 'entry_date',
  cull_sales: 'entry_date',
  bird_weighing: 'weight_date',
  bird_receipt: 'weight_date',
};

function getBusinessDateColumn(module) {
  return BUSINESS_DATE_COLUMN[module] || null;
}

/**
 * @returns {{ allowed: boolean, reason?: string, business_date?: string, today_ist?: string }}
 */
function assertSyncAllowedForUser(module, row, user) {
  const col = getBusinessDateColumn(module);
  const todayIst = getTodayYmdIST();
  if (!col || !row) {
    return { allowed: true, today_ist: todayIst };
  }
  const businessDate = normalizeYmd(row[col]);
  if (canSyncAnyHistoricalDate(user)) {
    return { allowed: true, business_date: businessDate, today_ist: todayIst };
  }
  if (!businessDate) {
    return {
      allowed: false,
      reason: 'missing_business_date',
      message: 'Cannot sync: entry has no business date on record',
      today_ist: todayIst,
    };
  }
  if (businessDate !== todayIst) {
    return {
      allowed: false,
      reason: 'mobile_today_only',
      message:
        'Mobile users may sync only today\'s entries (Asia/Kolkata). Open sync from admin for older data.',
      business_date: businessDate,
      today_ist: todayIst,
    };
  }
  return { allowed: true, business_date: businessDate, today_ist: todayIst };
}

module.exports = {
  ADMIN_SYNC_ROLES,
  canSyncAnyHistoricalDate,
  getTodayYmdIST,
  normalizeYmd,
  getBusinessDateColumn,
  assertSyncAllowedForUser,
};
