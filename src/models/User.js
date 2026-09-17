// models/User.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { ACCESS_ROLES, ADMIN_ROLES } = require('../constants/roles');

const userSchema = new mongoose.Schema(
  {
    // ────────────────────── Core Employee Info ──────────────────────
    employeeId: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      match: [/^[A-Z]+[0-9]+$/, 'Employee ID format: Letters followed by numbers, e.g., SCAIPLE001'],
    },
    firstName: { type: String, required: [true, 'First name is required'], trim: true },
    lastName:  { type: String, required: [true, 'Last name is required'],  trim: true },
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
    deviceId:       { type: String, default: null },
    lastLoginDevice:{ type: String, default: null },
    lastSeen:       { type: Date,   default: null },
    lastLogin:      { type: Date },

    // 🔔 Firebase Cloud Messaging
    fcmToken: { type: String, default: null },

    notificationSettings: {
      enabled:              { type: Boolean, default: true },
      employeeInteractions: { type: Boolean, default: true },
      messages:             { type: Boolean, default: true },
      calls:                { type: Boolean, default: true },
      scheduleUpdates:      { type: Boolean, default: true },
    },

    lastActive: { type: Date, default: Date.now },

    // ────────────────────── Role & Hierarchy ──────────────────────
    // ACCESS ROLE — what the user can do in the HRMS.
    // Department and Designation must NOT be encoded here.
    role: {
      type: String,
      enum: Object.values(ACCESS_ROLES),
      default: ACCESS_ROLES.EMPLOYEE,
      required: true,
      index: true,
    },

    // DEPARTMENT — where the employee works (ObjectId ref).
    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Department',
      required: true,
    },

    // DESIGNATION — the employee's actual job title (free text).
    // Examples: "HR Manager", "Accountant", "Software Engineer".
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

    // Optional team scoping (for future "manager manages only their team")
    team: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Team',
      default: null,
      index: true,
    },

    // ────────────────────── Employment Details ──────────────────────
    dateOfJoining: { type: Date, default: Date.now, required: true },
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
    shiftTiming:  String,

    // Probation
    probationStartDate:   { type: Date },
    probationEndDate:     { type: Date },
    isProbationCompleted: { type: Boolean, default: false },
    dateOfLeaving:        Date,

    // ────────────────────── Personal Details ──────────────────────
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
      name:         String,
      dateOfBirth:  Date,
      occupation:   String,
      phone:        String,
      email:        String,
      isWorking:    { type: Boolean, default: false },
      companyName:  String,
      annualIncome: Number,
    },
    bloodGroup: {
      type: String,
      enum: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'],
    },
    alternatePhone: String,

    address: {
      street:     String,
      city:       String,
      state:      String,
      country:    { type: String, default: 'India' },
      postalCode: String,
    },

    // ────────────────────── Salary & Bank ──────────────────────
    salary: {
      basic:       { type: Number, default: 0, min: 0 },
      hra:         { type: Number, default: 0, min: 0 },
      transport:   { type: Number, default: 0, min: 0 },
      allowances:  { type: Number, default: 0, min: 0 },
      deductions:  { type: Number, default: 0, min: 0 },
      netSalary:   { type: Number, default: 0, min: 0 },
      currency:    { type: String, default: 'INR' },
      payFrequency:{ type: String, enum: ['monthly', 'bi-weekly'], default: 'monthly' },
    },
    bankDetails: {
      accountNumber:     String,
      bankName:          String,
      ifscCode:          String,
      accountHolderName: String,
    },

    // ────────────────────── Government IDs ──────────────────────
    pfNumber:  String,
    uanNumber: String,
    panNumber: {
      type: String,
      uppercase: true,
      match: [/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/, 'Invalid PAN format'],
    },

    // ────────────────────── Leave Balance ──────────────────────
    leaveBalance: {
      casual: { type: Number, default: 12, min: 0 },
      sick:   { type: Number, default: 10, min: 0 },
      earned: { type: Number, default: 15, min: 0 },
      combo:  { type: Number, default: 0,  min: 0 },
      unpaid: { type: Number, default: 0,  min: 0 },
    },

    // ────────────────────── Emergency & Documents ──────────────────────
    emergencyContact: {
      name:         String,
      relationship: String,
      phone:        String,
    },
    documents: [{
      type:       { type: String, enum: ['aadhar', 'pan', 'passport', 'resume', 'offer-letter', 'experience', 'photo-id', 'bank-proof', 'marriage-certificate'] },
      fileName:   String,
      fileUrl:    String,
      fileSize:   Number,
      mimeType:   String,
      uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      verified:   { type: Boolean, default: false },
      expiryDate: Date,
      uploadedAt: { type: Date, default: Date.now },
    }],
    profilePicture:         { type: String, default: '' },
    profilePicturePublicId: { type: String, default: null },

    // ────────────────────── Chat & UI Settings ──────────────────────
    chatSettings: {
      soundEnabled:        { type: Boolean, default: true },
      notificationEnabled: { type: Boolean, default: true },
      theme:               { type: String, default: 'light', enum: ['light', 'dark'] },
      messagePreview:      { type: Boolean, default: true },
    },

    socketIds: [{
      socketId:    String,
      connectedAt: { type: Date, default: Date.now },
      userAgent:   String,
      platform:    String,
      _id: false,
    }],

    notificationSettings: {
      messageSound: { type: Boolean, default: true },
      messageVibrate: { type: Boolean, default: true },
      groupSound:   { type: Boolean, default: true },
      mentionsOnly: { type: Boolean, default: false },
      doNotDisturb: {
        enabled:   { type: Boolean, default: false },
        startTime: { type: String },
        endTime:   { type: String },
      },
    },

    // ────────────────────── System Fields ──────────────────────
    isActive:   { type: Boolean, default: true },
    isVerified: { type: Boolean, default: true },
    createdBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    resetPasswordToken:  String,
    resetPasswordExpire: Date,

    // HR "availability" fields — kept but only required when the user
    // has the HR Admin access role.
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
    nextAvailableAt:         { type: Date, default: null },
    availabilityLastChanged: { type: Date, default: Date.now },
    availabilityLogs: [{
      isAvailable: Boolean,
      status:      String,
      changedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      changedAt:   { type: Date, default: Date.now },
      _id: false,
    }],

    faceData: {
      faceId:            { type: String, unique: true, sparse: true },
      registered:        { type: Boolean, default: false },
      registeredAt:      Date,
      lastUpdated:       Date,
      lastVerified:      Date,
      verificationCount: { type: Number, default: 0 },
      images: [{
        imageId:     String,
        base64:      String,
        features:    mongoose.Schema.Types.Mixed,
        confidence:  Number,
        boundingBox: mongoose.Schema.Types.Mixed,
        createdAt:   { type: Date, default: Date.now },
      }],
      features:     mongoose.Schema.Types.Mixed,
      confidence:   Number,
      boundingBox:  mongoose.Schema.Types.Mixed,
      googleFaceId: String,
    },
  },
  {
    timestamps: true,
    toJSON:   { virtuals: true },
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

// Convenience flags used by controllers / frontend
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
    this.leaveBalance = { casual: 0, sick: 0, earned: 0, combo: 0, unpaid: 0 };
    this.employmentType = undefined;
    this.weekendType = undefined;
    this.reportingManager = null;
  }
  next();
});

// 3. Auto-set probation period (only on first save)
userSchema.pre('save', function (next) {
  if (this.isNew && !ADMIN_ROLES.includes(this.role)) {
    this.probationStartDate = this.dateOfJoining;
    const end = new Date(this.dateOfJoining);
    end.setMonth(end.getMonth() + 6);
    this.probationEndDate = end;
  }
  if (this.probationEndDate && new Date() > this.probationEndDate) {
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

module.exports = mongoose.model('User', userSchema);