const pool = require('../src/config/db');

async function migrate() {
  console.log('🔄 Creating breeder_controller_config table …');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS breeder_controller_config (
      id                    SERIAL PRIMARY KEY,
      plant_code            VARCHAR(20)  NOT NULL,
      plant_name            VARCHAR(255),
      shed_id               INTEGER      NOT NULL,
      shed_no               VARCHAR(50),

      -- Feeding
      feeding_part          BOOLEAN DEFAULT FALSE,
      feeding_line          BOOLEAN DEFAULT FALSE,
      -- Medicine
      medicine_part         BOOLEAN DEFAULT FALSE,
      medicine_line         BOOLEAN DEFAULT FALSE,
      -- Others
      others_part           BOOLEAN DEFAULT FALSE,
      others_line           BOOLEAN DEFAULT FALSE,
      -- Mortality
      mortality_part        BOOLEAN DEFAULT FALSE,
      mortality_line        BOOLEAN DEFAULT FALSE,
      -- Cull Kill
      cull_kill_part        BOOLEAN DEFAULT FALSE,
      cull_kill_line        BOOLEAN DEFAULT FALSE,
      -- Egg Collection
      egg_collection_part   BOOLEAN DEFAULT FALSE,
      egg_collection_line   BOOLEAN DEFAULT FALSE,

      created_by            VARCHAR(100),
      created_at            TIMESTAMP DEFAULT NOW(),
      updated_at            TIMESTAMP DEFAULT NOW(),

      UNIQUE(plant_code, shed_id)
    )
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_ctrl_cfg_plant   ON breeder_controller_config(plant_code)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_ctrl_cfg_shed    ON breeder_controller_config(shed_id)`);

  console.log('✅ breeder_controller_config table ready');
}

migrate()
  .then(() => { console.log('Done'); process.exit(0); })
  .catch((err) => { console.error('❌ Migration failed:', err.message); process.exit(1); });
