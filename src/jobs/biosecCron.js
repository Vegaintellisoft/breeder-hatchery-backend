const cron = require('node-cron');
const pool = require('../config/db');

async function checkIncompleteAndNotifyManager() {
  const client = await pool.connect();
  try {
    const today = new Date().toISOString().split('T')[0];
    console.log(`\n[BiosecCron] Running 6PM check at ${new Date().toISOString()}`);

    // Get all pending due entries for today
    const pendingResult = await client.query(`
      SELECT ffs.flock_no, ffs.plant_code, ffs.frequency, ffs.due_date, ffs.day_number
      FROM flock_frequency_schedule ffs
      WHERE ffs.due_date = $1 AND ffs.status = 'pending'
      ORDER BY ffs.plant_code, ffs.flock_no
    `, [today]);

    if (pendingResult.rowCount === 0) {
      console.log('[BiosecCron] All entries completed for today. ✅');
      return;
    }

    console.log(`[BiosecCron] Found ${pendingResult.rowCount} incomplete entries`);

    // Get all managers
    const managersResult = await client.query(`
      SELECT id FROM admin
      WHERE role IN ('Farm Manager','Super Admin')
        AND category = 'Breeder' AND status = TRUE
    `);

    // Get today's assigned supervisors per plant
    const supervisorsResult = await client.query(`
      SELECT sps.user_id, sps.plant_code,
             a.first_name || ' ' || a.last_name AS full_name
      FROM supervisor_plant_shifts sps
      JOIN admin a ON a.id = sps.user_id AND a.category = 'Breeder'
      WHERE sps.shift_date = $1 AND sps.is_active = TRUE
    `, [today]);

    const supervisorsByPlant = {};
    for (const s of supervisorsResult.rows) {
      if (!supervisorsByPlant[s.plant_code]) supervisorsByPlant[s.plant_code] = [];
      supervisorsByPlant[s.plant_code].push(s);
    }

    // Group incomplete by plant
    const incompleteByPlant = {};
    for (const row of pendingResult.rows) {
      if (!incompleteByPlant[row.plant_code]) incompleteByPlant[row.plant_code] = [];
      incompleteByPlant[row.plant_code].push(row);
    }

    let notifCreated = 0;

    for (const [plant_code, entries] of Object.entries(incompleteByPlant)) {
      const supervisors = supervisorsByPlant[plant_code] || [];
      const supNames    = supervisors.map(s => s.full_name).join(', ') || 'Unassigned';

      const summary = entries.map(e => `${e.flock_no} (${e.frequency})`).join(', ');
      const title   = `⚠️ Incomplete Biosecurity Entries — Plant ${plant_code}`;
      const message = `Plant ${plant_code}: ${entries.length} biosecurity entries not completed today. Supervisor(s): ${supNames}. Pending: ${summary}`;

      // Notify all managers
      for (const manager of managersResult.rows) {
        const existing = await client.query(`
          SELECT id FROM in_app_notifications
          WHERE user_id=$1 AND plant_code=$2 AND type='manager_incomplete_alert'
          AND created_at::date = CURRENT_DATE
        `, [manager.id, plant_code]);

        if (existing.rowCount === 0) {
          await client.query(`
            INSERT INTO in_app_notifications
              (user_id, type, title, message, plant_code, priority)
            VALUES ($1,'manager_incomplete_alert',$2,$3,$4,'urgent')
          `, [manager.id, title, message, plant_code]);
          notifCreated++;
        }
      }

      // Notify the supervisor themselves
      for (const supervisor of supervisors) {
        const existing = await client.query(`
          SELECT id FROM in_app_notifications
          WHERE user_id=$1 AND plant_code=$2 AND type='supervisor_incomplete_alert'
          AND created_at::date = CURRENT_DATE
        `, [supervisor.user_id, plant_code]);

        if (existing.rowCount === 0) {
          await client.query(`
            INSERT INTO in_app_notifications
              (user_id, type, title, message, plant_code, priority)
            VALUES ($1,'supervisor_incomplete_alert',
              $2, $3, $4,'urgent')
          `, [
            supervisor.user_id,
            `⚠️ You have incomplete biosecurity entries — Plant ${plant_code}`,
            `You have ${entries.length} incomplete biosecurity entries for today. Please complete them immediately. Pending: ${summary}`,
            plant_code
          ]);
          notifCreated++;
        }
      }
    }

    // Mark overdue entries (daily entries from yesterday still pending)
    await client.query(`
      UPDATE flock_frequency_schedule
      SET status = 'missed', updated_at = NOW()
      WHERE frequency = 'daily'
        AND due_date < CURRENT_DATE
        AND status = 'pending'
    `);

    console.log(`[BiosecCron] ✅ Created ${notifCreated} notifications. Marked overdue entries.`);

    return { success: true, incomplete: pendingResult.rowCount, notifications_created: notifCreated };
  } catch (err) {
    console.error('[BiosecCron] Error:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

function startBiosecCron() {
  // Run every day at 6:00 PM IST
  cron.schedule('0 18 * * *', async () => {
    try {
      await checkIncompleteAndNotifyManager();
    } catch (err) {
      console.error('[BiosecCron] Cron failed:', err.message);
    }
  }, { timezone: process.env.TIMEZONE || 'Asia/Kolkata' });

  console.log('  ✔ Biosecurity cron scheduled — runs daily at 6:00 PM (IST)');
}

module.exports = { startBiosecCron, checkIncompleteAndNotifyManager };
