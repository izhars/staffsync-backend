// routes/attendanceRoutes.js
const express = require('express');
const router = express.Router();

const {
  protect,
  managerAndAbove,   // super_admin + hr_admin + manager
  hrAdminAndAbove,   // super_admin + hr_admin
} = require('../middleware/auth');

const {
  checkIn,
  checkOut,
  getMyAttendance,
  getTodayAttendance,
  getEmployeeAttendance,
  getEmployeeAttendancWithCalender,
  getAttendanceReport,
  updateAttendance,
  markStatus,
  bulkUploadAttendance,
  getAttendanceSummary,
  cancelAction,
  getAttendanceStatus,
  exportAttendance,
  getTodayAllEmployeesAttendance,
  getAllEmployeesAttendance,
  getEmployeeWorkHoursChart,
  getWorkHoursChartMonthly,
  exportMonthlyAttendanceExcel,
} = require('../controllers/attendanceController');

// Protect all routes
router.use(protect);

// ─────────────────────────────────────────────
// Employee self-service (any authenticated user)
// ─────────────────────────────────────────────
router.post('/check-in', checkIn);
router.post('/check-out', checkOut);
router.get('/my-attendance', getMyAttendance);
router.get('/today', getTodayAttendance);
router.get('/status', getAttendanceStatus);
router.get('/work-hours-chart', getEmployeeWorkHoursChart);
router.get('/work-hours-chart-monthly', getWorkHoursChartMonthly);

// ─────────────────────────────────────────────
// Manager / HR / Admin
// ─────────────────────────────────────────────
router.get('/employee/:employeeId', managerAndAbove, getEmployeeAttendance);
router.get('/summary', managerAndAbove, getAttendanceSummary);

// ─────────────────────────────────────────────
// HR / Admin only
// ─────────────────────────────────────────────
router.get('/today-all', hrAdminAndAbove, getTodayAllEmployeesAttendance);
router.get('/attendance-all', hrAdminAndAbove, getAllEmployeesAttendance);
router.get('/report', hrAdminAndAbove, getAttendanceReport);
router.get(
  '/employee-attendance/:employeeId',
  hrAdminAndAbove,
  getEmployeeAttendancWithCalender
);
router.post('/mark-status', hrAdminAndAbove, markStatus);
router.post('/bulk-upload', hrAdminAndAbove, bulkUploadAttendance);
router.get('/export', hrAdminAndAbove, exportAttendance);
router.get('/export-monthly', hrAdminAndAbove, exportMonthlyAttendanceExcel);

// Parameterized routes — keep LAST so they don't shadow static paths
router.put('/:attendanceId', hrAdminAndAbove, updateAttendance);
router.delete('/:attendanceId/action', hrAdminAndAbove, cancelAction);

module.exports = router;