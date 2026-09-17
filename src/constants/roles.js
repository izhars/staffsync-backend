// constants/roles.js
// Single source of truth for Access Roles across the HRMS.
// Department and Designation are SEPARATE concepts and must never be
// encoded into this file.

const ACCESS_ROLES = {
  SUPER_ADMIN: 'superadmin',
  HR_ADMIN:    'hr_admin',
  MANAGER:     'manager',
  TEAM_LEAD:   'team_lead',
  EMPLOYEE:    'employee',
};

// Who can create whom.
// NOTE: 'manager' is further scoped by department at the controller level.
const ROLE_CREATION_MATRIX = {
  superadmin: ['hr_admin', 'manager', 'team_lead', 'employee'],
  hr_admin:   ['manager', 'team_lead', 'employee'],
  manager:    ['team_lead', 'employee'],
  team_lead:  [],
  employee:   [],
};

// Numeric authority ranking (higher = more authority).
// Used for "at least X" checks without hardcoding role lists everywhere.
const ROLE_RANK = {
  superadmin: 100,
  hr_admin:   80,
  manager:    60,
  team_lead:  40,
  employee:   20,
};

// Human-readable labels for UI / logs
const ROLE_LABELS = {
  superadmin: 'Super Admin',
  hr_admin:   'HR Admin',
  manager:    'Manager',
  team_lead:  'Team Lead',
  employee:   'Employee',
};

// Roles that are treated as "employee-only" for schema-level conditionals
// (i.e. these roles DO carry personal / salary / bank info).
const NON_ADMIN_ROLES = [
  ACCESS_ROLES.HR_ADMIN,
  ACCESS_ROLES.MANAGER,
  ACCESS_ROLES.EMPLOYEE,
];


// Roles that should NOT carry personal / salary / bank info.
const ADMIN_ROLES = [ACCESS_ROLES.SUPER_ADMIN, ACCESS_ROLES.HR_ADMIN];

module.exports = {
  ACCESS_ROLES,
  ROLE_CREATION_MATRIX,
  ROLE_RANK,
  ROLE_LABELS,
  NON_ADMIN_ROLES,
  ADMIN_ROLES,
};