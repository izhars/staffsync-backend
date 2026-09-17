// routes/celebrationRoutes.js
const express = require('express');
const router = express.Router();

const { protect } = require('../middleware/auth');

const {
  getTodaysBirthdays,
  getTodaysMarriageAnniversaries,
  getTodaysWorkAnniversaries,
  getAllUpComingCelebrations,
  getAllTodayCelebrations,
  getCelebrationStats,
  sendCelebrationNotification,
  getEmployeeDetails,
} = require('../controllers/celebrationController');

router.use(protect);

// ─────────────────────────────────────────────
// Static routes
// ─────────────────────────────────────────────
router.get('/birthdays', getTodaysBirthdays);
router.get('/marriage-anniversaries', getTodaysMarriageAnniversaries);
router.get('/work-anniversaries', getTodaysWorkAnniversaries);
router.get('/all-upcoming', getAllUpComingCelebrations);
router.get('/all-today', getAllTodayCelebrations);
router.get('/stats', getCelebrationStats);

router.post('/send-notification', sendCelebrationNotification);

// ─────────────────────────────────────────────
// Parameterized routes — last
// ─────────────────────────────────────────────
router.get('/employee/:employeeId', getEmployeeDetails);

module.exports = router;