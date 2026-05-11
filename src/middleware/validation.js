const { body, validationResult } = require('express-validator');

const entryValidation = [
  body('flock_id')
    .notEmpty().withMessage('flock_id is required')
    .isInt({ min: 1 }).withMessage('flock_id must be a positive integer'),

  body('entry_date')
    .notEmpty().withMessage('entry_date is required')
    .isDate().withMessage('entry_date must be YYYY-MM-DD'),

  // Male stock
  ...[
    'male_opening_stock','male_mortality','male_culls_kill',
    'male_culls_sale','male_transfer_in','male_transfer_out','male_sales',
  ].map(f => body(f).optional().isInt({ min: 0 }).withMessage(`${f} must be a non-negative integer`)),

  // Female stock
  ...[
    'female_opening_stock','female_mortality','female_culls_kill',
    'female_culls_sale','female_transfer_in','female_transfer_out','female_sales',
  ].map(f => body(f).optional().isInt({ min: 0 }).withMessage(`${f} must be a non-negative integer`)),

  body('body_weight_avg_kg').optional().isFloat({ min: 0 }).withMessage('body_weight_avg_kg must be a positive decimal'),
  body('egg_collections').optional().isInt({ min: 0 }),
  body('temp_min_celsius').optional().isFloat(),
  body('temp_max_celsius').optional().isFloat(),
  body('humidity_min').optional().isFloat({ min: 0, max: 100 }),
  body('humidity_max').optional().isFloat({ min: 0, max: 100 }),
  body('lighting_start').optional().matches(/^\d{2}:\d{2}(:\d{2})?$/).withMessage('lighting_start must be HH:MM'),
  body('lighting_end').optional().matches(/^\d{2}:\d{2}(:\d{2})?$/).withMessage('lighting_end must be HH:MM'),
];

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array().map(e => ({ field: e.path, message: e.msg })),
    });
  }
  next();
};

module.exports = { entryValidation, validate };
