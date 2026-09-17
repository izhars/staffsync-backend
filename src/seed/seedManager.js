// src/seed/seedManager.js
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const User = require('../models/User');
const Department = require('../models/Department');
const { ACCESS_ROLES } = require('../constants/roles');

// ────────────────────────────────────────────────────────────────
// Manager seed data — Rinku Khan
// Department : Information Technology
// Designation: Backend Developer
// - 'manager' is NOT an ADMIN_ROLE, so personal/salary/bank info
//   is preserved and a probation window is auto-applied.
// - Top-level department head: NO reporting manager.
// ────────────────────────────────────────────────────────────────
const MANAGER_DATA = {
  employeeId: 'SCAIPLH005',
  firstName: 'Rinku',
  lastName: 'Khan',
  email: 'rinku.khan@staffsync.com',
  password: 'Manager@123',

  role: ACCESS_ROLES.MANAGER,       // 'manager'
  designation: 'Backend Developer', // ← updated

  phone: '9876501234',
  gender: 'female',
  dateOfBirth: new Date('1990-03-18'),
  dateOfJoining: new Date('2022-04-01'),
  maritalStatus: 'single',
  bloodGroup: 'B+',

  address: {
    street: '45 Sector 18',
    city: 'Noida',
    state: 'Uttar Pradesh',
    country: 'India',
    postalCode: '201301',
  },

  emergencyContact: {
    name: 'Faisal Khan',
    relationship: 'Brother',
    phone: '9876505678',
  },

  salary: {
    basic: 75000,
    hra: 30000,
    transport: 8000,
    allowances: 12000,
    deductions: 9500,
    netSalary: 0,     // computed below
  },

  bankDetails: {
    accountNumber: '50100234567890',
    bankName: 'HDFC Bank',
    ifscCode: 'HDFC0001234',
    accountHolderName: 'Rinku Khan',
  },

  panNumber: 'ABCDE1234F',
  pfNumber: 'UP765432109',
  uanNumber: '101234567890',

  employmentType: 'full-time',
  weekendType: 'saturday_sunday',
  isActive: true,
  isVerified: true,

  leaveBalance: {
    casual: 12,
    sick: 10,
    earned: 15,
    combo: 0,
    unpaid: 0,
  },

  // ── Top-level manager: no one above them ──
  reportingManager: null,
};

// ── Updated department ──
const DEPT_NAME = 'Information Technology';

// ────────────────────────────────────────────────────────────────
// Helper: find or create a department by name.
// ────────────────────────────────────────────────────────────────
async function ensureDepartment(name) {
  const trimmed = name.trim().toUpperCase();
  let dept = await Department.findOne({
    name: { $regex: new RegExp(`^${trimmed}$`, 'i') },
  });

  if (!dept) {
    // "Information Technology" → "IT"
    // Take first letter of each word, but cap at 4 chars.
    const code = trimmed
      .split(/\s+/)
      .map((w) => w[0])
      .join('')
      .toUpperCase()
      .substring(0, 4);

    dept = await Department.create({ name: trimmed, code, isActive: true });
    console.log(`🏢 Department created: ${dept.name} (${dept.code})`);
  } else {
    console.log(`🏢 Department found: ${dept.name} (${dept.code})`);
  }
  return dept;
}

async function seedManager() {
  try {
    const mongoURI = process.env.MONGODB_URI;
    if (!mongoURI) {
      console.error('❌ MONGODB_URI is not defined in .env');
      process.exit(1);
    }

    console.log(`🔌 Connecting to MongoDB: ${mongoURI.replace(/\/\/.*@/, '//***@')}`);
    await mongoose.connect(mongoURI);
    console.log('✅ Connected to MongoDB\n');

    // ── 1. Guard: already exists? ────────────────────────────────
    const existing = await User.findOne({
      $or: [
        { email: MANAGER_DATA.email },
        { employeeId: MANAGER_DATA.employeeId },
      ],
    }).populate('department', 'name code');

    if (existing) {
      console.log('⚠️  Manager already exists:');
      console.log(`   📋 Employee ID : ${existing.employeeId}`);
      console.log(`   👤 Name        : ${existing.firstName} ${existing.lastName}`);
      console.log(`   📧 Email       : ${existing.email}`);
      console.log(`   🎭 Role        : ${existing.role}`);
      console.log(`   🏢 Department  : ${existing.department?.name || 'N/A'}`);
      console.log('\n💡 To re-seed, delete this user first (see resetSeeds.js).');
      await mongoose.disconnect();
      process.exit(0);
    }

    // ── 2. Ensure department ─────────────────────────────────────
    const dept = await ensureDepartment(DEPT_NAME);

    // ── 3. Create manager (no reporting manager) ─────────────────
    const probationStart = MANAGER_DATA.dateOfJoining;
    const probationEnd = new Date(probationStart);
    probationEnd.setMonth(probationEnd.getMonth() + 6);

    const managerUser = await User.create({
      ...MANAGER_DATA,
      department: dept._id,
      reportingManager: null,
      probationStartDate: probationStart,
      probationEndDate: probationEnd,
      isProbationCompleted: new Date() > probationEnd,
    });

    // ── 4. Compute net salary ────────────────────────────────────
    if (typeof managerUser.calculateNetSalary === 'function') {
      managerUser.calculateNetSalary();
      await managerUser.save({ validateBeforeSave: false });
    }

    // ── 5. Set department head if unset ──────────────────────────
    // A manager is a natural department head. Only set if empty.
    if (!dept.head) {
      dept.head = managerUser._id;
      console.log(`👔 Set ${managerUser.employeeId} as head of ${dept.name}`);
    }

    // ── 6. Update department counters ────────────────────────────
    const employeeCount = await User.countDocuments({
      department: dept._id,
      isActive: true,
    });
    dept.employeeCount = employeeCount;
    await dept.save();
    console.log(`📊 ${dept.name} now has ${employeeCount} active member(s)`);

    // ── 7. Report ────────────────────────────────────────────────
    console.log('\n✅ Manager user created successfully!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`📋 Employee ID     : ${managerUser.employeeId}`);
    console.log(`👤 Name            : ${managerUser.firstName} ${managerUser.lastName}`);
    console.log(`📧 Email           : ${managerUser.email}`);
    console.log(`🔑 Password        : ${MANAGER_DATA.password}`);
    console.log(`🎭 Role            : ${managerUser.role}`);
    console.log(`🏢 Department      : ${dept.name}`);
    console.log(`💼 Designation     : ${managerUser.designation}`);
    console.log(`💰 Net Salary      : ₹${managerUser.salary.netSalary}`);
    console.log(`👔 Reporting Mgr   : — (top-level manager)`);
    console.log(`🗓️  Probation ends  : ${probationEnd.toDateString()}`);
    console.log(`🎓 Probation done  : ${managerUser.isProbationCompleted ? 'Yes' : 'No'}`);
    console.log(`🆔 User ID         : ${managerUser._id}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🎉 Manager seeding completed successfully!');

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding Manager:', error.message);
    if (error.code === 11000) {
      console.error('⚠️  Duplicate key error — user may already exist.');
    }
    if (error.name === 'ValidationError') {
      console.error('   Validation details:');
      Object.values(error.errors).forEach((e) =>
        console.error(`     - ${e.path}: ${e.message}`)
      );
    }
    console.error(error.stack);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  }
}

seedManager();