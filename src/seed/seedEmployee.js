// src/seed/seedEmployee.js
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const User = require('../models/User');
const Department = require('../models/Department');
const { ACCESS_ROLES } = require('../constants/roles');

// ────────────────────────────────────────────────────────────────
// Employee seed data — Sharique Izhar
// Reports to: Rinku Khan (MGR001, manager)
// NOTE: 'employee' IS a valid ACCESS_ROLE, so personal/salary/bank
// fields are preserved by the User pre-save hook (only admin roles
// have them stripped). Password is hashed by the pre-save hook too.
// ────────────────────────────────────────────────────────────────
const EMPLOYEE_DATA = {
  employeeId: 'SCAIPLE003',
  firstName: 'Sharique',
  lastName: 'Izhar',
  email: 'sharique.izhar@staffsync.com',
  password: 'Scaipl@123',
  role: ACCESS_ROLES.EMPLOYEE,       // 'employee'
  designation: 'Android Developer',
  phone: '9123456790',
  gender: 'male',
  dateOfBirth: new Date('1997-08-22'),
  dateOfJoining: new Date('2024-03-01'),
  maritalStatus: 'single',
  bloodGroup: 'A+',
  address: {
    street: '18 Palm Grove',
    city: 'Bengaluru',
    state: 'Karnataka',
    country: 'India',
    postalCode: '560001',
  },
  salary: {
    basic: 45000,
    hra: 18000,
    transport: 5000,
    allowances: 8000,
    deductions: 4500,
    netSalary: 0,
  },
  bankDetails: {
    accountNumber: '987654321099',
    bankName: 'ICICI Bank',
    ifscCode: 'ICIC0002456',
    accountHolderName: 'Sharique Izhar',
  },
  panNumber: 'KLMNO4321P',
  pfNumber: 'KA987654321',
  uanNumber: '987654321011',
  employmentType: 'full-time',
  weekendType: 'saturday_sunday',
  isActive: true,
  isVerified: true,
  leaveBalance: {
    casual: 8,
    sick: 7,
    earned: 15,
    combo: 0,
    unpaid: 0,
  },
};

// Match the manager's department so the reporting chain is consistent.
const DEPT_NAME = 'Information Technology';

// Target reporting manager, identified by employeeId.
// This is the cleanest, most deterministic way to pin the relationship.
const REPORTING_MANAGER_EMPLOYEE_ID = 'MGR001';   // Rinku Khan

// ────────────────────────────────────────────────────────────────
// Helper: find or create a department by name.
// ────────────────────────────────────────────────────────────────
async function ensureDepartment(name) {
  const trimmed = name.trim().toUpperCase();
  let dept = await Department.findOne({
    name: { $regex: new RegExp(`^${trimmed}$`, 'i') },
  });

  if (!dept) {
    const code = trimmed.split(/\s+/).map((w) => w[0]).join('').toUpperCase().substring(0, 4);
    dept = await Department.create({ name: trimmed, code, isActive: true });
    console.log(`🏢 Department created: ${dept.name} (${dept.code})`);
  } else {
    console.log(`🏢 Department found: ${dept.name} (${dept.code})`);
  }
  return dept;
}

// ────────────────────────────────────────────────────────────────
// Helper: find the reporting manager.
// Primary:  explicit employeeId (REPORTING_MANAGER_EMPLOYEE_ID)
// Fallback: first active user with a manager-eligible role, in this
//           priority order — manager → team_lead → hr_admin → superadmin.
// ────────────────────────────────────────────────────────────────
async function findReportingManager(preferredEmployeeId) {
  // 1. Try the explicit pick first.
  if (preferredEmployeeId) {
    const pinned = await User.findOne({
      employeeId: preferredEmployeeId.toUpperCase(),
      isActive: true,
      role: {
        $in: [
          ACCESS_ROLES.MANAGER,
          ACCESS_ROLES.TEAM_LEAD,
          ACCESS_ROLES.HR_ADMIN,
          ACCESS_ROLES.SUPER_ADMIN,
        ],
      },
    }).select('employeeId firstName lastName role designation');

    if (pinned) return pinned;

    console.log(
      `⚠️  Pinned manager '${preferredEmployeeId}' not found or not eligible. ` +
      `Falling back to auto-pick.`
    );
    console.log(
      `💡 Run \`node src/seed/seedManager.js\` first to create Rinku Khan.`
    );
  }

  // 2. Fallback: pick the highest-priority active manager we can find.
  const priority = [
    ACCESS_ROLES.MANAGER,
    ACCESS_ROLES.TEAM_LEAD,
    ACCESS_ROLES.HR_ADMIN,
    ACCESS_ROLES.SUPER_ADMIN,
  ];

  const candidates = await User.find({
    role: { $in: priority },
    isActive: true,
  })
    .select('employeeId firstName lastName role designation');

  for (const role of priority) {
    const match = candidates.find((u) => u.role === role);
    if (match) return match;
  }

  return null;
}

async function seedEmployee() {
  try {
    const mongoURI = process.env.MONGODB_URI;
    if (!mongoURI) {
      console.error('❌ MONGODB_URI is not defined in .env');
      process.exit(1);
    }

    console.log(`🔌 Connecting to MongoDB: ${mongoURI.replace(/\/\/.*@/, '//***@')}`);
    await mongoose.connect(mongoURI);
    console.log('✅ Connected to MongoDB\n');

    // ── 1. Guard: employee already exists? ───────────────────────
    const existing = await User.findOne({
      $or: [
        { email: EMPLOYEE_DATA.email },
        { employeeId: EMPLOYEE_DATA.employeeId },
      ],
    }).populate('department', 'name code');

    if (existing) {
      console.log('⚠️  Employee already exists:');
      console.log(`   📋 Employee ID : ${existing.employeeId}`);
      console.log(`   👤 Name        : ${existing.firstName} ${existing.lastName}`);
      console.log(`   📧 Email       : ${existing.email}`);
      console.log(`   🏢 Department  : ${existing.department?.name || 'N/A'}`);
      console.log('\n💡 To re-seed, delete this user first (see resetSeeds.js).');
      await mongoose.disconnect();
      process.exit(0);
    }

    // ── 2. Ensure department (matches manager's dept) ────────────
    const dept = await ensureDepartment(DEPT_NAME);

    // ── 3. Reporting manager — pinned to Rinku Khan (MGR001) ─────
    const manager = await findReportingManager(REPORTING_MANAGER_EMPLOYEE_ID);
    if (manager) {
      console.log(
        `👔 Reporting manager: ${manager.firstName} ${manager.lastName} ` +
        `(${manager.employeeId}, ${manager.role}, ${manager.designation})`
      );

      // Sanity check: manager should be in the same department.
      const mgrDeptMatches =
        manager.department &&
        String(manager.department) === String(dept._id);
      if (!mgrDeptMatches) {
        console.log(
          `⚠️  Manager's department does not match employee's ` +
          `(${dept.name}). This is allowed at the DB level but may ` +
          `be rejected by the register API.`
        );
      }
    } else {
      console.log('⚠️  No eligible manager found — reportingManager will be null.');
    }

    // ── 4. Probation window ──────────────────────────────────────
    const probationStart = EMPLOYEE_DATA.dateOfJoining;
    const probationEnd = new Date(probationStart);
    probationEnd.setMonth(probationEnd.getMonth() + 6);

    // ── 5. Create employee ───────────────────────────────────────
    const employeeUser = await User.create({
      ...EMPLOYEE_DATA,
      department: dept._id,
      reportingManager: manager ? manager._id : null,
      probationStartDate: probationStart,
      probationEndDate: probationEnd,
      isProbationCompleted: false,
    });

    // ── 6. Compute net salary ────────────────────────────────────
    if (typeof employeeUser.calculateNetSalary === 'function') {
      employeeUser.calculateNetSalary();
      await employeeUser.save({ validateBeforeSave: false });
    }

    // ── 7. Update department counters ────────────────────────────
    const employeeCount = await User.countDocuments({
      department: dept._id,
      isActive: true,
    });
    dept.employeeCount = employeeCount;
    await dept.save();
    console.log(`📊 ${dept.name} now has ${employeeCount} active member(s)`);

    // ── 8. Report ────────────────────────────────────────────────
    console.log('\n✅ Employee user created successfully!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`📋 Employee ID     : ${employeeUser.employeeId}`);
    console.log(`👤 Name            : ${employeeUser.firstName} ${employeeUser.lastName}`);
    console.log(`📧 Email           : ${employeeUser.email}`);
    console.log(`🔑 Password        : ${EMPLOYEE_DATA.password}`);
    console.log(`🎭 Role            : ${employeeUser.role}`);
    console.log(`🏢 Department      : ${dept.name}`);
    console.log(`💼 Designation     : ${employeeUser.designation}`);
    console.log(`💰 Net Salary      : ₹${employeeUser.salary.netSalary}`);
    if (manager) {
      console.log(
        `👔 Reporting Mgr   : ${manager.firstName} ${manager.lastName} ` +
        `(${manager.employeeId})`
      );
    }
    console.log(`🗓️  Probation ends  : ${probationEnd.toDateString()}`);
    console.log(`🆔 User ID         : ${employeeUser._id}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🎉 Employee seeding completed successfully!');

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding Employee:', error.message);
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

seedEmployee();