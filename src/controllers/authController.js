// controllers/authController.js
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Department = require('../models/Department');
const mongoose = require('mongoose');
const cloudinary = require('../config/cloudinary');
const fs = require('fs');
const emailService = require('../utils/emailService');
const { generateForgotPasswordEmail } = require('../email/forgotPasswordEmail');
const { uploadToCloudinary, deleteFromCloudinary } = require('../middleware/upload');
const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5000';

// Generate JWT Token
const generateToken = (id, role, employeeId) => {
  return jwt.sign(
    { id, role, employeeId },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRE || '30d' }
  );
};

// @desc    Register new user
// @route   POST /api/auth/register
// @access  Private (HR, Superadmin, Manager)
exports.register = async (req, res) => {
  try {
    const {
      employeeId, email, password, firstName, lastName, role,
      department, designation, dateOfJoining, employmentType,
      reportingManager, salary, bankDetails, phone, gender,
      dateOfBirth, maritalStatus, marriageAnniversary,
      spouseDetails, bloodGroup, address, emergencyContact,
      panNumber, pfNumber, uanNumber, documents, profilePicture,
      weekendType
    } = req.body;

    // Required fields validation
    if (!employeeId || !email || !password || !firstName || !lastName || !department) {
      return res.status(400).json({
        success: false,
        message: 'Employee ID, email, password, names, and department are required'
      });
    }

    // Role-based creation permissions
    const allowedRoles = {
      superadmin: ['hr', 'manager', 'employee'],
      hr: ['manager', 'employee'],
      manager: ['employee']
    };

    const userRole = req.user?.role;
    const assignedRole = role || 'employee';

    if (!userRole || !allowedRoles[userRole]?.includes(assignedRole)) {
      return res.status(403).json({
        success: false,
        message: `${userRole.charAt(0).toUpperCase() + userRole.slice(1)} can only create ${allowedRoles[userRole]?.join(', ') || 'no roles'} accounts`
      });
    }

    // Check for existing user
    const existingUser = await User.findOne({ $or: [{ email }, { employeeId }] });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: existingUser.email === email ? 'Email already registered' : 'Employee ID already exists'
      });
    }

    // Department handling
    let departmentId;
    let deptDoc = await Department.findOne({
      name: { $regex: new RegExp(`^${department.trim()}$`, 'i') }
    });

    if (!deptDoc) {
      const code = department
        .split(' ')
        .map(word => word[0])
        .join('')
        .toUpperCase()
        .substring(0, 4);

      deptDoc = await Department.create({
        name: department.trim(),
        code,
        head: req.user._id
      });
    }
    departmentId = deptDoc._id;

    // Reporting manager logic
    let reportingManagerId = null;
    if (assignedRole === 'employee' && reportingManager) {
      const trimmedManagerId = reportingManager.trim();

      if (trimmedManagerId !== 'NA' && trimmedManagerId !== '') {
        if (mongoose.Types.ObjectId.isValid(trimmedManagerId)) {
          const manager = await User.findOne({
            _id: trimmedManagerId,
            isActive: true,
            role: { $in: ['superadmin', 'hr', 'manager'] }
          });
          if (manager) reportingManagerId = trimmedManagerId;
        } else {
          const manager = await User.findOne({
            employeeId: trimmedManagerId,
            isActive: true,
            role: { $in: ['superadmin', 'hr', 'manager'] }
          });
          if (manager) reportingManagerId = manager._id;
        }
      }
    }

    // Probation setup
    const probationStart = dateOfJoining ? new Date(dateOfJoining) : new Date();
    const probationEnd = new Date(probationStart);
    probationEnd.setMonth(probationEnd.getMonth() + 6);

    // Prepare user data
    const userData = {
      employeeId: employeeId.trim().toUpperCase(),
      email: email.toLowerCase().trim(),
      password,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      role: assignedRole,
      department: departmentId,
      designation: designation ? designation.trim() : '',
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
        street: address?.street || '',
        city: address?.city || '',
        state: address?.state || '',
        country: address?.country || 'India',
        postalCode: address?.postalCode || ''
      },
      emergencyContact: emergencyContact || {},
      panNumber: panNumber ? panNumber.toUpperCase().trim() : '',
      pfNumber: pfNumber ? pfNumber.trim() : '',
      uanNumber: uanNumber ? uanNumber.trim() : '',
      documents: documents || [],
      profilePicture: profilePicture || '',
      createdBy: req.user._id,
      isVerified: userRole === 'superadmin',
      weekendType: weekendType || 'sunday',
      probationStartDate: probationStart,
      probationEndDate: probationEnd,
      isProbationCompleted: false,
      leaveBalance: {
        casual: 0,
        sick: 0,
        earned: 0,
        unpaid: 0
      }
    };

    const user = new User(userData);
    await user.save();

    // Send welcome email (non-blocking)
    try {
      if (['hr', 'superadmin'].includes(userRole)) {
        await emailService.sendWelcomeEmail(user, password);
      }
    } catch (emailError) {
      console.error('Failed to send welcome email:', emailError);
    }

    // Calculate net salary if applicable
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
      message: `${assignedRole.charAt(0).toUpperCase() + assignedRole.slice(1)} account created successfully`,
      token,
      user: {
        id: user._id,
        employeeId: user.employeeId,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        department: populatedUser.department?.name,
        designation: user.designation,
        employmentType: user.employmentType,
        reportingManager: populatedUser.reportingManager ?
          `${populatedUser.reportingManager.firstName} ${populatedUser.reportingManager.lastName} (${populatedUser.reportingManager.employeeId})` :
          null,
        phone: user.phone,
        profilePicture: user.profilePicture,
        dateOfJoining: user.dateOfJoining,
        salary: user.salary?.netSalary || 0,
        isActive: user.isActive,
        weekendType: user.weekendType
      }
    });
  } catch (error) {
    console.error('=== REGISTRATION ERROR ===', error);

    if (error.name === 'ValidationError') {
      const errors = {};
      Object.keys(error.errors).forEach(key => {
        errors[key] = error.errors[key].message;
      });
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors
      });
    }

    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Duplicate entry: Email or Employee ID already exists'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Registration failed: ' + (error.message || 'Unknown server error')
    });
  }
};

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
exports.login = async (req, res) => {
  try {
    const { email, password, deviceId, fcmToken } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email and password'
      });
    }

    const user = await User.findOne({ email })
      .select('+password')
      .populate('department', 'name code')
      .populate('reportingManager', 'firstName lastName email');

    if (!user || !(await user.matchPassword(password))) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Account is deactivated. Please contact HR.'
      });
    }

    if (!user.isVerified) {
      return res.status(403).json({
        success: false,
        message: 'Account is not verified. Please verify your account before logging in.'
      });
    }

    // Device restriction
    if (user.deviceId && user.deviceId !== deviceId) {
      return res.status(403).json({
        success: false,
        message: 'Login denied: You are already logged in on another device. Please contact HR or logout from that device first.'
      });
    }

    // Update device & login info
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
        role: user.role,
        department: user.department?.name,
        designation: user.designation,
        phone: user.phone,
        profilePicture: user.profilePicture,
        isActive: user.isActive,
        isVerified: user.isVerified,
        deviceId: user.deviceId,
      },
    });
  } catch (error) {
    console.error("🔥 [Login Error]:", error);
    res.status(500).json({ success: false, message: 'Server error during login' });
  }
};

// @desc    Get current user
// @route   GET /api/auth/me
// @access  Private
exports.getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .populate('department', 'name code description')
      .populate('reportingManager', 'firstName lastName email profilePicture')
      .populate('createdBy', 'firstName lastName');

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.status(200).json({ success: true, user });
  } catch (error) {
    console.error('Get me error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Update profile
// @route   PUT /api/auth/profile
// @access  Private
exports.updateProfile = async (req, res) => {
  try {
    // Fields users cannot update directly
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

    // Remove forbidden fields
    forbiddenFields.forEach((field) => delete updates[field]);

    // Handle marital status logic
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

    // Find user and store old data for logging
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const oldData = user.toObject();

    // Update user
    Object.assign(user, updates);

    // Recalculate net salary if salary updated
    if (req.body.salary && typeof user.calculateNetSalary === 'function') {
      Object.assign(user.salary, req.body.salary);
      user.calculateNetSalary();
    }

    await user.save();

    // Log changes
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
      user: {
        ...user.toObject(),
        daysToAnniversary: user.daysToAnniversary,
      },
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


// @desc    Update profile picture
// @route   PUT /api/auth/profile-picture
// @access  Private
exports.updateProfilePicture = async (req, res) => {
  try {

    // 1️⃣ File validation
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    if (!req.file.mimetype.startsWith('image/')) {
      return res.status(400).json({
        success: false,
        message: 'Only image files are allowed'
      });
    }

    const result = await uploadToCloudinary(req.file.buffer, 'profile');
    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // 4️⃣ Delete old image (if exists)
    if (user.profilePicturePublicId) {

      const deleteRes = await deleteFromCloudinary(
        user.profilePicturePublicId
      );

    } else {
      console.log('ℹ️ No old profile picture to delete');
    }

    // 5️⃣ Save new image
    user.profilePicture = result.url;
    user.profilePicturePublicId = result.publicId;

    await user.save({ validateBeforeSave: false });

    res.status(200).json({
      success: true,
      message: 'Profile picture updated successfully',
      profilePicture: user.profilePicture
    });
  } catch (error) {
    console.error('🔥 Update profile picture ERROR:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};


// @desc    Change password
// @route   PUT /api/auth/change-password
// @access  Private
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

// @desc    Forgot password
// @route   POST /api/auth/forgot-password
// @access  Public
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
      await emailService.sendEmail({
        to: user.email,
        subject: 'HRMS Password Reset',
        html
      });
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

// @desc    Reset password
// @route   PUT /api/auth/reset-password/:token
// @access  Public
exports.resetPassword = async (req, res) => {
  try {
    const user = await User.findOne({
      resetPasswordToken: req.params.token,
      resetPasswordExpire: { $gt: Date.now() }
    }).select('+password');

    if (!user) {
      return res.status(400).json({ success: false, message: 'Invalid or expired reset token' });
    }

    user.password = req.body.password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;
    await user.save();

    res.status(200).json({ success: true, message: 'Password reset successful' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Reset device ID (HR/Superadmin only)
// @route   PATCH /api/users/:userId/reset-device
// @access  Private (HR, Superadmin)
exports.resetDevice = async (req, res) => {
  try {
    if (!['hr', 'superadmin'].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    user.deviceId = null;
    await user.save({ validateBeforeSave: false });

    res.status(200).json({
      success: true,
      message: `Device reset for ${user.firstName} ${user.lastName} (${user.employeeId})`
    });
  } catch (error) {
    console.error('Device reset error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Get managers list
// @route   GET /api/users/managers
// @access  Private
exports.getManagers = async (req, res) => {
  try {
    const managers = await User.find({ role: 'manager', isActive: true })
      .select('employeeId firstName lastName email department designation')
      .populate('department', 'name code')
      .sort({ firstName: 1 });

    res.status(200).json({
      success: true,
      count: managers.length,
      data: managers
    });
  } catch (error) {
    console.error('Error fetching managers:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Set user verification status (HR/Superadmin only)
// @route   PATCH /api/users/:userId/verification
// @access  Private
exports.setVerification = async (req, res) => {
  try {
    if (!['hr', 'superadmin'].includes(req.user.role)) {
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
      isVerified
    });
  } catch (error) {
    console.error('Set verification error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Check if current user is verified
// @route   GET /api/auth/verify-status
// @access  Private
exports.checkVerification = async (req, res) => {
  try {
   
    const incomingDeviceId = req.headers['device-id'] || req.body.deviceId;
    const userId = req.user.id;

    // Validation
    if (!incomingDeviceId) {
      console.warn('⚠️ [VERIFY] Missing device ID');

      return res.status(400).json({
        success: false,
        message: 'Device ID is required for verification'
      });
    }

    // Find user
    const user = await User.findById(userId)
      .select('+isVerified +deviceId +lastLoginDevice +lastLogin +isActive +loginAttempts +accountStatus')
      .lean();

    if (!user) {
      console.error('❌ [VERIFY] User not found:', userId);

      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Account deactivated
    if (!user.isActive) {
      
      return res.status(403).json({
        success: false,
        message: 'Account is deactivated. Please contact HR.',
        isVerified: false,
        reason: 'ACCOUNT_DEACTIVATED'
      });
    }

    // Account unverified
    if (!user.isVerified) {
      
      await User.findByIdAndUpdate(userId, {
        $inc: { loginAttempts: 1 },
        $set: { lastVerificationCheck: new Date() }
      });

      return res.status(403).json({
        success: false,
        message: 'Your account has been unverified by HR. Please contact HR.',
        isVerified: false,
        reason: 'UNVERIFIED_ACCOUNT'
      });
    }

    // Device verification
    if (user.deviceId) {
      if (user.deviceId !== incomingDeviceId) {
        console.warn('📱 [VERIFY] Device mismatch detected', {
          userId,
          stored: user.deviceId,
          incoming: incomingDeviceId
        });

        await User.findByIdAndUpdate(userId, {
          $inc: { loginAttempts: 1 },
          $push: {
            securityLogs: {
              type: 'DEVICE_MISMATCH',
              deviceId: incomingDeviceId,
              timestamp: new Date(),
              ip: req.ip
            }
          }
        });

        if (user.loginAttempts >= 5) {
          console.error('🔒 [VERIFY] Account locked due to repeated mismatches:', userId);

          await User.findByIdAndUpdate(userId, {
            $set: { isActive: false, accountStatus: 'LOCKED' }
          });

          return res.status(403).json({
            success: false,
            message: 'Account locked due to suspicious activity. Contact HR.',
            isVerified: false,
            reason: 'ACCOUNT_LOCKED'
          });
        }

        return res.status(401).json({
          success: false,
          message: 'Login detected from new device. Please login again.',
          isVerified: true,
          reason: 'DEVICE_MISMATCH'
        });
      }
    } else {

      await User.findByIdAndUpdate(userId, {
        $set: {
          deviceId: incomingDeviceId,
          lastLoginDevice: incomingDeviceId,
          lastLogin: new Date(),
          loginAttempts: 0
        },
        $push: {
          deviceHistory: {
            deviceId: incomingDeviceId,
            firstLogin: new Date(),
            ip: req.ip
          }
        }
      });
    }

    // Update last activity
    await User.findByIdAndUpdate(userId, {
      $set: { lastActivity: new Date() },
      $inc: { loginAttempts: -1 }
    });

    return res.status(200).json({
      success: true,
      message: 'User verified successfully',
      isVerified: true,
      user: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        profilePicture: user.profilePicture,
        department: user.department,
        designation: user.designation
      },
      deviceMatched: true,
      lastLogin: user.lastLogin
    });

  } catch (error) {
    console.error('💥 [VERIFY] Fatal error during verification:', error);

    return res.status(500).json({
      success: false,
      message: 'Internal server error during verification',
      isVerified: false
    });
  }
};


