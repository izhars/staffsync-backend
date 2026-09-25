// services/dashboard/employeeDashboardService.js

const Attendance = require('../models/Attendance');
const Leave = require('../models/Leave');
const { getStartOfDay, getStartOfMonth } = require('../utils/dateUtils');
const { ATTENDANCE_STATUS, PRESENT_STATUSES, LEAVE_STATUS } = require('../constants/dashboard');

/**
 * Build dashboard stats for an employee user
 */
const getEmployeeStats = async (user) => {
  const today = getStartOfDay();
  const startOfMonth = getStartOfMonth();

  const [todayAttendance, pendingLeaves, monthAttendance] = await Promise.all([
    Attendance.findOne({ employee: user.id, date: today }).lean(),
    Leave.countDocuments({ employee: user.id, status: LEAVE_STATUS.PENDING }),
    Attendance.find({
      employee: user.id,
      date: { $gte: startOfMonth, $lte: today },
    }).lean(),
  ]);

  const monthlyStats = {
    present: monthAttendance.filter((a) => PRESENT_STATUSES.includes(a.status)).length,
    absent: monthAttendance.filter((a) => a.status === ATTENDANCE_STATUS.ABSENT).length,
    onLeave: monthAttendance.filter((a) => a.status === ATTENDANCE_STATUS.ON_LEAVE).length,
  };

  return {
    todayStatus: todayAttendance?.status ?? ATTENDANCE_STATUS.ABSENT,
    checkInTime: todayAttendance?.checkInTimeFormatted ?? null,
    checkOutTime: todayAttendance?.checkOutTimeFormatted ?? null,
    workHours: todayAttendance?.workHours ?? 0,
    isLate: todayAttendance?.isLate ?? false,
    leaveBalance: user.leaveBalance,
    pendingLeaves,
    monthlyStats,
  };
};

module.exports = { getEmployeeStats };