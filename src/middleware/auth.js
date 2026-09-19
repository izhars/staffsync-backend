// middleware/auth.js
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Token = require('../models/Token');
const { ACCESS_ROLES, ROLE_RANK } = require('../constants/roles');

const normalizeRoleName = (role) => {
  const roleName = String(role || '').trim().toLowerCase();
  const legacyAliases = {
    admin: ACCESS_ROLES.HR_ADMIN,
    hr: ACCESS_ROLES.HR_ADMIN,
    superadmin: ACCESS_ROLES.SUPER_ADMIN,
    teamlead: ACCESS_ROLES.TEAM_LEAD,
    team_lead: ACCESS_ROLES.TEAM_LEAD,
  };

  return legacyAliases[roleName] || roleName;
};

exports.protect = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Not authorized to access this route (no token provided)',
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select('-password');

    if (!user) {
      return res.status(401).json({ success: false, message: 'User not found' });
    }

    // Save/Update token
    const issuedAt  = new Date(decoded.iat * 1000);
    const expiresAt = new Date(decoded.exp * 1000);

    let tokenType = 'employee';
    if ([
      ACCESS_ROLES.MANAGER,
      ACCESS_ROLES.TEAM_LEAD,
      ACCESS_ROLES.HR_ADMIN,
      ACCESS_ROLES.SUPER_ADMIN,
    ].includes(user.role)) {
      tokenType = user.role;
    }

    await Token.findOneAndUpdate(
      { user: user._id },
      { token, role: user.role, tokenType, issuedAt, expiresAt },
      { upsert: true, new: true }
    );

    req.user = user;
    next();
  } catch (error) {
    console.error('❌ JWT verification failed:', error.message);
    return res.status(401).json({
      success: false,
      message: 'Not authorized to access this route (invalid token)',
    });
  }
};

// 🧩 Role Authorization
exports.authorize = (...roles) => {
  const allowedRoles = roles.map(normalizeRoleName);

  return (req, res, next) => {
    const userRole = normalizeRoleName(req.user?.role);

    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({
        success: false,
        message: `User role '${req.user?.role || 'unknown'}' is not authorized to access this route`,
      });
    }
    next();
  };
};

// 🔐 Predefined Role Groups
exports.superAdminOnly  = exports.authorize(ACCESS_ROLES.SUPER_ADMIN);
exports.hrAdminAndAbove = exports.authorize(ACCESS_ROLES.SUPER_ADMIN, ACCESS_ROLES.HR_ADMIN);

// Backwards-compatible alias (old routes used `hrAndAbove`)
exports.hrAndAbove      = exports.hrAdminAndAbove;

exports.managerAndAbove = exports.authorize(
  ACCESS_ROLES.SUPER_ADMIN,
  ACCESS_ROLES.HR_ADMIN,
  ACCESS_ROLES.MANAGER
);

exports.teamLeadAndAbove = exports.authorize(
  ACCESS_ROLES.SUPER_ADMIN,
  ACCESS_ROLES.HR_ADMIN,
  ACCESS_ROLES.MANAGER,
  ACCESS_ROLES.TEAM_LEAD
);

// Rank-based guard — "at least this role"
exports.minRole = (minRole) => (req, res, next) => {
  const userRank     = ROLE_RANK[req.user.role] ?? 0;
  const requiredRank = ROLE_RANK[minRole] ?? 0;
  if (userRank < requiredRank) {
    return res.status(403).json({ success: false, message: 'Insufficient privileges' });
  }
  next();
};

// Same-department guard for managers.
// `getTargetDepartmentId` is an async function (req) => ObjectId | null
exports.sameDepartmentOrAdmin = (getTargetDepartmentId) => async (req, res, next) => {
  if ([ACCESS_ROLES.SUPER_ADMIN, ACCESS_ROLES.HR_ADMIN].includes(req.user.role)) {
    return next();
  }
  if (req.user.role !== ACCESS_ROLES.MANAGER) {
    return res.status(403).json({ success: false, message: 'Not authorized' });
  }
  try {
    const targetDeptId = await getTargetDepartmentId(req);
    if (!targetDeptId || String(targetDeptId) !== String(req.user.department)) {
      return res.status(403).json({
        success: false,
        message: 'Managers can only manage users within their own department',
      });
    }
    next();
  } catch (err) {
    next(err);
  }
};