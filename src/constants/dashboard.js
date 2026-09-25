const DASHBOARD_ROLES = {
  EMPLOYEE: 'employee',
  MANAGER: 'manager',
  HR_ADMIN: 'hr_admin',
  SUPER_ADMIN: 'super_admin',
};

const ATTENDANCE_STATUS = {
  PRESENT: 'present',
  ABSENT: 'absent',
  HALF_DAY: 'half-day',
  ON_LEAVE: 'on-leave',
  PUBLIC_HOLIDAY: 'public-holiday',
  COMBO_OFF: 'combo-off',
  NON_WORKING_DAY: 'non-working-day',
};

const LEAVE_STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  CANCELLED: 'cancelled',
};

const LEAVE_TYPE = {
  CASUAL: 'casual',
  SICK: 'sick',
  EARNED: 'earned',
  UNPAID: 'unpaid',
  COMBO: 'combo',
};

const PRESENT_STATUSES = [ATTENDANCE_STATUS.PRESENT, ATTENDANCE_STATUS.HALF_DAY];

module.exports = {
  DASHBOARD_ROLES,
  ATTENDANCE_STATUS,
  LEAVE_STATUS,
  LEAVE_TYPE,
  PRESENT_STATUSES,
};