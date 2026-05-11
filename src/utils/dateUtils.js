/**
 * parseDate — safely extract YYYY-MM-DD in IST from any date input
 *
 * Root cause:
 *   Frontend (React Native) sends "2026-04-21T00:00:00.000+05:30" (IST midnight)
 *   OR already converts to UTC: "2026-04-20T18:30:00.000Z"
 *   PostgreSQL sees "2026-04-20" (WRONG — one day behind)
 *
 * Fix:
 *   +05:30 in string → split at T, take date part (already local date)
 *   Z (UTC) in string → add 5h30m to convert back to IST, then take date
 *   plain YYYY-MM-DD  → use as-is
 */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // +05:30 in milliseconds

const parseDate = (dateInput) => {
  if (!dateInput) return todayDate();

  const str = String(dateInput).trim();

  // Case 1: has IST offset (+05:30 or similar positive offset)
  // e.g. "2026-04-21T00:00:00.000+05:30" → take "2026-04-21" directly
  if (str.includes('T') && str.includes('+')) {
    const datePart = str.split('T')[0];
    if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return datePart;
  }

  // Case 2: UTC string (ends with Z)
  // e.g. "2026-04-20T18:30:00.000Z" = IST midnight of 2026-04-21
  // Convert UTC → IST by adding 5h30m, then take date
  if (str.includes('T') && str.endsWith('Z')) {
    const d = new Date(str);
    if (!isNaN(d.getTime())) {
      const ist = new Date(d.getTime() + IST_OFFSET_MS);
      const y   = ist.getUTCFullYear();
      const m   = String(ist.getUTCMonth() + 1).padStart(2, '0');
      const day = String(ist.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    }
  }

  // Case 3: already clean YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

  // Case 4: any other format — parse and convert to IST
  const d = new Date(str);
  if (!isNaN(d.getTime())) {
    const ist = new Date(d.getTime() + IST_OFFSET_MS);
    const y   = ist.getUTCFullYear();
    const m   = String(ist.getUTCMonth() + 1).padStart(2, '0');
    const day = String(ist.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  return todayDate();
};

const todayDate = () => {
  // Return today in IST
  const now = new Date();
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const y   = ist.getUTCFullYear();
  const m   = String(ist.getUTCMonth() + 1).padStart(2, '0');
  const day = String(ist.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

module.exports = { parseDate, todayDate };

/**
 * formatDateFields — convert all date fields in a row object from
 * ISO timestamp "2026-04-20T18:30:00.000Z" → "2026-04-21" (IST)
 *
 * Use on any DB row before sending in response
 */
const DATE_FIELDS = [
  'entry_date', 'feed_date', 'collection_date', 'weight_date',
  'activity_date', 'created_at', 'updated_at', 'sap_synced_at',
  'hatchery_date', 'doc_date', 'start_date', 'end_date'
];

const formatDateField = (val) => {
  if (!val) return val;
  // If it's a Date object or ISO string with time, convert to IST date string
  if (val instanceof Date || (typeof val === 'string' && val.includes('T'))) {
    return parseDate(String(val));
  }
  return val;
};

const formatRow = (row) => {
  if (!row || typeof row !== 'object') return row;
  const result = { ...row };
  for (const key of Object.keys(result)) {
    if (DATE_FIELDS.includes(key) || key.endsWith('_date') || key.endsWith('_at')) {
      // Only format actual date fields, not timestamp fields like created_at
      if (key === 'entry_date' || key === 'feed_date' || key === 'collection_date' ||
          key === 'weight_date' || key === 'activity_date' || key === 'hatchery_date' ||
          key === 'doc_date' || key === 'start_date' || key === 'end_date') {
        result[key] = formatDateField(result[key]);
      }
    }
  }
  return result;
};

module.exports = { parseDate, todayDate, formatRow };
