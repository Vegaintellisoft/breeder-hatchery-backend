const pool = require('../config/db');

// ═══════════════════════════════════════════════════════════════════════════
// SAMPLE SAP API - POST /api/feeding/sap/push-stock
// Simulates SAP pushing opening stock to our DB
// When real SAP API comes → just call this endpoint from SAP webhook/scheduler
// ═══════════════════════════════════════════════════════════════════════════
const sapPushStock = async (req, res) => {
  const { stock_date, items, sap_ref } = req.body;

  if (!stock_date || !Array.isArray(items) || items.length === 0) {
    return res.status(422).json({
      success: false,
      message: 'stock_date and items array are required',
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const saved = [];

    for (const item of items) {
      const { item_id, opening_qty } = item;
      if (!item_id || opening_qty === undefined) continue;

      // Verify item exists
      const itemCheck = await client.query(
        'SELECT id, item_name, category FROM feeding_items WHERE id = $1 AND is_active = TRUE',
        [item_id]
      );
      if (itemCheck.rowCount === 0) continue;

      const result = await client.query(`
        INSERT INTO feeding_opening_stock (item_id, stock_date, opening_qty, sap_ref)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (item_id, stock_date)
        DO UPDATE SET
          opening_qty = EXCLUDED.opening_qty,
          sap_ref     = EXCLUDED.sap_ref,
          updated_at  = NOW()
        RETURNING *
      `, [item_id, stock_date, opening_qty, sap_ref || null]);

      saved.push({
        ...result.rows[0],
        item_name: itemCheck.rows[0].item_name,
        category:  itemCheck.rows[0].category,
      });
    }

    await client.query('COMMIT');
    return res.status(200).json({
      success: true,
      message: `SAP stock pushed successfully for ${saved.length} item(s)`,
      data: saved,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[sapPushStock]', err.message);
    return res.status(500).json({ success: false, message: 'Internal server error', error: err.message });
  } finally {
    client.release();
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/feeding/:category?date=YYYY-MM-DD
// Get all items for a category with opening stock for given date
// category = feed | medicine | other
// ═══════════════════════════════════════════════════════════════════════════
const getItemsWithStock = async (req, res) => {
  const { category } = req.params;
  const date = req.query.date || new Date().toISOString().split('T')[0];

  if (!['feed', 'medicine', 'other'].includes(category)) {
    return res.status(422).json({ success: false, message: 'category must be feed, medicine, or other' });
  }

  try {
    const result = await pool.query(`
      SELECT
        fi.id,
        fi.item_name,
        fi.unit,
        fi.category,
        fi.is_dynamic,
        COALESCE(fos.opening_qty, 0)  AS opening_qty,
        COALESCE(fos.sap_ref, '')     AS sap_ref,
        COALESCE(fc.consumed_qty, 0)  AS consumed_qty,
        COALESCE(fc.closing_qty, 0)   AS closing_qty,
        fc.umo                        AS umo
      FROM feeding_items fi
      LEFT JOIN feeding_opening_stock fos
        ON fos.item_id = fi.id AND fos.stock_date = $2
      LEFT JOIN feeding_consumption fc
        ON fc.item_id = fi.id AND fc.entry_date = $2
      WHERE fi.category = $1 AND fi.is_active = TRUE
      ORDER BY fi.id
    `, [category, date]);

    // Add umo_options only for feed category
    const umo_options = category === 'feed' ? ['MT', 'Kg', 'Lit'] : null;

    return res.status(200).json({
      success: true,
      category,
      date,
      umo_options,
      data: result.rows,
    });
  } catch (err) {
    console.error('[getItemsWithStock]', err.message);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/feeding/consume
// Save consumption entries (multiple items at once)
// Validates: opening_stock - consumed_qty must NOT go negative
// ═══════════════════════════════════════════════════════════════════════════
const saveConsumption = async (req, res) => {
  const { entry_date, items } = req.body;

  if (!entry_date) {
    return res.status(422).json({ success: false, message: 'entry_date is required' });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(422).json({ success: false, message: 'items array is required and must not be empty' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── Pre-validate ALL items before saving any ──────────────────────────
    const errors = [];
    const itemDetails = [];

    for (const item of items) {
      const { item_id, consumed_qty, umo } = item;
      if (!item_id || consumed_qty === undefined) {
        errors.push({ item_id, message: 'item_id and consumed_qty are required' });
        continue;
      }
      if (consumed_qty < 0) {
        errors.push({ item_id, message: 'consumed_qty cannot be negative' });
        continue;
      }

      // Get item info
      const itemCheck = await client.query(
        'SELECT id, item_name, category FROM feeding_items WHERE id = $1 AND is_active = TRUE',
        [item_id]
      );
      if (itemCheck.rowCount === 0) {
        errors.push({ item_id, message: `Item ID ${item_id} not found` });
        continue;
      }

      // Get opening stock for this date
      const stockCheck = await client.query(
        'SELECT opening_qty FROM feeding_opening_stock WHERE item_id = $1 AND stock_date = $2',
        [item_id, entry_date]
      );

      const opening_qty = stockCheck.rowCount > 0 ? Number(stockCheck.rows[0].opening_qty) : 0;
      const closing_qty = opening_qty - Number(consumed_qty);

      // ── Negative stock check ─────────────────────────────────────────
      if (closing_qty < 0) {
        errors.push({
          item_id,
          item_name:    itemCheck.rows[0].item_name,
          opening_qty,
          consumed_qty: Number(consumed_qty),
          closing_qty,
          message: `Insufficient stock for "${itemCheck.rows[0].item_name}". Opening: ${opening_qty}, Consumed: ${consumed_qty}, Would be: ${closing_qty}`,
        });
        continue;
      }

      itemDetails.push({
        item_id,
        item_name:    itemCheck.rows[0].item_name,
        category:     itemCheck.rows[0].category,
        opening_qty,
        consumed_qty: Number(consumed_qty),
        closing_qty,
        umo:          umo || null,
      });
    }

    // If any item fails validation → reject entire batch
    if (errors.length > 0) {
      await client.query('ROLLBACK');
      return res.status(422).json({
        success: false,
        message: 'Consumption save failed due to validation errors',
        errors,
      });
    }

    // ── All valid → save all ──────────────────────────────────────────────
    const saved = [];
    for (const detail of itemDetails) {
      const result = await client.query(`
        INSERT INTO feeding_consumption (item_id, entry_date, opening_qty, consumed_qty, umo)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (item_id, entry_date)
        DO UPDATE SET
          opening_qty  = EXCLUDED.opening_qty,
          consumed_qty = EXCLUDED.consumed_qty,
          umo          = EXCLUDED.umo,
          updated_at   = NOW()
        RETURNING *
      `, [detail.item_id, entry_date, detail.opening_qty, detail.consumed_qty, detail.umo]);

      saved.push({
        ...result.rows[0],
        item_name: detail.item_name,
        category:  detail.category,
      });
    }

    await client.query('COMMIT');
    return res.status(200).json({
      success: true,
      message: 'Consumption saved successfully',
      data: saved,
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[saveConsumption]', err.message);
    return res.status(500).json({ success: false, message: 'Internal server error', error: err.message });
  } finally {
    client.release();
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/feeding/other/item  — Add dynamic item to Other tab
// ═══════════════════════════════════════════════════════════════════════════
const addOtherItem = async (req, res) => {
  const { item_name, unit } = req.body;

  if (!item_name || item_name.trim() === '') {
    return res.status(422).json({ success: false, message: 'item_name is required' });
  }

  try {
    const result = await pool.query(`
      INSERT INTO feeding_items (category, item_name, unit, is_dynamic)
      VALUES ('other', $1, $2, TRUE)
      ON CONFLICT (category, item_name)
      DO UPDATE SET is_active = TRUE, unit = EXCLUDED.unit, updated_at = NOW()
      RETURNING *
    `, [item_name.trim(), unit || null]);

    return res.status(200).json({
      success: true,
      message: 'Other item added successfully',
      data: result.rows[0],
    });
  } catch (err) {
    console.error('[addOtherItem]', err.message);
    return res.status(500).json({ success: false, message: 'Internal server error', error: err.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// DELETE /api/feeding/other/item/:id  — Remove dynamic item from Other tab
// ═══════════════════════════════════════════════════════════════════════════
const removeOtherItem = async (req, res) => {
  const { id } = req.params;
  try {
    const check = await pool.query(
      'SELECT id, item_name, is_dynamic FROM feeding_items WHERE id = $1',
      [id]
    );
    if (check.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Item not found' });
    }
    if (!check.rows[0].is_dynamic) {
      return res.status(403).json({ success: false, message: 'Cannot delete fixed items (feed/medicine). Only Other tab items can be removed.' });
    }

    await pool.query(
      'UPDATE feeding_items SET is_active = FALSE, updated_at = NOW() WHERE id = $1',
      [id]
    );
    return res.status(200).json({ success: true, message: `Item "${check.rows[0].item_name}" removed from Other tab` });
  } catch (err) {
    console.error('[removeOtherItem]', err.message);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/feeding/consumption/history?category=feed&from=&to=
// ═══════════════════════════════════════════════════════════════════════════
const getConsumptionHistory = async (req, res) => {
  const { category, from, to, limit = 30, offset = 0 } = req.query;

  try {
    const conditions = ['fc.consumed_qty > 0'];
    const params     = [];
    let   idx        = 1;

    if (category) { conditions.push(`fi.category = $${idx++}`); params.push(category); }
    if (from)     { conditions.push(`fc.entry_date >= $${idx++}`); params.push(from); }
    if (to)       { conditions.push(`fc.entry_date <= $${idx++}`); params.push(to); }

    params.push(Number(limit), Number(offset));

    const result = await pool.query(`
      SELECT
        fc.id, fc.entry_date,
        fc.opening_qty, fc.consumed_qty, fc.closing_qty,
        fc.umo,
        fi.item_name, fi.unit, fi.category,
        fc.created_at
      FROM feeding_consumption fc
      JOIN feeding_items fi ON fi.id = fc.item_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY fc.entry_date DESC, fi.category, fi.item_name
      LIMIT $${idx++} OFFSET $${idx}
    `, params);

    return res.status(200).json({ success: true, count: result.rowCount, data: result.rows });
  } catch (err) {
    console.error('[getConsumptionHistory]', err.message);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

module.exports = {
  sapPushStock,
  getItemsWithStock,
  saveConsumption,
  addOtherItem,
  removeOtherItem,
  getConsumptionHistory,
};
