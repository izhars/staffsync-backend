// routes/dashboardRoutes.js

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
  getEmployeeById,
} = require('../controllers/dashboardController');

// All routes require authentication
router.use(protect);

// Dashboard stats (all authenticated users)
router.get('/stats', getDashboardStats);

// Analytics (HR, Manager, Admin)
const analyticsRoles = authorize(
  ACCESS_ROLES.HR_ADMIN,
  ACCESS_ROLES.MANAGER,
  ACCESS_ROLES.SUPER_ADMIN
);

router.get('/attendance-overview', analyticsRoles, getAttendanceOverview);
router.get('/leave-overview', analyticsRoles, getLeaveOverview);

// Growth & employee management (HR, Admin only)
const adminRoles = authorize(ACCESS_ROLES.HR_ADMIN, ACCESS_ROLES.SUPER_ADMIN);

router.get('/employee-growth', adminRoles, getEmployeeGrowth);
router.get('/employees', adminRoles, getAllEmployees);
router.get('/employees/:id', adminRoles, getEmployeeById);

module.exports = router;