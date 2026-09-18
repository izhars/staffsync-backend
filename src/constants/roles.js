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

const hasRankAtLeast = (role, minRole) => {
  const userRank = ROLE_RANK[role] ?? -1;
  const minRank  = ROLE_RANK[minRole] ?? Infinity;
  return userRank >= minRank;
};

/** Convenience predicates */
const isSuperAdmin = (role) => role === ACCESS_ROLES.SUPER_ADMIN;
const isHrAdmin    = (role) => role === ACCESS_ROLES.HR_ADMIN;
const isManager    = (role) => role === ACCESS_ROLES.MANAGER;
const isTeamLead   = (role) => role === ACCESS_ROLES.TEAM_LEAD;
const isEmployee   = (role) => role === ACCESS_ROLES.EMPLOYEE;

/** HR admin or above (superadmin + hr_admin) */
const isHrAdminOrAbove = (role) => hasRankAtLeast(role, ACCESS_ROLES.HR_ADMIN);

/** Manager or above */
const isManagerOrAbove = (role) => hasRankAtLeast(role, ACCESS_ROLES.MANAGER);

module.exports = {
  ACCESS_ROLES,
  ROLE_CREATION_MATRIX,
  ROLE_RANK,
  ROLE_LABELS,
  NON_ADMIN_ROLES,
  ADMIN_ROLES,
  hasRankAtLeast,
  isSuperAdmin,
  isHrAdmin,
  isManager,
  isTeamLead,
  isEmployee,
  isHrAdminOrAbove,
  isManagerOrAbove,
};