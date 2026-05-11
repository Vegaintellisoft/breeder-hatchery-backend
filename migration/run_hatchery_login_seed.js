/**
 * Idempotent Hatchery login seed only (roles + admin users).
 * Use when Hatchery login fails: "Invalid credentials for category: Hatchery"
 * Run: npm run migrate:hatchery:login
 */
require('dotenv').config();
const pool = require('../src/config/db');
const bcrypt = require('bcryptjs');

async function run() {
  const client = await pool.connect();
  try {
    console.log('\n🚀 Hatchery login seed (roles + users)...\n');
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS user_roles (
        id SERIAL PRIMARY KEY,
        role_name VARCHAR(100) NOT NULL,
        status BOOLEAN DEFAULT TRUE,
        permissions JSONB,
        category VARCHAR(50) NOT NULL DEFAULT 'Breeder',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS admin (
        id SERIAL PRIMARY KEY,
        first_name VARCHAR(100) NOT NULL,
        last_name VARCHAR(100),
        username VARCHAR(100) NOT NULL,
        password VARCHAR(255) NOT NULL,
        email VARCHAR(150),
        phone VARCHAR(20),
        role VARCHAR(100),
        category VARCHAR(50) NOT NULL DEFAULT 'Breeder',
        status BOOLEAN DEFAULT TRUE,
        last_login TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE (username, category)
      );
    `);

    const hatcheryScreens = {
      egg_receipt: { view: true, edit: true, delete: true },
      grade_setting: { view: true, edit: true, delete: true },
      transfer_pullout: { view: true, edit: true, delete: true },
      medicine_issue: { view: true, edit: true, delete: true },
      sap_sync: { view: true, edit: false, delete: false },
      notifications: { view: true, edit: false, delete: false },
      supervisor_mgmt: { view: true, edit: true, delete: true },
      schedule: { view: true, edit: true, delete: false },
      reports: { view: true, edit: false, delete: false },
      admin_panel: { view: true, edit: true, delete: true },
    };
    const viewerPerms = {};
    Object.keys(hatcheryScreens).forEach((k) => {
      viewerPerms[k] = { view: true, edit: false, delete: false };
    });
    const supervisorPerms = {
      egg_receipt: { view: true, edit: true, delete: false },
      grade_setting: { view: true, edit: true, delete: false },
      transfer_pullout: { view: true, edit: true, delete: false },
      medicine_issue: { view: true, edit: true, delete: false },
      schedule: { view: true, edit: true, delete: false },
      notifications: { view: true, edit: false, delete: false },
    };
    const hatcheryRoles = [
      { role_name: 'Super Admin', permissions: hatcheryScreens, status: true },
      { role_name: 'Farm Manager', permissions: hatcheryScreens, status: true },
      { role_name: 'Supervisor', permissions: supervisorPerms, status: true },
      { role_name: 'Viewer', permissions: viewerPerms, status: true },
    ];
    for (const r of hatcheryRoles) {
      const perm = JSON.stringify(r.permissions);
      const ex = await client.query(
        `SELECT id FROM user_roles WHERE role_name = $1 AND category = 'Hatchery'`,
        [r.role_name]
      );
      if (ex.rowCount === 0) {
        await client.query(
          `INSERT INTO user_roles (role_name, status, permissions, category)
           VALUES ($1, $2, $3::jsonb, 'Hatchery')`,
          [r.role_name, r.status, perm]
        );
      } else {
        await client.query(
          `UPDATE user_roles SET status = $2, permissions = $3::jsonb, updated_at = NOW()
           WHERE role_name = $1 AND category = 'Hatchery'`,
          [r.role_name, r.status, perm]
        );
      }
    }
    console.log('  ✔ Hatchery roles in user_roles');

    const hash = await bcrypt.hash('Krishi@123', 10);
    const hatcheryUsers = [
      { first_name: 'Super', last_name: 'Admin', username: 'superadmin', role: 'Super Admin' },
      { first_name: 'Hatchery', last_name: 'Admin', username: 'hatchery_admin', role: 'Super Admin' },
      { first_name: 'Hatchery', last_name: 'Manager', username: 'hatchery_manager01', role: 'Farm Manager' },
      { first_name: 'Hatchery', last_name: 'Supervisor', username: 'hatchery_supervisor01', role: 'Supervisor' },
    ];
    for (const u of hatcheryUsers) {
      await client.query(
        `INSERT INTO admin (first_name, last_name, username, password, role, category, status)
         VALUES ($1,$2,$3,$4,$5,'Hatchery',TRUE)
         ON CONFLICT (username, category) DO NOTHING`,
        [u.first_name, u.last_name, u.username, hash, u.role]
      );
    }
    console.log('  ✔ Hatchery users (password Krishi@123): superadmin, hatchery_admin, hatchery_manager01, hatchery_supervisor01');

    await client.query('COMMIT');
    console.log('\n✅ Done. Login with category \"Hatchery\" and any user above.\n');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Error:', e.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
