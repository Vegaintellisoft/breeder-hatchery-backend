require('dotenv').config();
const pool = require('../src/config/db');

async function runMigration() {
  const client = await pool.connect();
  try {
    console.log('Updating egg_grading_quick constraint...');

    // Drop old constraint
    await client.query(`
      ALTER TABLE egg_grading_quick
      DROP CONSTRAINT IF EXISTS chk_selected_grade;
    `);

    // Add new constraint with collection_1 to collection_6
    await client.query(`
      ALTER TABLE egg_grading_quick
      ADD CONSTRAINT chk_selected_grade
      CHECK (selected_grade IN (
        'collection_1','collection_2','collection_3',
        'collection_4','collection_5','collection_6'
      ));
    `);

    console.log('✅ egg_grading_quick constraint updated.');
    console.log('Valid grades: collection_1, collection_2, collection_3, collection_4, collection_5, collection_6');
  } catch (err) {
    console.error('Migration error:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration();
