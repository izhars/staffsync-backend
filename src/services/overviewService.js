// services/dashboard/overviewService.js

const Attendance = require('../models/Attendance');
const Leave = require('../models/Leave');
const User = require('../models/User');
const {
  getEndOfMonth,
  getStartOfYear,
  getEndOfYear,
  getMonthName,
} = require('../utils/dateUtils');
const { LEAVE_STATUS, ATTENDANCE_STATUS, PRESENT_STATUSES } = require('../constants/dashboard');

/**
 * Get monthly attendance overview using aggregation
 */
const getAttendanceOverviewData = async (year, month) => {
  const startDate = new Date(year, month - 1, 1);
  const endDate = getEndOfMonth(year, month);

  const [result] = await Attendance.aggregate([
    { $match: { date: { $gte: startDate, $lte: endDate } } },
    {
      $group: {
        _id: null,
        totalRecords: { $sum: 1 },
        present: {
          $sum: { $cond: [{ $in: ['$status', PRESENT_STATUSES] }, 1, 0] },
        },
        absent: { $sum: { $cond: [{ $eq: ['$status', ATTENDANCE_STATUS.ABSENT] }, 1, 0] } },
        onLeave: { $sum: { $cond: [{ $eq: ['$status', ATTENDANCE_STATUS.ON_LEAVE] }, 1, 0] } },
        late: { $sum: { $cond: ['$isLate', 1, 0] } },
        totalWorkHours: { $sum: '$workHours' },
      },
    },
  ]);

  const data = result || {
    totalRecords: 0,
    present: 0,
    absent: 0,
    onLeave: 0,
    late: 0,
    totalWorkHours: 0,
  };

  return {
    totalRecords: data.totalRecords,
    present: data.present,
    absent: data.absent,
    halfDay: Math.max(0, data.present - data.late), // rough estimate
    onLeave: data.onLeave,
    late: data.late,
    totalWorkHours: data.totalWorkHours,
  };
};

/**
 * Get yearly leave overview
 */
const getLeaveOverviewData = async (year) => {
  const startOfYear = getStartOfYear(year);
  const endOfYear = getEndOfYear(year);

  const leaves = await Leave.find({
    startDate: { $gte: startOfYear, $lte: endOfYear },
  }).lean();

  const countByStatus = (status) => leaves.filter((l) => l.status === status).length;
  const countByType = (type) => leaves.filter((l) => l.leaveType === type).length;

  return {
    total: leaves.length,
    pending: countByStatus(LEAVE_STATUS.PENDING),
    approved: countByStatus(LEAVE_STATUS.APPROVED),
    rejected: countByStatus(LEAVE_STATUS.REJECTED),
    cancelled: countByStatus(LEAVE_STATUS.CANCELLED),
    byType: {
      casual: countByType('casual'),
      combo: countByType('combo')
    },
    totalDays: leaves
      .filter((l) => l.status === LEAVE_STATUS.APPROVED)
      .reduce((sum, l) => sum + (l.totalDays || 0), 0),
  };
};

/**
 * Get employee growth chart data for a year
 */
const getEmployeeGrowthData = async (year) => {
  const monthlyData = [];

  for (let month = 0; month < 12; month++) {
    const startOfMonth = new Date(year, month, 1);
    const endOfMonth = getEndOfMonth(year, month + 1);

    const [joined, left, totalAtEnd] = await Promise.all([
      User.countDocuments({
        role: 'employee',
        dateOfJoining: { $gte: startOfMonth, $lte: endOfMonth },
      }),
      User.countDocuments({
        role: 'employee',
        dateOfLeaving: { $gte: startOfMonth, $lte: endOfMonth },
      }),
      User.countDocuments({
        role: 'employee',
        dateOfJoining: { $lte: endOfMonth },
        $or: [
          { dateOfLeaving: { $exists: false } },
          { dateOfLeaving: { $gt: endOfMonth } },
        ],
      }),
    ]);

    monthlyData.push({
      month: month + 1,
      monthName: getMonthName(year, month),
      joined,
      left,
      total: totalAtEnd,
    });
  }

  return monthlyData;
};

module.exports = {
  getAttendanceOverviewData,
  getLeaveOverviewData,
  getEmployeeGrowthData,
};