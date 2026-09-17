// controllers/authController.js
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Department = require('../models/Department');
const ProfileLog = require('../models/ProfileLog'); // keep your existing model
const mongoose = require('mongoose');
const cloudinary = require('../config/cloudinary');
const fs = require('fs');
const emailService = require('../utils/emailService');
const { generateForgotPasswordEmail } = require('../email/forgotPasswordEmail');
const { uploadToCloudinary, deleteFromCloudinary } = require('../middleware/upload');
const { ACCESS_ROLES, ROLE_CREATION_MATRIX, ADMIN_ROLES } = require('../constants/roles');

const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5000';

// ────────────────────────────────────────────────────────────────
// JWT helper
// ────────────────────────────────────────────────────────────────
const generateToken = (id, role, employeeId) => {
  return jwt.sign(
    { id, role, employeeId },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRE || '30d' }
  );
};

// ────────────────────────────────────────────────────────────────
// @desc    Register new user
// @route   POST /api/auth/register
// @access  Private (Superadmin, HR Admin, Manager)
// ────────────────────────────────────────────────────────────────
exports.register = async (req, res) => {
  try {
    const {
      employeeId, email, password, firstName, lastName,
      role: requestedRole,      // ACCESS ROLE
      department,               // department name OR ObjectId
      designation,              // DESIGNATION (job title)
      dateOfJoining, employmentType,
      reportingManager, salary, bankDetails, phone, gender,
      dateOfBirth, maritalStatus, marriageAnniversary,
      spouseDetails, bloodGroup, address, emergencyContact,
      panNumber, pfNumber, uanNumber, documents, profilePicture,
      weekendType,
    } = req.body;

    // ── 1. Required field validation ─────────────────────────────
    if (!employeeId || !email || !password || !firstName || !lastName
        || !department || !designation) {
      return res.status(400).json({
        success: false,
        message: 'Employee ID, email, password, names, department, and designation are required',
      });
    }

    // ── 2. Role permission check ─────────────────────────────────
    const creatorRole = req.user?.role;
    const assignedRole = requestedRole || ACCESS_ROLES.EMPLOYEE;

    const allowed = ROLE_CREATION_MATRIX[creatorRole] || [];
    if (!allowed.includes(assignedRole)) {
      return res.status(403).json({
        success: false,
        message: `${creatorRole} can only create: ${allowed.join(', ') || 'none'}`,
      });
    }

    // ── 3. Duplicate check ───────────────────────────────────────
    const existingUser = await User.findOne({ $or: [{ email }, { employeeId }] });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: existingUser.email === email
          ? 'Email already registered'
          : 'Employee ID already exists',
      });
    }

    // ── 4. Resolve / auto-create Department ──────────────────────
    let deptDoc;
    if (mongoose.Types.ObjectId.isValid(department)) {
      deptDoc = await Department.findById(department);
    } else {
      deptDoc = await Department.findOne({
        name: { $regex: new RegExp(`^${department.trim()}$`, 'i') },
      });
    }

    if (!deptDoc) {
      const code = department
        .trim()
        .split(/\s+/)
        .map((w) => w[0])
        .join('')
        .toUpperCase()
        .substring(0, 4);

      deptDoc = await Department.create({
        name: department.trim().toUpperCase(),
        code,
        head: req.user._id,
      });
    }

    // ── 5. Managers may only hire into their own department ──────
    if (creatorRole === ACCESS_ROLES.MANAGER
        && String(deptDoc._id) !== String(req.user.department)) {
      return res.status(403).json({
        success: false,
        message: 'Managers can only create users within their own department',
      });
    }

    // ── 6. Reporting manager resolution ──────────────────────────
    let reportingManagerId = null;
    if (reportingManager && !['NA', ''].includes(String(reportingManager).trim())) {
      const trimmed = String(reportingManager).trim();
      const managerQuery = mongoose.Types.ObjectId.isValid(trimmed)
        ? { _id: trimmed }
        : { employeeId: trimmed.toUpperCase() };

      const manager = await User.findOne({
        ...managerQuery,
        isActive: true,
        role: {
          $in: [
            ACCESS_ROLES.SUPER_ADMIN,
            ACCESS_ROLES.HR_ADMIN,
            ACCESS_ROLES.MANAGER,
            ACCESS_ROLES.TEAM_LEAD,
          ],
        },
      });
      if (manager) reportingManagerId = manager._id;
    }

    // ── 7. Probation window ──────────────────────────────────────
    const probationStart = dateOfJoining ? new Date(dateOfJoining) : new Date();
    const probationEnd = new Date(probationStart);
    probationEnd.setMonth(probationEnd.getMonth() + 6);

    // ── 8. Build user payload ────────────────────────────────────
    const userData = {
      employeeId: employeeId.trim().toUpperCase(),
      email: email.toLowerCase().trim(),
      password,
      firstName: firstName.trim(),
      lastName:  lastName.trim(),
      role: assignedRole,               // ← ACCESS ROLE
      department: deptDoc._id,          // ← DEPARTMENT
      designation: designation.trim(),  // ← DESIGNATION (job title)
      dateOfJoining: dateOfJoining ? new Date(dateOfJoining) : new Date(),
      employmentType: employmentType || 'full-time',
      reportingManager: reportingManagerId,
      salary: salary || { basic: 0, hra: 0, transport: 0, allowances: 0, deductions: 0 },
      bankDetails: bankDetails || {},
      phone: phone ? phone.trim() : '',
      gender,
      dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : undefined,
      maritalStatus: maritalStatus || 'single',
      marriageAnniversary: maritalStatus === 'married' ? marriageAnniversary : undefined,
      spouseDetails: maritalStatus === 'married' ? (spouseDetails || {}) : {},
      bloodGroup: bloodGroup || null,
      address: {
        street:     address?.street     || '',
        city:       address?.city       || '',
        state:      address?.state      || '',
        country:    address?.country    || 'India',
        postalCode: address?.postalCode || '',
      },
      emergencyContact: emergencyContact || {},
      panNumber:  panNumber  ? panNumber.toUpperCase().trim() : '',
      pfNumber:   pfNumber   ? pfNumber.trim()   : '',
      uanNumber:  uanNumber  ? uanNumber.trim()  : '',
      documents:      documents      || [],
      profilePicture: profilePicture || '',
      createdBy: req.user._id,
      isVerified: creatorRole === ACCESS_ROLES.SUPER_ADMIN,
      weekendType: weekendType || 'sunday',
      probationStartDate: probationStart,
      probationEndDate:   probationEnd,
      isProbationCompleted: false,
      leaveBalance: { casual: 0, sick: 0, earned: 0, unpaid: 0 },
    };

    const user = new User(userData);
    await user.save();

    // ── 9. Welcome email (non-blocking) ─────────────────────────
    try {
      if ([ACCESS_ROLES.HR_ADMIN, ACCESS_ROLES.SUPER_ADMIN].includes(creatorRole)) {
        await emailService.sendWelcomeEmail(user, password);
      }
    } catch (emailError) {
      console.error('Failed to send welcome email:', emailError);
    }

    // ── 10. Salary calculation ──────────────────────────────────
    try {
      if (typeof user.calculateNetSalary === 'function') {
        user.calculateNetSalary();
        await user.save();
      }
    } catch (salaryError) {
      console.error('Salary calculation error:', salaryError);
    }

    const token = generateToken(user._id, user.role, user.employeeId);

    const populatedUser = await User.findById(user._id)
      .populate('department', 'name')
      .populate('reportingManager', 'firstName lastName employeeId')
      .lean();

    res.status(201).json({
      success: true,
      message: `${assignedRole} account created successfully`,
      token,
      user: {
        id: user._id,
        employeeId: user.employeeId,
        fullName: user.fullName,
        email: user.email,
        role: user.role,                                    // access role
        department: populatedUser.department?.name,         // department
        designation: user.designation,                      // designation
        employmentType: user.employmentType,
        reportingManager: populatedUser.reportingManager
          ? `${populatedUser.reportingManager.firstName} ${populatedUser.reportingManager.lastName} (${populatedUser.reportingManager.employeeId})`
          : null,
        phone: user.phone,
        profilePicture: user.profilePicture,
        dateOfJoining: user.dateOfJoining,
        salary: user.salary?.netSalary || 0,
        isActive: user.isActive,
        weekendType: user.weekendType,
      },
    });
  } catch (error) {
    console.error('=== REGISTRATION ERROR ===', error);

    if (error.name === 'ValidationError') {
      const errors = {};
      Object.keys(error.errors).forEach((key) => {
        errors[key] = error.errors[key].message;
      });
      return res.status(400).json({ success: false, message: 'Validation failed', errors });
    }

    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Duplicate entry: Email or Employee ID already exists',
      });
    }

    res.status(500).json({
      success: false,
      message: 'Registration failed: ' + (error.message || 'Unknown server error'),
    });
  }
};

// ────────────────────────────────────────────────────────────────
// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
// ────────────────────────────────────────────────────────────────
exports.login = async (req, res) => {
  try {
    const { email, password, deviceId, fcmToken } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Please provide email and password' });
    }

    const user = await User.findOne({ email })
      .select('+password')
      .populate('department', 'name code')
      .populate('reportingManager', 'firstName lastName email');

    if (!user || !(await user.matchPassword(password))) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    if (!user.isActive) {
      return res.status(403).json({ success: false, message: 'Account is deactivated. Please contact HR.' });
    }

    if (!user.isVerified) {
      return res.status(403).json({
        success: false,
        message: 'Account is not verified. Please verify your account before logging in.',
      });
    }

    if (user.deviceId && user.deviceId !== deviceId) {
      return res.status(403).json({
        success: false,
        message: 'Login denied: You are already logged in on another device. Please contact HR or logout from that device first.',
      });
    }

    if (deviceId) user.deviceId = deviceId;
    if (fcmToken) user.fcmToken = fcmToken;
    user.lastLogin = new Date();
    user.lastLoginDevice = deviceId || null;
    await user.save({ validateBeforeSave: false });

    const token = generateToken(user._id, user.role, user.employeeId);

    res.status(200).json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        employeeId: user.employeeId,
        fullName: user.fullName,
        email: user.email,
        role: user.role,                            // access role
        department: user.department?.name,          // department
        designation: user.designation,              // designation
        phone: user.phone,
        profilePicture: user.profilePicture,
        isActive: user.isActive,
        isVerified: user.isVerified,
        deviceId: user.deviceId,
      },
    });
  } catch (error) {
    console.error('🔥 [Login Error]:', error);
    res.status(500).json({ success: false, message: 'Server error during login' });
  }
};

// ────────────────────────────────────────────────────────────────
// @desc    Get current user
// @route   GET /api/auth/me
// @access  Private
// ────────────────────────────────────────────────────────────────
exports.getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .populate('department', 'name code description')
      .populate('reportingManager', 'firstName lastName email profilePicture')
      .populate('createdBy', 'firstName lastName');

    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    res.status(200).json({ success: true, user });
  } catch (error) {
    console.error('Get me error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ────────────────────────────────────────────────────────────────
// @desc    Update profile
// @route   PUT /api/auth/profile
// @access  Private
// ────────────────────────────────────────────────────────────────
exports.updateProfile = async (req, res) => {
  try {
    const forbiddenFields = [
      'role',
      'isActive',
      'isVerified',
      'employeeId',
      'email',
      'createdBy',
      'department',
      'probationStartDate',
      'probationEndDate',
      'isProbationCompleted',
      'leaveBalance',
      'designation',
      'weekendType',
    ];

    const updates = { ...req.body };
    forbiddenFields.forEach((field) => delete updates[field]);

    if ('maritalStatus' in updates) {
      if (updates.maritalStatus === 'married') {
        if (!updates.marriageAnniversary) {
          return res.status(400).json({
            success: false,
            message: 'Marriage anniversary date is required for married status',
          });
        }
        updates.spouseDetails = updates.spouseDetails || {};
      } else {
        updates.marriageAnniversary = undefined;
        updates.spouseDetails = {};
      }
    }

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const oldData = user.toObject();
    Object.assign(user, updates);

    if (req.body.salary && typeof user.calculateNetSalary === 'function') {
      Object.assign(user.salary, req.body.salary);
      user.calculateNetSalary();
    }

    await user.save();

    const changedFields = {};
    Object.keys(updates).forEach((key) => {
      if (JSON.stringify(oldData[key]) !== JSON.stringify(updates[key])) {
        changedFields[key] = { before: oldData[key], after: updates[key] };
      }
    });

    if (Object.keys(changedFields).length > 0) {
      await ProfileLog.create({
        user: user._id,
        changedBy: req.user.id,
        changes: changedFields,
        updatedAt: new Date(),
      });
    }

    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      user: { ...user.toObject(), daysToAnniversary: user.daysToAnniversary },
    });
  } catch (error) {
    console.error('Update profile error:', error);
    if (error.name === 'ValidationError') {
      const errors = Object.values(error.errors).reduce((acc, err) => {
        acc[err.path] = err.message;
        return acc;
      }, {});
      return res.status(400).json({ success: false, message: 'Validation error', errors });
    }
    res.status(500).json({ success: false, message: 'Failed to update profile' });
  }
};

// ────────────────────────────────────────────────────────────────
// @desc    Update profile picture
// @route   PUT /api/auth/profile-picture
// @access  Private
// ────────────────────────────────────────────────────────────────
exports.updateProfilePicture = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
    if (!req.file.mimetype.startsWith('image/')) {
      return res.status(400).json({ success: false, message: 'Only image files are allowed' });
    }

    const result = await uploadToCloudinary(req.file.buffer, 'profile');
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    if (user.profilePicturePublicId) {
      await deleteFromCloudinary(user.profilePicturePublicId);
    }

    user.profilePicture = result.url;
    user.profilePicturePublicId = result.publicId;
    await user.save({ validateBeforeSave: false });

    res.status(200).json({
      success: true,
      message: 'Profile picture updated successfully',
      profilePicture: user.profilePicture,
    });
  } catch (error) {
    console.error('🔥 Update profile picture ERROR:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ────────────────────────────────────────────────────────────────
// @desc    Change password
// @route   PUT /api/auth/change-password
// @access  Private
// ────────────────────────────────────────────────────────────────
exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: 'Current and new password required' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ success: false, message: 'New password must be at least 8 characters' });
    }

    const user = await User.findById(req.user.id).select('+password');
    if (!(await user.matchPassword(currentPassword))) {
      return res.status(401).json({ success: false, message: 'Current password is incorrect' });
    }

    user.password = newPassword;
    await user.save();

    res.status(200).json({ success: true, message: 'Password changed successfully' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ────────────────────────────────────────────────────────────────
// @desc    Forgot password
// @route   POST /api/auth/forgot-password
// @access  Public
// ────────────────────────────────────────────────────────────────
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, message: 'Email required' });

    const user = await User.findOne({ email }).select('+resetPasswordToken +resetPasswordExpire');
    if (!user) return res.status(404).json({ success: false, message: 'No user found with that email' });

    const resetToken = user.getResetPasswordToken();
    await user.save({ validateBeforeSave: false });

    const resetUrl = `${frontendUrl}/reset-password/${resetToken}`;
    const html = generateForgotPasswordEmail(resetUrl);

    try {
      await emailService.sendEmail({ to: user.email, subject: 'HRMS Password Reset', html });
      res.status(200).json({ success: true, message: 'Password reset email sent' });
    } catch (err) {
      user.resetPasswordToken = undefined;
      user.resetPasswordExpire = undefined;
      await user.save({ validateBeforeSave: false });
      return res.status(500).json({ success: false, message: 'Email could not be sent' });
    }
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ────────────────────────────────────────────────────────────────
// @desc    Reset password
// @route   PUT /api/auth/reset-password/:token
// @access  Public
// ────────────────────────────────────────────────────────────────
exports.resetPassword = async (req, res) => {
  try {
    const user = await User.findOne({
      resetPasswordToken: req.params.token,
      resetPasswordExpire: { $gt: Date.now() },
    }).select('+password');

    if (!user) return res.status(400).json({ success: false, message: 'Invalid or expired reset token' });

    user.password = req.body.password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;
    await user.save();

    res.status(200).json({ success: true, message: 'Password reset successful' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ────────────────────────────────────────────────────────────────
// @desc    Reset device ID (HR Admin / Superadmin only)
// @route   PATCH /api/users/:userId/reset-device
// @access  Private
// ────────────────────────────────────────────────────────────────
exports.resetDevice = async (req, res) => {
  try {
    if (!ADMIN_ROLES.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    user.deviceId = null;
    await user.save({ validateBeforeSave: false });

    res.status(200).json({
      success: true,
      message: `Device reset for ${user.firstName} ${user.lastName} (${user.employeeId})`,
    });
  } catch (error) {
    console.error('Device reset error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ────────────────────────────────────────────────────────────────
// @desc    Get managers list (for reporting-manager dropdown)
// @route   GET /api/auth/managers
// @access  Private
// ────────────────────────────────────────────────────────────────
exports.getManagers = async (req, res) => {
  try {
    const managers = await User.find({
      role: {
        $in: [
          ACCESS_ROLES.SUPER_ADMIN,
          ACCESS_ROLES.HR_ADMIN,
          ACCESS_ROLES.MANAGER,
          ACCESS_ROLES.TEAM_LEAD,
        ],
      },
      isActive: true,
    })
      .select('employeeId firstName lastName email department designation role')
      .populate('department', 'name code')
      .sort({ firstName: 1 });

    res.status(200).json({ success: true, count: managers.length, data: managers });
  } catch (error) {
    console.error('Error fetching managers:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ────────────────────────────────────────────────────────────────
// @desc    Set user verification status (HR Admin / Superadmin only)
// @route   PATCH /api/auth/verify/:userId
// @access  Private
// ────────────────────────────────────────────────────────────────
exports.setVerification = async (req, res) => {
  try {
    if (!ADMIN_ROLES.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    const { isVerified } = req.body;
    if (typeof isVerified !== 'boolean') {
      return res.status(400).json({ success: false, message: 'isVerified (boolean) required' });
    }

    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    user.isVerified = isVerified;
    await user.save({ validateBeforeSave: false });

    res.status(200).json({
      success: true,
      message: `User ${user.fullName} is now ${isVerified ? 'verified' : 'unverified'}`,
      isVerified,
    });
  } catch (error) {
    console.error('Set verification error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ────────────────────────────────────────────────────────────────
// @desc    Assign or update reporting manager for a user
// @route   PATCH /api/auth/assign-manager/:userId
// @access  Private (HR Admin / Superadmin only)
// ────────────────────────────────────────────────────────────────
exports.assignManager = async (req, res) => {
  try {
    if (!ADMIN_ROLES.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized. Only HR Admin or Superadmin can assign managers.',
      });
    }

    const { userId } = req.params;
    const { reportingManager } = req.body;

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    if (user._id.toString() === req.user.id.toString()) {
      return res.status(400).json({ success: false, message: 'You cannot assign yourself as your own reporting manager' });
    }

    if (
      reportingManager === null ||
      reportingManager === undefined ||
      reportingManager === '' ||
      reportingManager === 'NA'
    ) {
      user.reportingManager = null;
      await user.save({ validateBeforeSave: false });
      return res.status(200).json({
        success: true,
        message: `Reporting manager removed for ${user.firstName} ${user.lastName}`,
        reportingManager: null,
      });
    }

    const trimmed = String(reportingManager).trim();
    const manager = mongoose.Types.ObjectId.isValid(trimmed)
      ? await User.findOne({
          _id: trimmed,
          isActive: true,
          role: {
            $in: [
              ACCESS_ROLES.SUPER_ADMIN,
              ACCESS_ROLES.HR_ADMIN,
              ACCESS_ROLES.MANAGER,
              ACCESS_ROLES.TEAM_LEAD,
            ],
          },
        })
      : await User.findOne({
          employeeId: trimmed.toUpperCase(),
          isActive: true,
          role: {
            $in: [
              ACCESS_ROLES.SUPER_ADMIN,
              ACCESS_ROLES.HR_ADMIN,
              ACCESS_ROLES.MANAGER,
              ACCESS_ROLES.TEAM_LEAD,
            ],
          },
        });

    if (!manager) {
      return res.status(404).json({
        success: false,
        message: 'Reporting manager not found or not eligible',
      });
    }

    if (manager._id.toString() === user._id.toString()) {
      return res.status(400).json({ success: false, message: 'A user cannot be their own reporting manager' });
    }

    if (manager.reportingManager && manager.reportingManager.toString() === user._id.toString()) {
      return res.status(400).json({ success: false, message: 'Circular reporting hierarchy detected' });
    }

    user.reportingManager = manager._id;
    await user.save({ validateBeforeSave: false });

    res.status(200).json({
      success: true,
      message: 'Reporting manager assigned successfully',
      reportingManager: {
        id: manager._id,
        employeeId: manager.employeeId,
        fullName: `${manager.firstName} ${manager.lastName}`,
        role: manager.role,
        designation: manager.designation,
      },
    });
  } catch (error) {
    console.error('Assign manager error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ────────────────────────────────────────────────────────────────
// @desc    Check if current user is verified
// @route   GET /api/auth/check-verification
// @access  Private
// ────────────────────────────────────────────────────────────────
exports.checkVerification = async (req, res) => {
  try {
    const incomingDeviceId = req.headers['device-id'] || req.body.deviceId;
    const userId = req.user.id;

    if (!incomingDeviceId) {
      return res.status(400).json({ success: false, message: 'Device ID is required for verification' });
    }

    const user = await User.findById(userId)
      .select('+isVerified +deviceId +lastLoginDevice +lastLogin +isActive +loginAttempts +accountStatus')
      .lean();

    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Account is deactivated. Please contact HR.',
        isVerified: false,
        reason: 'ACCOUNT_DEACTIVATED',
      });
    }

    if (!user.isVerified) {
      await User.findByIdAndUpdate(userId, {
        $inc: { loginAttempts: 1 },
        $set: { lastVerificationCheck: new Date() },
      });
      return res.status(403).json({
        success: false,
        message: 'Your account has been unverified by HR. Please contact HR.',
        isVerified: false,
        reason: 'UNVERIFIED_ACCOUNT',
      });
    }

    if (user.deviceId) {
      if (user.deviceId !== incomingDeviceId) {
        await User.findByIdAndUpdate(userId, {
          $inc: { loginAttempts: 1 },
          $push: {
            securityLogs: {
              type: 'DEVICE_MISMATCH',
              deviceId: incomingDeviceId,
              timestamp: new Date(),
              ip: req.ip,
            },
          },
        });

        if (user.loginAttempts >= 5) {
          await User.findByIdAndUpdate(userId, {
            $set: { isActive: false, accountStatus: 'LOCKED' },
          });
          return res.status(403).json({
            success: false,
            message: 'Account locked due to suspicious activity. Contact HR.',
            isVerified: false,
            reason: 'ACCOUNT_LOCKED',
          });
        }

        return res.status(401).json({
          success: false,
          message: 'Login detected from new device. Please login again.',
          isVerified: true,
          reason: 'DEVICE_MISMATCH',
        });
      }
    } else {
      await User.findByIdAndUpdate(userId, {
        $set: {
          deviceId: incomingDeviceId,
          lastLoginDevice: incomingDeviceId,
          lastLogin: new Date(),
          loginAttempts: 0,
        },
        $push: {
          deviceHistory: {
            deviceId: incomingDeviceId,
            firstLogin: new Date(),
            ip: req.ip,
          },
        },
      });
    }

    await User.findByIdAndUpdate(userId, {
      $set: { lastActivity: new Date() },
      $inc: { loginAttempts: -1 },
    });

    return res.status(200).json({
      success: true,
      message: 'User verified successfully',
      isVerified: true,
      user: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,               // access role
        department: user.department,   // department ref
        designation: user.designation, // designation
        profilePicture: user.profilePicture,
      },
      deviceMatched: true,
      lastLogin: user.lastLogin,
    });
  } catch (error) {
    console.error('💥 [VERIFY] Fatal error during verification:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error during verification',
      isVerified: false,
    });
  }
};