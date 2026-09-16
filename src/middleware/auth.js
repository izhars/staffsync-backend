const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Token = require('../models/Token');

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
      return res.status(401).json({
        success: false,
        message: 'User not found',
      });
    }

    // Save/Update token
    const issuedAt = new Date(decoded.iat * 1000);
    const expiresAt = new Date(decoded.exp * 1000);

    let tokenType = 'employee';
    if (['manager', 'hr', 'superadmin'].includes(user.role)) {
      tokenType = user.role;
    }

    await Token.findOneAndUpdate(
      { user: user._id },
      {
        token,
        role: user.role,
        tokenType,
        issuedAt,
        expiresAt,
      },
      { upsert: true, new: true }
    );

    req.user = user;

    next();
  } catch (error) {
    console.error('❌ JWT verification failed:', error.message);
    res.status(401).json({
      success: false,
      message: 'Not authorized to access this route (invalid token)',
    });
  }
};

// 🧩 Role Authorization
exports.authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `User role '${req.user.role}' is not authorized to access this route`,
      });
    }

    next();
  };
};

// 🔐 Predefined Role Groups
exports.superAdminOnly = exports.authorize('superadmin');
exports.hrAndAbove = exports.authorize('superadmin', 'hr');
exports.managerAndAbove = exports.authorize('superadmin', 'hr', 'manager');