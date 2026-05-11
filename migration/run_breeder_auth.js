require('dotenv').config();
const pool   = require('../src/config/db');
const bcrypt = require('bcryptjs');

async function runMigration() {
  const client = await pool.connect();
  try {
    console.log('\n🚀 Running Breeder Auth + Roles Migration...\n');
    await client.query('BEGIN');

    // ── 1. USER_ROLES ─────────────────────────────────────────────────────
    // Exact same structure as broiler backend
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_roles (
        id          SERIAL PRIMARY KEY,
        role_name   VARCHAR(100) NOT NULL,
        status      BOOLEAN DEFAULT TRUE,
        permissions JSONB,
        category    VARCHAR(50) NOT NULL DEFAULT 'Breeder',
        created_at  TIMESTAMP DEFAULT NOW(),
        updated_at  TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'uq_user_roles_role_category'
        ) THEN
          ALTER TABLE user_roles
          ADD CONSTRAINT uq_user_roles_role_category UNIQUE (role_name, category);
        END IF;
      END
      $$;
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_user_roles_category ON user_roles(category);`);
    console.log('  ✔ Table: user_roles');

    // ── 2. ADMIN (USERS) ──────────────────────────────────────────────────
    // Exact same structure as broiler backend
    await client.query(`
      CREATE TABLE IF NOT EXISTS admin (
        id          SERIAL PRIMARY KEY,
        first_name  VARCHAR(100) NOT NULL,
        last_name   VARCHAR(100),
        username    VARCHAR(100) NOT NULL,
        password    VARCHAR(255) NOT NULL,
        email       VARCHAR(150),
        phone       VARCHAR(20),
        role        VARCHAR(100),
        category    VARCHAR(50) NOT NULL DEFAULT 'Breeder',
        status      BOOLEAN DEFAULT TRUE,
        last_login  TIMESTAMP,
        created_at  TIMESTAMP DEFAULT NOW(),
        updated_at  TIMESTAMP DEFAULT NOW(),
        UNIQUE (username, category)
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_admin_category ON admin(category);`);
    console.log('  ✔ Table: admin');

    // ── 3. SEED BREEDER SCREENS (permissions template) ────────────────────
    // These are all the breeder module screens with view/edit/delete
    const breederScreens = {
      "egg_collection":     { view: true,  edit: true,  delete: true  },
      "feeding":            { view: true,  edit: true,  delete: true  },
      "mortality":          { view: true,  edit: true,  delete: true  },
      "bird_weighing":      { view: true,  edit: true,  delete: true  },
      "vaccination":        { view: true,  edit: false, delete: false },
      "biosecurity":        { view: true,  edit: true,  delete: true  },
      "flock_master":       { view: true,  edit: false, delete: false },
      "farmer_master":      { view: true,  edit: false, delete: false },
      "sap_sync":           { view: true,  edit: false, delete: false },
      "notifications":      { view: true,  edit: false, delete: false },
      "supervisor_mgmt":    { view: true,  edit: true,  delete: true  },
      "schedule":           { view: true,  edit: true,  delete: false },
      "reports":            { view: true,  edit: false, delete: false },
      "admin_panel":        { view: true,  edit: true,  delete: true  },
    };

    // Viewer — view only
    const viewerPerms = {};
    Object.keys(breederScreens).forEach(k => {
      viewerPerms[k] = { view: true, edit: false, delete: false };
    });

    // Supervisor — limited screens
    const supervisorPerms = {
      "egg_collection":  { view: true, edit: true,  delete: false },
      "feeding":         { view: true, edit: true,  delete: false },
      "mortality":       { view: true, edit: true,  delete: false },
      "bird_weighing":   { view: true, edit: true,  delete: false },
      "vaccination":     { view: true, edit: false, delete: false },
      "biosecurity":     { view: true, edit: true,  delete: false },
      "flock_master":    { view: true, edit: false, delete: false },
      "schedule":        { view: true, edit: true,  delete: false },
      "notifications":   { view: true, edit: false, delete: false },
    };

    // Seed default roles for Breeder
    const breederRoles = [
      { role_name: 'Super Admin',   permissions: breederScreens, status: true },
      { role_name: 'Farm Manager',  permissions: breederScreens, status: true },
      { role_name: 'Supervisor',    permissions: supervisorPerms, status: true },
      { role_name: 'Viewer',        permissions: viewerPerms,    status: true },
    ];

    for (const r of breederRoles) {
      await client.query(`
        INSERT INTO user_roles (role_name, status, permissions, category)
        VALUES ($1, $2, $3, 'Breeder')
        ON CONFLICT (role_name, category) DO UPDATE
        SET status = EXCLUDED.status,
            permissions = EXCLUDED.permissions,
            updated_at = NOW()
      `, [r.role_name, r.status, JSON.stringify(r.permissions)]);
    }
    console.log('  ✔ Seeded: 4 default Breeder roles');

    // Seed default roles for Hatchery
    const hatcheryScreens = {
      "egg_receipt":       { view: true,  edit: true,  delete: true  },
      "grade_setting":     { view: true,  edit: true,  delete: true  },
      "transfer_pullout":  { view: true,  edit: true,  delete: true  },
      "medicine_issue":    { view: true,  edit: true,  delete: true  },
      "sap_sync":          { view: true,  edit: false, delete: false },
      "notifications":     { view: true,  edit: false, delete: false },
      "supervisor_mgmt":   { view: true,  edit: true,  delete: true  },
      "schedule":          { view: true,  edit: true,  delete: false },
      "reports":           { view: true,  edit: false, delete: false },
      "admin_panel":       { view: true,  edit: true,  delete: true  },
    };

    const hatcheryViewerPerms = {};
    Object.keys(hatcheryScreens).forEach(k => {
      hatcheryViewerPerms[k] = { view: true, edit: false, delete: false };
    });

    const hatcherySupervisorPerms = {
      "egg_receipt":      { view: true, edit: true,  delete: false },
      "grade_setting":    { view: true, edit: true,  delete: false },
      "transfer_pullout": { view: true, edit: true,  delete: false },
      "medicine_issue":   { view: true, edit: true,  delete: false },
      "schedule":         { view: true, edit: true,  delete: false },
      "notifications":    { view: true, edit: false, delete: false },
    };

    const hatcheryRoles = [
      { role_name: 'Super Admin',   permissions: hatcheryScreens,        status: true },
      { role_name: 'Farm Manager',  permissions: hatcheryScreens,        status: true },
      { role_name: 'Supervisor',    permissions: hatcherySupervisorPerms,status: true },
      { role_name: 'Viewer',        permissions: hatcheryViewerPerms,    status: true },
    ];

    for (const r of hatcheryRoles) {
      await client.query(`
        INSERT INTO user_roles (role_name, status, permissions, category)
        VALUES ($1, $2, $3, 'Hatchery')
        ON CONFLICT (role_name, category) DO UPDATE
        SET status = EXCLUDED.status,
            permissions = EXCLUDED.permissions,
            updated_at = NOW()
      `, [r.role_name, r.status, JSON.stringify(r.permissions)]);
    }
    console.log('  ✔ Seeded: 4 default Hatchery roles');

    // ── 4. SEED DEFAULT USERS ─────────────────────────────────────────────
    const hash = await bcrypt.hash('Krishi@123', 10);
    const breederUsers = [
      { first_name: 'Super',      last_name: 'Admin',    username: 'superadmin',     role: 'Super Admin'  },
      { first_name: 'Farm',       last_name: 'Manager',  username: 'manager_farm01', role: 'Farm Manager' },
      { first_name: 'Supervisor', last_name: 'One',      username: 'supervisor01',   role: 'Supervisor'   },
      { first_name: 'Supervisor', last_name: 'Two',      username: 'supervisor02',   role: 'Supervisor'   },
    ];

    for (const u of breederUsers) {
      await client.query(`
        INSERT INTO admin
          (first_name, last_name, username, password, role, category, status)
        VALUES ($1,$2,$3,$4,$5,'Breeder',TRUE)
        ON CONFLICT (username, category) DO NOTHING
      `, [u.first_name, u.last_name, u.username, hash, u.role]);
    }
    console.log('  ✔ Seeded: 4 default Breeder users (password: Krishi@123)');

    const hatcheryUsers = [
      { first_name: 'Super',    last_name: 'Admin',      username: 'superadmin',            role: 'Super Admin'  },
      { first_name: 'Hatchery', last_name: 'Admin',      username: 'hatchery_admin',        role: 'Super Admin'  },
      { first_name: 'Hatchery', last_name: 'Manager',    username: 'hatchery_manager01',    role: 'Farm Manager' },
      { first_name: 'Hatchery', last_name: 'Supervisor', username: 'hatchery_supervisor01', role: 'Supervisor'   },
    ];

    for (const u of hatcheryUsers) {
      await client.query(`
        INSERT INTO admin
          (first_name, last_name, username, password, role, category, status)
        VALUES ($1,$2,$3,$4,$5,'Hatchery',TRUE)
        ON CONFLICT (username, category) DO NOTHING
      `, [u.first_name, u.last_name, u.username, hash, u.role]);
    }
    console.log('  ✔ Seeded: 4 default Hatchery users (password: Krishi@123) — includes superadmin + Hatchery');

    await client.query('COMMIT');

    console.log(`
✅ Breeder Auth + Roles Migration Complete!
──────────────────────────────────────────────────────────
  Tables:
    user_roles  — role_name, permissions (JSONB), category
    admin       — users with role, category='Breeder'
──────────────────────────────────────────────────────────
  Default Roles (Breeder):
    Super Admin  → all screens full access
    Farm Manager → all screens full access
    Supervisor   → limited screens, no delete
    Viewer       → view only
──────────────────────────────────────────────────────────
  Default Users (password: Krishi@123):
    superadmin     → Super Admin
    manager_farm01 → Farm Manager
    supervisor01   → Supervisor
    supervisor02   → Supervisor
──────────────────────────────────────────────────────────
  Breeder Screens:
    egg_collection, feeding, mortality, bird_weighing,
    vaccination, biosecurity, flock_master, farmer_master,
    sap_sync, notifications, supervisor_mgmt, schedule,
    reports, admin_panel
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
