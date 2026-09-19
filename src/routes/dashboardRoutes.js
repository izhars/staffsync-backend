const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const { ACCESS_ROLES } = require('../constants/roles');
const {
  getDashboardStats,
  getAttendanceOverview,
  getLeaveOverview,
  getEmployeeGrowth,
  getAllEmployees,
  getEmployeeById
} = require('../controllers/dashboardController');

router.use(protect);

// Public to logged-in users
router.get('/stats', getDashboardStats);

// Restricted routes
router.get('/attendance-overview', authorize(ACCESS_ROLES.HR_ADMIN, ACCESS_ROLES.MANAGER, ACCESS_ROLES.SUPER_ADMIN), getAttendanceOverview);
router.get('/leave-overview', authorize(ACCESS_ROLES.HR_ADMIN, ACCESS_ROLES.MANAGER, ACCESS_ROLES.SUPER_ADMIN), getLeaveOverview);
router.get('/employee-growth', authorize(ACCESS_ROLES.HR_ADMIN, ACCESS_ROLES.SUPER_ADMIN), getEmployeeGrowth);

// Employee CRUD
router.get('/employees', authorize(ACCESS_ROLES.HR_ADMIN, ACCESS_ROLES.SUPER_ADMIN), getAllEmployees);
router.get('/employees/:id', authorize(ACCESS_ROLES.HR_ADMIN, ACCESS_ROLES.SUPER_ADMIN), getEmployeeById);

module.exports = router;