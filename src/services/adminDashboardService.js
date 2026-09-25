const User = require('../models/User');
const Attendance = require('../models/Attendance');
const Leave = require('../models/Leave');
const Department = require('../models/Department');
const Announcement = require('../models/Announcement');
const { getStartOfDay, getStartOfMonth } = require('../utils/dateUtils');
const { ATTENDANCE_STATUS, PRESENT_STATUSES, LEAVE_STATUS } = require('../constants/dashboard');

/**
 * Count attendance statuses for today
 */
const countTodayAttendance = (attendanceRecords) => {
  const counts = {
    presentToday: 0,
    onLeaveToday: 0,
    halfDayToday: 0,
    lateToday: 0,
  };

  attendanceRecords.forEach((record) => {
    if (PRESENT_STATUSES.includes(record.status)) counts.presentToday++;
    if (record.status === ATTENDANCE_STATUS.ON_LEAVE) counts.onLeaveToday++;
    if (record.status === ATTENDANCE_STATUS.HALF_DAY) counts.halfDayToday++;
    if (record.isLate) counts.lateToday++;
  });

  return counts;
};

/**
 * Count employees who are absent today.
 * Absent = no attendance record OR record with status 'absent'
 */
const countAbsentToday = (allEmployees, todayAttendance) => {
  const attendedIds = new Set(todayAttendance.map((a) => String(a.employee?._id)));
  const absentIds = new Set(
    todayAttendance
      .filter((a) => a.status === ATTENDANCE_STATUS.ABSENT)
      .map((a) => String(a.employee?._id))
  );

  return allEmployees.filter((emp) => {
    const id = String(emp._id);
    return !attendedIds.has(id) || absentIds.has(id);
  }).length;
};

/**
 * Build dashboard stats for HR / Admin / Manager
 */
const getAdminStats = async () => {
  const today = getStartOfDay();
  const startOfMonth = getStartOfMonth();

  const [
    totalEmployees,
    totalDepartments,
    pendingLeaves,
    recentAnnouncements,
    departments,
    monthLeaves,
    allEmployees,
    todayAttendance,
  ] = await Promise.all([
    User.countDocuments({ isActive: true, role: { $in: ['employee', 'manager'] } }),
    Department.countDocuments({ isActive: true }),
    Leave.countDocuments({ status: LEAVE_STATUS.PENDING }),
    Announcement.find({ isActive: true })
      .limit(5)
      .sort({ createdAt: -1 })
      .populate('createdBy', 'firstName lastName')
      .lean(),
    Department.find({ isActive: true }).select('name code employeeCount').lean(),
    Leave.countDocuments({ startDate: { $gte: startOfMonth }, status: LEAVE_STATUS.APPROVED }),
    User.find({ isActive: true, role: { $in: ['employee', 'manager'] } })
      .select('_id firstName lastName role department')
      .lean(),
    Attendance.find({ date: today })
      .populate('employee', '_id firstName lastName role department')
      .lean(),
  ]);

  const attendanceCounts = countTodayAttendance(todayAttendance);
  const absentToday = countAbsentToday(allEmployees, todayAttendance);

  return {
    totalEmployees,
    totalDepartments,
    ...attendanceCounts,
    absentToday,
    pendingLeaves,
    monthLeaves,
    recentAnnouncements,
    departments,
  };
};

module.exports = { getAdminStats, countTodayAttendance, countAbsentToday };