// utils/leavePermissions.js
const User = require('../models/User');
const { ACCESS_ROLES } = require('../constants/roles');


const normalizeRole = (role) =>
  String(role || '').trim().toLowerCase();

const canActOnLeave = async (currentUser, leaveEmployeeId) => {
  if (!currentUser || !leaveEmployeeId) return false;

  const role = normalizeRole(currentUser.role);
  const userId = String(currentUser.id || currentUser._id || '');

  if (!userId) return false;

  // ── HR Admin + Super Admin: can act on anyone ────────────────
  if (
    role === ACCESS_ROLES.HR_ADMIN ||
    role === ACCESS_ROLES.SUPER_ADMIN
  ) {
    return true;
  }

  // ── Manager: only direct reports ─────────────────────────────
  if (role === ACCESS_ROLES.MANAGER) {
    return isDirectReport(userId, leaveEmployeeId);
  }

  return false;
};


const isDirectReport = async (managerId, employeeId) => {
  const employee = await User.findById(employeeId)
    .select('manager reportingManager');
  if (!employee) return false;

  // Support either field name — whichever exists on the schema.
  const managerRef = employee.manager || employee.reportingManager;
  if (!managerRef) return false;

  return String(managerRef) === String(managerId);
};

const canViewLeave = async (currentUser, leave) => {
  if (!currentUser || !leave) return false;

  const role = normalizeRole(currentUser.role);
  const userId = String(currentUser.id || currentUser._id || '');
  const ownerId = String(leave.employee?._id || leave.employee || '');

  if (!userId || !ownerId) return false;

  // Self
  if (userId === ownerId) return true;

  // HR / Super Admin see everything
  if (
    role === ACCESS_ROLES.HR_ADMIN ||
    role === ACCESS_ROLES.SUPER_ADMIN
  ) {
    return true;
  }

  // Managers see their direct reports
  if (role === ACCESS_ROLES.MANAGER) {
    return isDirectReport(userId, ownerId);
  }

  return false;
};

module.exports = {
  canActOnLeave,
  canViewLeave,
  isDirectReport,
  normalizeRole,
};