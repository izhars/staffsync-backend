// models/User.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { ACCESS_ROLES, ADMIN_ROLES } = require('../constants/roles');

// ────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────
const PROBATION_MONTHS = 6;

const FULL_LEAVE_QUOTA = {
  casual: 12,
  sick: 10,
  earned: 15,
  combo: 0,
  unpaid: 0,
};

const ZERO_LEAVE_QUOTA = {
  casual: 0,
  sick: 0,
  earned: 0,
  combo: 0,
  unpaid: 0,
};

// ────────────────────────────────────────────────────────────────
// Schema
// ────────────────────────────────────────────────────────────────
const userSchema = new mongoose.Schema(
  {
    employeeId: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      match: [/^[A-Z]+[0-9]+$/, 'Employee ID format: Letters followed by numbers, e.g., SCAIPLE001'],
    },
    firstName: { type: String, required: [true, 'First name is required'], trim: true },
    lastName: { type: String, required: [true, 'Last name is required'], trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email address'],
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: 8,
      select: false,
    },
    deviceId: { type: String, default: null },
    lastLoginDevice: { type: String, default: null },
    lastSeen: { type: Date, default: null },
    lastLogin: { type: Date },
    fcmToken: { type: String, default: null },

    lastActive: { type: Date, default: Date.now },

    // ── NEW: single active session enforcement ──────────────────
    currentSessionId: { type: String, default: null, index: true },
    currentSessionDeviceId: { type: String, default: null },
    sessionStartedAt: { type: Date, default: null },
    lastLoginIp: { type: String, default: null },
    lastLoginUserAgent: { type: String, default: null },

    role: {
      type: String,
      enum: Object.values(ACCESS_ROLES),
      default: ACCESS_ROLES.EMPLOYEE,
      required: true,
      index: true,
    },
    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Department',
      required: true,
    },
    designation: {
      type: String,
      required: [true, 'Designation is required'],
      trim: true,
      maxlength: 100,
    },
    reportingManager: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    team: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Team',
      default: null,
      index: true,
    },

    dateOfJoining: {
      type: Date,
      required: true,
    },
    employmentType: {
      type: String,
      enum: ['full-time', 'part-time', 'contract', 'intern'],
      default: 'full-time',
      required: function () {
        return !ADMIN_ROLES.includes(this.role);
      },
    },
    weekendType: {
      type: String,
      enum: ['sunday', 'saturday_sunday'],
      default: 'sunday',
      required: function () {
        return !ADMIN_ROLES.includes(this.role);
      },
    },
    status: {
      type: String,
      enum: ['active', 'resigned', 'on-leave', 'terminated'],
      default: 'active',
    },
    workLocation: String,
    shiftTiming: String,

    // ── Probation ──────────────────────────────────────────────
    probationStartDate: { type: Date },
    probationEndDate: { type: Date },
    isProbationCompleted: { type: Boolean, default: false, index: true },

    dateOfLeaving: Date,
    phone: {
      type: String,
      match: [/^\d{10}$/, 'Please enter a valid 10-digit phone number'],
      required: function () { return !ADMIN_ROLES.includes(this.role); },
    },
    gender: { type: String, enum: ['male', 'female', 'other'] },
    dateOfBirth: {
      type: Date,
      validate: {
        validator: (v) => !v || v < new Date(),
        message: 'Date of birth must be in the past',
      },
      required: function () { return !ADMIN_ROLES.includes(this.role); },
    },
    maritalStatus: {
      type: String,
      enum: ['single', 'married', 'divorced', 'widowed', 'separated'],
      default: 'single',
      required: function () { return !ADMIN_ROLES.includes(this.role); },
    },
    marriageAnniversary: {
      type: Date,
      validate: {
        validator: function (v) {
          return this.maritalStatus !== 'married' || !v || v < new Date();
        },
        message: 'Marriage anniversary must be in the past',
      },
    },
    spouseDetails: {
      name: String,
      dateOfBirth: Date,
      occupation: String,
      phone: String,
      email: String,
      isWorking: { type: Boolean, default: false },
      companyName: String,
      annualIncome: Number,
    },
    bloodGroup: {
      type: String,
      enum: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'],
    },
    alternatePhone: String,
    address: {
      street: String,
      city: String,
      state: String,
      country: { type: String, default: 'India' },
      postalCode: String,
    },

    salary: {
      basic: { type: Number, default: 0, min: 0 },
      hra: { type: Number, default: 0, min: 0 },
      transport: { type: Number, default: 0, min: 0 },
      allowances: { type: Number, default: 0, min: 0 },
      deductions: { type: Number, default: 0, min: 0 },
      netSalary: { type: Number, default: 0, min: 0 },
      currency: { type: String, default: 'INR' },
      payFrequency: { type: String, enum: ['monthly', 'bi-weekly'], default: 'monthly' },
    },
    bankDetails: {
      accountNumber: String,
      bankName: String,
      ifscCode: String,
      accountHolderName: String,
    },
    pfNumber: String,
    uanNumber: String,
    panNumber: {
      type: String,
      uppercase: true,
      match: [/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/, 'Invalid PAN format'],
    },

    // ── Leave Balance ─────────────────────────────────────────
    // Defaults are ZERO. Full quota is credited automatically
    // when probation completes (see hooks below).
    leaveBalance: {
      casual: { type: Number, default: 0, min: 0 },
      sick: { type: Number, default: 0, min: 0 },
      earned: { type: Number, default: 0, min: 0 },
      combo: { type: Number, default: 0, min: 0 },
      unpaid: { type: Number, default: 0, min: 0 },
    },
    // Audit trail of when leave was credited
    leaveCreditedAt: { type: Date, default: null },
    leaveCreditType: {
      type: String,
      enum: ['none', 'probation-completion', 'annual-reset', 'manual-adjustment'],
      default: 'none',
    },
    leaveHistory: [{
      action: { type: String, enum: ['credit', 'debit', 'adjustment', 'reset'] },
      leaveType: { type: String, enum: ['casual', 'sick', 'earned', 'combo', 'unpaid', 'all'] },
      amount: Number,
      balanceAfter: mongoose.Schema.Types.Mixed,
      reason: String,
      performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      performedAt: { type: Date, default: Date.now },
      _id: false,
    }],

    emergencyContact: {
      name: String,
      relationship: String,
      phone: String,
    },
    documents: [{
      type: { type: String, enum: ['aadhar', 'pan', 'passport', 'resume', 'offer-letter', 'experience', 'photo-id', 'bank-proof', 'marriage-certificate'] },
      fileName: String,
      fileUrl: String,
      fileSize: Number,
      mimeType: String,
      uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      verified: { type: Boolean, default: false },
      expiryDate: Date,
      uploadedAt: { type: Date, default: Date.now },
    }],
    profilePicture: { type: String, default: '' },
    profilePicturePublicId: { type: String, default: null },

    chatSettings: {
      soundEnabled: { type: Boolean, default: true },
      notificationEnabled: { type: Boolean, default: true },
      theme: { type: String, default: 'light', enum: ['light', 'dark'] },
      messagePreview: { type: Boolean, default: true },
    },

    socketIds: [{
      socketId: String,
      connectedAt: { type: Date, default: Date.now },
      userAgent: String,
      platform: String,
      _id: false,
    }],

    notificationSettings: {
      enabled: { type: Boolean, default: true },
      employeeInteractions: { type: Boolean, default: true },
      messages: { type: Boolean, default: true },
      calls: { type: Boolean, default: true },
      scheduleUpdates: { type: Boolean, default: true },
      messageSound: { type: Boolean, default: true },
      messageVibrate: { type: Boolean, default: true },
      groupSound: { type: Boolean, default: true },
      mentionsOnly: { type: Boolean, default: false },
      doNotDisturb: {
        enabled: { type: Boolean, default: false },
        startTime: { type: String },
        endTime: { type: String },
      },
    },

    isActive: { type: Boolean, default: true },
    isVerified: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    resetPasswordToken: String,
    resetPasswordExpire: Date,

    isAvailable: {
      type: Boolean,
      default: true,
      required: function () { return this.role === ACCESS_ROLES.HR_ADMIN; },
    },
    availabilityStatus: {
      type: String,
      default: 'Available',
      trim: true,
      required: function () { return this.role === ACCESS_ROLES.HR_ADMIN; },
    },
    nextAvailableAt: { type: Date, default: null },
    availabilityLastChanged: { type: Date, default: Date.now },
    availabilityLogs: [{
      isAvailable: Boolean,
      status: String,
      changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      changedAt: { type: Date, default: Date.now },
      _id: false,
    }],

    faceData: {
      faceId: { type: String, unique: true, sparse: true },
      registered: { type: Boolean, default: false },
      registeredAt: Date,
      lastUpdated: Date,
      lastVerified: Date,
      verificationCount: { type: Number, default: 0 },
      images: [{
        imageId: String,
        base64: String,
        features: mongoose.Schema.Types.Mixed,
        confidence: Number,
        boundingBox: mongoose.Schema.Types.Mixed,
        createdAt: { type: Date, default: Date.now },
      }],
      features: mongoose.Schema.Types.Mixed,
      confidence: Number,
      boundingBox: mongoose.Schema.Types.Mixed,
      googleFaceId: String,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ────────────────────────────────────────────────────────────────
// Indexes
// ────────────────────────────────────────────────────────────────
userSchema.index({ department: 1 });
userSchema.index({ role: 1, isActive: 1 });
userSchema.index({ dateOfJoining: -1 });
userSchema.index({ maritalStatus: 1 });
userSchema.index({ marriageAnniversary: 1 });
userSchema.index({ probationEndDate: 1, isProbationCompleted: 1 });

// ────────────────────────────────────────────────────────────────
// Virtuals
// ────────────────────────────────────────────────────────────────
userSchema.virtual('fullName').get(function () {
  return `${this.firstName} ${this.lastName}`.trim();
});

userSchema.virtual('daysToAnniversary').get(function () {
  if (this.maritalStatus !== 'married' || !this.marriageAnniversary) return null;
  const today = new Date();
  const thisYearAnniv = new Date(
    today.getFullYear(),
    this.marriageAnniversary.getMonth(),
    this.marriageAnniversary.getDate()
  );
  if (thisYearAnniv < today) thisYearAnniv.setFullYear(today.getFullYear() + 1);
  return Math.ceil((thisYearAnniv - today) / (1000 * 60 * 60 * 24));
});

userSchema.virtual('isAdmin').get(function () {
  return ADMIN_ROLES.includes(this.role);
});

userSchema.virtual('canManageUsers').get(function () {
  return [
    ACCESS_ROLES.SUPER_ADMIN,
    ACCESS_ROLES.HR_ADMIN,
    ACCESS_ROLES.MANAGER,
  ].includes(this.role);
});

// Is the employee currently in probation?
userSchema.virtual('isOnProbation').get(function () {
  if (ADMIN_ROLES.includes(this.role)) return false;
  if (this.isProbationCompleted) return false;
  return this.probationEndDate ? new Date() < this.probationEndDate : true;
});

// Days remaining in probation
userSchema.virtual('probationDaysRemaining').get(function () {
  if (!this.isOnProbation || !this.probationEndDate) return 0;
  const diff = this.probationEndDate - new Date();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
});

// Total leave balance (excluding unpaid)
userSchema.virtual('totalPaidLeave').get(function () {
  const lb = this.leaveBalance || {};
  return (lb.casual || 0) + (lb.sick || 0) + (lb.earned || 0) + (lb.combo || 0);
});

// ────────────────────────────────────────────────────────────────
// Pre-save Hooks
// ────────────────────────────────────────────────────────────────

// 1. Hash password
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  if (
    this.password.startsWith('$2a$') ||
    this.password.startsWith('$2b$') ||
    this.password.startsWith('$2y$')
  ) return next();

  try {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (err) {
    next(err);
  }
});

// 2. Clear employee-specific fields for admin access roles
userSchema.pre('save', function (next) {
  if (ADMIN_ROLES.includes(this.role)) {
    this.phone = undefined;
    this.dateOfBirth = undefined;
    this.gender = undefined;
    this.maritalStatus = 'single';
    this.marriageAnniversary = undefined;
    this.spouseDetails = {};
    this.salary = { basic: 0, hra: 0, transport: 0, allowances: 0, deductions: 0, netSalary: 0 };
    this.bankDetails = {};
    this.panNumber = undefined;
    this.pfNumber = undefined;
    this.uanNumber = undefined;
    this.leaveBalance = { ...ZERO_LEAVE_QUOTA };
    this.employmentType = undefined;
    this.weekendType = undefined;
    this.reportingManager = null;
    this.probationStartDate = undefined;
    this.probationEndDate = undefined;
    this.isProbationCompleted = true;
  }
  next();
});

// 3. Auto-set probation period (only on first save)
userSchema.pre('save', function (next) {
  if (this.isNew && !ADMIN_ROLES.includes(this.role)) {
    this.probationStartDate = this.dateOfJoining || new Date();
    const end = new Date(this.probationStartDate);
    end.setMonth(end.getMonth() + PROBATION_MONTHS);
    this.probationEndDate = end;
    this.isProbationCompleted = false;
  }

  // Auto-complete if end date passed
  if (
    !ADMIN_ROLES.includes(this.role) &&
    this.probationEndDate &&
    !this.isProbationCompleted &&
    new Date() >= this.probationEndDate
  ) {
    this.isProbationCompleted = true;
  }

  next();
});

// 4. Marriage anniversary & spouse validation
userSchema.pre('save', function (next) {
  if (!ADMIN_ROLES.includes(this.role)) {
    if (this.maritalStatus === 'married') {
      if (!this.marriageAnniversary) {
        return next(new Error('Marriage anniversary date is required for married employees'));
      }
    } else {
      this.marriageAnniversary = undefined;
      this.spouseDetails = {};
    }
  }
  next();
});

// 5. Probation-aware leave balance enforcement
//    - During probation  → leave balance must stay ZERO
//    - On probation end  → credit FULL_LEAVE_QUOTA exactly once
userSchema.pre('save', function (next) {
  // Skip for admin roles — they don't accrue leave
  if (ADMIN_ROLES.includes(this.role)) return next();

  // Still in probation → force zero
  if (!this.isProbationCompleted) {
    this.leaveBalance = { ...ZERO_LEAVE_QUOTA };
    this.leaveCreditType = 'none';
    this.leaveCreditedAt = null;
    return next();
  }

  // Just completed probation (transition false → true)
  const justCompleted =
    this.isModified('isProbationCompleted') && this.isProbationCompleted === true;

  // Credit only if never credited before (idempotent)
  const neverCredited = !this.leaveCreditedAt;

  // Also handle: existing doc where all balances are zero (first post-probation save)
  const lb = this.leaveBalance || {};
  const allZero =
    !lb.casual && !lb.sick && !lb.earned && !lb.combo && !lb.unpaid;

  if ((justCompleted && neverCredited) || (neverCredited && allZero)) {
    this.leaveBalance = { ...FULL_LEAVE_QUOTA };
    this.leaveCreditedAt = new Date();
    this.leaveCreditType = 'probation-completion';

    // Push to history
    if (!Array.isArray(this.leaveHistory)) this.leaveHistory = [];
    this.leaveHistory.push({
      action: 'credit',
      leaveType: 'all',
      amount: FULL_LEAVE_QUOTA.casual + FULL_LEAVE_QUOTA.sick + FULL_LEAVE_QUOTA.earned,
      balanceAfter: { ...FULL_LEAVE_QUOTA },
      reason: `Probation completed after ${PROBATION_MONTHS} months — full annual leave quota credited`,
      performedAt: new Date(),
    });
  }

  next();
});

// ────────────────────────────────────────────────────────────────
// Instance Methods
// ────────────────────────────────────────────────────────────────
userSchema.methods.matchPassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.getSignedJwtToken = function () {
  return jwt.sign(
    { id: this._id, role: this.role, employeeId: this.employeeId },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRE || '30d' }
  );
};

userSchema.methods.calculateNetSalary = function () {
  if (ADMIN_ROLES.includes(this.role)) return 0;
  const { basic, hra, transport, allowances, deductions } = this.salary;
  this.salary.netSalary = Math.max(
    0,
    (basic + hra + transport + allowances) - deductions
  );
  return this.salary.netSalary;
};

userSchema.methods.getResetPasswordToken = function () {
  const resetToken =
    Math.random().toString(36).substring(2) +
    Math.random().toString(36).substring(2) +
    Date.now().toString(36);

  this.resetPasswordToken = resetToken;
  this.resetPasswordExpire = Date.now() + 30 * 60 * 1000; // 30 min
  return resetToken;
};

/**
 * Manually complete probation for this user and credit leave quota.
 * Useful for HR overrides or early completion.
 */
userSchema.methods.completeProbation = async function (performedBy = null) {
  if (this.isProbationCompleted) return this;

  this.isProbationCompleted = true;
  if (!this.probationEndDate) this.probationEndDate = new Date();

  // Credit full quota now
  this.leaveBalance = { ...FULL_LEAVE_QUOTA };
  this.leaveCreditedAt = new Date();
  this.leaveCreditType = 'probation-completion';

  if (!Array.isArray(this.leaveHistory)) this.leaveHistory = [];
  this.leaveHistory.push({
    action: 'credit',
    leaveType: 'all',
    amount: FULL_LEAVE_QUOTA.casual + FULL_LEAVE_QUOTA.sick + FULL_LEAVE_QUOTA.earned,
    balanceAfter: { ...FULL_LEAVE_QUOTA },
    reason: 'Probation completed (manual) — full annual leave quota credited',
    performedBy: performedBy,
    performedAt: new Date(),
  });

  return this.save();
};

/**
 * Apply a leave debit / adjustment and log it.
 */
userSchema.methods.adjustLeave = async function ({
  leaveType,
  amount,
  action = 'debit',
  reason = '',
  performedBy = null,
}) {
  if (!this.leaveBalance[leaveType] === undefined) {
    throw new Error(`Invalid leave type: ${leaveType}`);
  }

  const current = this.leaveBalance[leaveType] || 0;
  let next = current;

  if (action === 'debit') {
    next = Math.max(0, current - amount);
  } else if (action === 'credit' || action === 'adjustment') {
    next = Math.max(0, current + amount);
  } else if (action === 'reset') {
    next = amount;
  } else {
    throw new Error(`Invalid action: ${action}`);
  }

  this.leaveBalance[leaveType] = next;

  if (!Array.isArray(this.leaveHistory)) this.leaveHistory = [];
  this.leaveHistory.push({
    action,
    leaveType,
    amount,
    balanceAfter: { ...this.leaveBalance.toObject?.() ?? this.leaveBalance },
    reason,
    performedBy,
    performedAt: new Date(),
  });

  return this.save();
};

// ────────────────────────────────────────────────────────────────
// Static Methods
// ────────────────────────────────────────────────────────────────

/**
 * Find all users whose probation has expired and complete it.
 * Intended to be run by a daily cron job.
 *
 * Usage:
 *   const count = await User.completeExpiredProbations();
 */
userSchema.statics.completeExpiredProbations = async function () {
  const now = new Date();

  const users = await this.find({
    isProbationCompleted: false,
    probationEndDate: { $lte: now },
    role: { $nin: ADMIN_ROLES },
    isActive: true,
  }).select('+password'); // keep password for save() to work

  let completed = 0;
  for (const user of users) {
    try {
      user.isProbationCompleted = true;
      // Only credit if not already credited
      if (!user.leaveCreditedAt) {
        user.leaveBalance = { ...FULL_LEAVE_QUOTA };
        user.leaveCreditedAt = new Date();
        user.leaveCreditType = 'probation-completion';

        if (!Array.isArray(user.leaveHistory)) user.leaveHistory = [];
        user.leaveHistory.push({
          action: 'credit',
          leaveType: 'all',
          amount: FULL_LEAVE_QUOTA.casual + FULL_LEAVE_QUOTA.sick + FULL_LEAVE_QUOTA.earned,
          balanceAfter: { ...FULL_LEAVE_QUOTA },
          reason: `Auto-completed probation after ${PROBATION_MONTHS} months — full annual leave credited`,
          performedAt: new Date(),
        });
      }
      await user.save();
      completed++;
    } catch (err) {
      console.error(`Failed to complete probation for ${user.employeeId}:`, err.message);
    }
  }

  return completed;
};

/**
 * Get a summary of employees currently in probation.
 */
userSchema.statics.getActiveProbations = function () {
  return this.find({
    isProbationCompleted: false,
    role: { $nin: ADMIN_ROLES },
    isActive: true,
  })
    .select('firstName lastName employeeId designation department probationStartDate probationEndDate')
    .populate('department', 'name')
    .sort({ probationEndDate: 1 });
};

module.exports = mongoose.model('User', userSchema);