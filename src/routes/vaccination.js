const express = require('express');
const router  = express.Router();
const {
  getSchedule,
  addScheduleItem,
  updateScheduleItem,
  deleteScheduleItem,
} = require('../controllers/vaccinationController');

// GET    /api/vaccination/schedule?search=&current_day=&category=
router.get('/schedule', getSchedule);

// POST   /api/vaccination/schedule
router.post('/schedule', addScheduleItem);

// PUT    /api/vaccination/schedule/:id
router.put('/schedule/:id', updateScheduleItem);

// DELETE /api/vaccination/schedule/:id
router.delete('/schedule/:id', deleteScheduleItem);

module.exports = router;
