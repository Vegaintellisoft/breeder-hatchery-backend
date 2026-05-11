require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../src/config/db');

async function run() {
  const client = await pool.connect();
  try {
    console.log('\n🚀 Cull Sales v2 Migration (add pdf_link + gross_value)...\n');
    await client.query('BEGIN');

    // Add pdf_link to cull_sales_header
    await client.query(`
      ALTER TABLE cull_sales_header
        ADD COLUMN IF NOT EXISTS gross_value  NUMERIC(12,2) DEFAULT 0,
        ADD COLUMN IF NOT EXISTS pdf_link     TEXT,
        ADD COLUMN IF NOT EXISTS dc_no_auto   VARCHAR(50)
    `);
    console.log('  ✔ Added gross_value, pdf_link, dc_no_auto to cull_sales_header');

    await client.query('COMMIT');
    console.log('\n✅ Cull Sales v2 Migration done!\n');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error:', err.message);
    process.exit(1);
  } finally {
    client.release();
    process.exit(0);
  }
}
run();
