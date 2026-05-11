/**
 * KRISHI - Vaccination Notification Cron Job
 * Runs daily at 8:00 AM
 * Checks Due Today + Overdue vaccines → saves to notifications table
 * App polls GET /api/notifications to display alerts
 *
 * Start with server: enabled automatically when server starts
 * Manual trigger:    POST /api/notifications/trigger-check (for testing)
 */

const cron = require('node-cron');
const pool = require('../config/db');

// ── Compute status same logic as vaccinationController ────────────────────
function computeStatus(category, dayNumber, currentDay) {
  if (category === 'activity') return null; // activities don't trigger notifications
  if (category === 'grading')  return null; // grading doesn't trigger notifications
  if (currentDay > dayNumber + 2) return 'done';     // well past — no notification
  if (currentDay > dayNumber)     return 'overdue';  // missed → notify daily
  if (currentDay === dayNumber)   return 'due_today'; // due today → notify
  return 'upcoming'; // not yet — no notification
}

// ── Core check function — called by cron AND manual trigger ───────────────
async function checkAndNotify() {
  const client = await pool.connect();
  try {
    console.log(`\n[VaccinationCron] Running check at ${new Date().toISOString()}`);

    // Get flock start date from farm_config
    const configRes = await client.query(
      `SELECT config_value FROM farm_config WHERE config_key = 'flock_start_date'`
    );
    if (configRes.rowCount === 0) {
      console.log('[VaccinationCron] No flock_start_date found in farm_config. Skipping.');
      return { skipped: true, reason: 'No flock_start_date configured' };
    }

    const flockStartDate = new Date(configRes.rows[0].config_value);
    const today          = new Date();
    today.setHours(0, 0, 0, 0);
    flockStartDate.setHours(0, 0, 0, 0);

    const diffMs   = today - flockStartDate;
    const currentDay = Math.floor(diffMs / (1000 * 60 * 60 * 24)) + 1; // day 1 = start date
    const todayStr   = today.toISOString().split('T')[0];

    console.log(`[VaccinationCron] Flock start: ${configRes.rows[0].config_value}, Current day: ${currentDay}`);

    // Get all active vaccination schedule items
    const scheduleRes = await client.query(
      `SELECT id, day_number, vaccine_name, sub_label, category
       FROM vaccination_schedule
       WHERE is_active = TRUE
       ORDER BY day_number`
    );

    let notifCreated = 0;
    let notifSkipped = 0;

    for (const item of scheduleRes.rows) {
      const status = computeStatus(item.category, item.day_number, currentDay);

      // Only notify for due_today and overdue
      if (status !== 'due_today' && status !== 'overdue') {
        notifSkipped++;
        continue;
      }

      // Check if notification already created for this vaccine on today's date
      const existing = await client.query(
        `SELECT id FROM notifications
         WHERE vaccine_id = $1 AND notif_date = $2`,
        [item.id, todayStr]
      );

      if (existing.rowCount > 0) {
        console.log(`[VaccinationCron] Already notified for "${item.vaccine_name}" today. Skipping.`);
        notifSkipped++;
        continue;
      }

      // Build notification message
      const title   = status === 'due_today'
        ? `💉 Vaccination Due Today — ${item.vaccine_name}`
        : `⚠️ Missed Vaccination — ${item.vaccine_name}`;

      const message = status === 'due_today'
        ? `${item.vaccine_name}${item.sub_label ? ` (${item.sub_label})` : ''} is scheduled for Day ${item.day_number}. Please administer today.`
        : `${item.vaccine_name}${item.sub_label ? ` (${item.sub_label})` : ''} was scheduled for Day ${item.day_number} but has not been administered. Current day: ${currentDay}. Please take action immediately.`;

      await client.query(`
        INSERT INTO notifications
          (type, title, message, vaccine_id, vaccine_name, day_number, status, notif_date)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      `, ['vaccination', title, message, item.id, item.vaccine_name, item.day_number, status, todayStr]);

      console.log(`[VaccinationCron] ✔ Notification created: [${status}] ${item.vaccine_name} (Day ${item.day_number})`);
      notifCreated++;
    }

    const result = {
      success:      true,
      current_day:  currentDay,
      flock_start:  configRes.rows[0].config_value,
      checked:      scheduleRes.rowCount,
      created:      notifCreated,
      skipped:      notifSkipped,
      run_at:       new Date().toISOString(),
    };

    console.log(`[VaccinationCron] Done. Created: ${notifCreated}, Skipped: ${notifSkipped}\n`);
    return result;

  } catch (err) {
    console.error('[VaccinationCron] Error:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

// ── Schedule: every day at 8:00 AM ───────────────────────────────────────
function startCron() {
  cron.schedule('0 8 * * *', async () => {
    try {
      await checkAndNotify();
    } catch (err) {
      console.error('[VaccinationCron] Cron failed:', err.message);
    }
  }, {
    timezone: process.env.TIMEZONE || 'Asia/Kolkata',
  });

  console.log('  ✔ Vaccination cron scheduled — runs daily at 8:00 AM (IST)');
}

module.exports = { startCron, checkAndNotify };
