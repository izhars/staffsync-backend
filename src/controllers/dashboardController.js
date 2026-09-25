// controllers/dashboardController.js

const { getEmployeeStats } = require('../services/employeeDashboardService');
const { getAdminStats } = require('../services/adminDashboardService');
const {
  getAttendanceOverviewData,
  getLeaveOverviewData,
  getEmployeeGrowthData,
} = require('../services/overviewService');
const { getPaginatedEmployees, getEmployeeById } = require('../services/employeeService');
const { parseMonthYear } = require('../utils/dateUtils');
const { sendSuccess, sendError } = require('../utils/helpers');

// ─────────────────────────────────────────────────────────────
// @desc    Get dashboard statistics
// @route   GET /api/dashboard/stats
// @access  Private
// ─────────────────────────────────────────────────────────────
exports.getDashboardStats = async (req, res) => {
  try {
    const stats =
      req.user.role === 'employee'
        ? await getEmployeeStats(req.user)
        : await getAdminStats();

    return sendSuccess(res, { stats });
  } catch (error) {
    console.error('Dashboard Stats Error:', error);
    return sendError(res, error.message);
  }
};

// ─────────────────────────────────────────────────────────────
// @desc    Get attendance overview (monthly)
// @route   GET /api/dashboard/attendance-overview?month=6&year=2025
// @access  Private (HR, Manager, Admin)
// ─────────────────────────────────────────────────────────────
exports.getAttendanceOverview = async (req, res) => {
  try {
    const { year, month } = parseMonthYear(req.query);
    const overview = await getAttendanceOverviewData(year, month);

    return sendSuccess(res, { month, year, overview });
  } catch (error) {
    console.error('Attendance Overview Error:', error);
    return sendError(res, error.message);
  }
};

// ─────────────────────────────────────────────────────────────
// @desc    Get leave overview (yearly)
// @route   GET /api/dashboard/leave-overview?year=2025
// @access  Private (HR, Manager, Admin)
// ─────────────────────────────────────────────────────────────
exports.getLeaveOverview = async (req, res) => {
  try {
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();
    const overview = await getLeaveOverviewData(year);

    return sendSuccess(res, { year, overview });
  } catch (error) {
    console.error('Leave Overview Error:', error);
    return sendError(res, error.message);
  }
};

// ─────────────────────────────────────────────────────────────
// @desc    Get employee growth chart data
// @route   GET /api/dashboard/employee-growth?year=2025
// @access  Private (HR, Admin)
// ─────────────────────────────────────────────────────────────
exports.getEmployeeGrowth = async (req, res) => {
  try {
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();
    const data = await getEmployeeGrowthData(year);

    return sendSuccess(res, { year, data });
  } catch (error) {
    console.error('Employee Growth Error:', error);
    return sendError(res, error.message);
  }
};

// ─────────────────────────────────────────────────────────────
// @desc    Get all employees (with pagination)
// @route   GET /api/employees?page=1&limit=10
// @access  Private (HR, Admin)
// ─────────────────────────────────────────────────────────────
exports.getAllEmployees = async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const result = await getPaginatedEmployees(page, limit);

    return sendSuccess(res, {
      count: result.employees.length,
      total: result.total,
      page: result.page,
      pages: result.pages,
      employees: result.employees,
    });
  } catch (error) {
    console.error('Get Employees Error:', error);
    return sendError(res, error.message);
  }
};

// ─────────────────────────────────────────────────────────────
// @desc    Get single employee by ID
// @route   GET /api/employees/:id
// @access  Private (HR, Admin)
// ─────────────────────────────────────────────────────────────
exports.getEmployeeById = async (req, res) => {
  try {
    const employee = await getEmployeeById(req.params.id);

    if (!employee) {
      return sendError(res, 'Employee not found', 404);
    }

    return sendSuccess(res, { employee });
  } catch (error) {
    console.error('Get Employee By ID Error:', error);
    return sendError(res, error.message);
  }
};