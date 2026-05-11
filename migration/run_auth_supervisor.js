require('dotenv').config();
const pool = require('../src/config/db');
const bcrypt = require('bcryptjs');

async function runMigration() {
  const client = await pool.connect();
  try {
    console.log('\n🚀 Running Auth + Supervisor + Biosecurity Schedule Migration...\n');
    await client.query('BEGIN');

    // ── 1. ROLES ──────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS roles (
        id          SERIAL PRIMARY KEY,
        role_name   VARCHAR(50) UNIQUE NOT NULL,
        description VARCHAR(200),
        created_at  TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query(`
      INSERT INTO roles (role_name, description) VALUES
        ('super_admin', 'Full system access'),
        ('farm_manager', 'Manages all farms and supervisors'),
        ('supervisor', 'Enters biosecurity data for assigned plant'),
        ('field_worker', 'Basic field data entry')
      ON CONFLICT (role_name) DO NOTHING;
    `);
    console.log('  ✔ Table: roles (4 roles seeded)');

    // ── 2. USERS ──────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id            SERIAL PRIMARY KEY,
        username      VARCHAR(50) UNIQUE NOT NULL,
        password      VARCHAR(255) NOT NULL,
        full_name     VARCHAR(100) NOT NULL,
        email         VARCHAR(100),
        phone         VARCHAR(20),
        role_id       INT NOT NULL REFERENCES roles(id),
        plant_code    VARCHAR(20),
        is_active     BOOLEAN DEFAULT TRUE,
        created_at    TIMESTAMP DEFAULT NOW(),
        updated_at    TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('  ✔ Table: users');

    // Seed default users
    const hash = await bcrypt.hash('Krishi@123', 10);
    const users = [
      ['superadmin',    hash, 'Super Admin',       'super_admin',  null],
      ['manager_farm01',hash, 'Farm Manager',       'farm_manager', '1902'],
      ['supervisor01',  hash, 'Supervisor One',     'supervisor',   '1902'],
      ['supervisor02',  hash, 'Supervisor Two',     'supervisor',   '1902'],
      ['worker01',      hash, 'Field Worker One',   'field_worker', '1902'],
    ];
    for (const [uname, pwd, name, role, plant] of users) {
      const roleRes = await client.query(`SELECT id FROM roles WHERE role_name=$1`, [role]);
      await client.query(`
        INSERT INTO users (username, password, full_name, role_id, plant_code)
        VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (username) DO NOTHING
      `, [uname, pwd, name, roleRes.rows[0].id, plant]);
    }
    console.log('  ✔ Seeded: 5 default users (password: Krishi@123)');

    // ── 3. SUPERVISOR PLANT SHIFTS ────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS supervisor_plant_shifts (
        id            SERIAL PRIMARY KEY,
        user_id       INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        plant_code    VARCHAR(20) NOT NULL,
        shift_date    DATE NOT NULL,
        shift_type    VARCHAR(20) DEFAULT 'day',
        assigned_by   INT REFERENCES users(id),
        is_active     BOOLEAN DEFAULT TRUE,
        created_at    TIMESTAMP DEFAULT NOW(),
        updated_at    TIMESTAMP DEFAULT NOW(),
        UNIQUE (plant_code, shift_date, shift_type)
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_sps_user_id    ON supervisor_plant_shifts(user_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_sps_plant_date ON supervisor_plant_shifts(plant_code, shift_date);`);
    console.log('  ✔ Table: supervisor_plant_shifts');

    // ── 4. FLOCK FREQUENCY SCHEDULE ───────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS flock_frequency_schedule (
        id             SERIAL PRIMARY KEY,
        flock_no       VARCHAR(20) NOT NULL,
        plant_code     VARCHAR(20) NOT NULL,
        chick_start_date DATE NOT NULL,
        frequency      VARCHAR(20) NOT NULL CHECK (frequency IN (
                         'daily','weekly','fortnightly','monthly',
                         'quarterly','bi_annually'
                       )),
        due_date       DATE NOT NULL,
        day_number     INT NOT NULL,
        status         VARCHAR(20) DEFAULT 'pending'
                       CHECK (status IN ('pending','completed','missed','late')),
        completed_at   TIMESTAMP,
        completed_by   INT REFERENCES users(id),
        created_at     TIMESTAMP DEFAULT NOW(),
        updated_at     TIMESTAMP DEFAULT NOW(),
        UNIQUE (flock_no, frequency, due_date)
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ffs_flock      ON flock_frequency_schedule(flock_no);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ffs_plant_date ON flock_frequency_schedule(plant_code, due_date);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ffs_status     ON flock_frequency_schedule(status);`);
    console.log('  ✔ Table: flock_frequency_schedule');

    // ── 5. BIOSECURITY COMPLETION LOG ─────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS biosecurity_completion_log (
        id              SERIAL PRIMARY KEY,
        flock_no        VARCHAR(20) NOT NULL,
        plant_code      VARCHAR(20) NOT NULL,
        supervisor_id   INT NOT NULL REFERENCES users(id),
        frequency       VARCHAR(20) NOT NULL,
        entry_date      DATE NOT NULL,
        is_late         BOOLEAN DEFAULT FALSE,
        late_reason     VARCHAR(500),
        late_days       INT DEFAULT 0,
        total_activities INT DEFAULT 0,
        completed_activities INT DEFAULT 0,
        is_fully_completed BOOLEAN DEFAULT FALSE,
        submitted_at    TIMESTAMP DEFAULT NOW(),
        updated_at      TIMESTAMP DEFAULT NOW(),
        UNIQUE (flock_no, frequency, entry_date, supervisor_id)
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_bcl_plant_date ON biosecurity_completion_log(plant_code, entry_date);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_bcl_supervisor ON biosecurity_completion_log(supervisor_id);`);
    console.log('  ✔ Table: biosecurity_completion_log');

    // ── 6. LATE ENTRY REASONS ─────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS late_entry_reasons (
        id          SERIAL PRIMARY KEY,
        code        VARCHAR(50) UNIQUE NOT NULL,
        label       VARCHAR(100) NOT NULL,
        is_active   BOOLEAN DEFAULT TRUE
      );
    `);
    await client.query(`
      INSERT INTO late_entry_reasons (code, label) VALUES
        ('out_of_stock',    'Out of Stock'),
        ('power_failure',   'Power Failure'),
        ('staff_absent',    'Staff Absent'),
        ('equipment_issue', 'Equipment Issue'),
        ('emergency',       'Emergency Situation'),
        ('other',           'Other Reason')
      ON CONFLICT (code) DO NOTHING;
    `);
    console.log('  ✔ Table: late_entry_reasons (6 reasons seeded)');

    // ── 7. IN-APP NOTIFICATIONS ───────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS in_app_notifications (
        id            SERIAL PRIMARY KEY,
        user_id       INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type          VARCHAR(50) NOT NULL,
        title         VARCHAR(200) NOT NULL,
        message       TEXT NOT NULL,
        plant_code    VARCHAR(20),
        flock_no      VARCHAR(20),
        frequency     VARCHAR(20),
        due_date      DATE,
        is_read       BOOLEAN DEFAULT FALSE,
        priority      VARCHAR(10) DEFAULT 'normal'
                      CHECK (priority IN ('low','normal','high','urgent')),
        created_at    TIMESTAMP DEFAULT NOW(),
        read_at       TIMESTAMP
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ian_user_id   ON in_app_notifications(user_id, is_read);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ian_created   ON in_app_notifications(created_at DESC);`);
    console.log('  ✔ Table: in_app_notifications');

    await client.query('COMMIT');
    console.log(`
✅ Auth + Supervisor + Schedule Migration Complete!
──────────────────────────────────────────────────────────
  Tables (7):
    roles                      — 4 roles
    users                      — 5 default users
    supervisor_plant_shifts    — admin assigns supervisor to plant per day
    flock_frequency_schedule   — due dates per flock per frequency
    biosecurity_completion_log — tracks completion per day
    late_entry_reasons         — 6 predefined reasons
    in_app_notifications       — returned on login/app open
──────────────────────────────────────────────────────────
  Default credentials (all: Krishi@123):
    superadmin      → super_admin
    manager_farm01  → farm_manager  (plant: 1902)
    supervisor01    → supervisor    (plant: 1902)
    supervisor02    → supervisor    (plant: 1902)
    worker01        → field_worker  (plant: 1902)
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
