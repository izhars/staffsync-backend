// src/seed/seedHr.js
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const User = require('../models/User');
const Department = require('../models/Department');
const { ACCESS_ROLES } = require('../constants/roles');

// ────────────────────────────────────────────────────────────────
// HR seed data
// NOTE: 'hr_admin' is an ADMIN_ROLE, so the User model's pre-save
// hook strips personal/salary/bank info and forces maritalStatus
// to 'single' + clears marriageAnniversary. We still send the
// minimum required by validation (designation, department, etc.).
// ────────────────────────────────────────────────────────────────
const HR_DATA = {
  employeeId: 'SCAIPLH002',
  firstName: 'Priya',
  lastName: 'Singh',
  email: 'priya.singh@staffsync.com',
  password: 'Scaipl@123',
  role: ACCESS_ROLES.HR_ADMIN,
  designation: 'HR Manager',
  dateOfJoining: new Date('2020-01-01'),
  isActive: true,
  isVerified: true,
};

const HR_DEPT = {
  name: 'HUMAN RESOURCES',
  code: 'HR',
};

async function seedHR() {
  try {
    const mongoURI = process.env.MONGODB_URI;
    if (!mongoURI) {
      console.error('❌ MONGODB_URI is not defined in .env');
      process.exit(1);
    }

    console.log(`🔌 Connecting to MongoDB: ${mongoURI.replace(/\/\/.*@/, '//***@')}`);
    await mongoose.connect(mongoURI);
    console.log('✅ Connected to MongoDB\n');

    // ── 1. Guard: does HR already exist? ─────────────────────────
    const existing = await User.findOne({
      $or: [{ email: HR_DATA.email }, { employeeId: HR_DATA.employeeId }],
    }).populate('department', 'name code');

    if (existing) {
      console.log('⚠️  HR user already exists:');
      console.log(`   📋 Employee ID : ${existing.employeeId}`);
      console.log(`   👤 Name        : ${existing.firstName} ${existing.lastName}`);
      console.log(`   📧 Email       : ${existing.email}`);
      console.log(`   🎭 Role        : ${existing.role}`);
      console.log(`   🏢 Department  : ${existing.department?.name || 'N/A'}`);
      console.log('\n💡 To re-seed, delete this user first (see resetSeeds.js).');
      await mongoose.disconnect();
      process.exit(0);
    }

    // ── 2. Ensure Department exists ──────────────────────────────
    let dept = await Department.findOne({
      name: { $regex: new RegExp(`^${HR_DEPT.name}$`, 'i') },
    });

    if (!dept) {
      console.log(`🏢 Creating department: ${HR_DEPT.name}`);
      dept = await Department.create({
        name: HR_DEPT.name,
        code: HR_DEPT.code,
        description: 'Human Resources department',
      });
    } else {
      console.log(`🏢 Using existing department: ${dept.name} (${dept.code})`);
    }

    // ── 3. Create the hr_admin user ──────────────────────────────
    // Password hashing handled by User pre-save hook #1.
    const hrUser = await User.create({
      ...HR_DATA,
      department: dept._id,
    });

    // ── 4. Set department head (if unset) ────────────────────────
    if (!dept.head) {
      dept.head = hrUser._id;
      await dept.save();
      console.log(`👔 Set ${hrUser.employeeId} as head of ${dept.name}`);
    }

    // ── 5. Report ────────────────────────────────────────────────
    console.log('\n✅ HR user created successfully!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`📋 Employee ID : ${hrUser.employeeId}`);
    console.log(`👤 Name        : ${hrUser.firstName} ${hrUser.lastName}`);
    console.log(`📧 Email       : ${hrUser.email}`);
    console.log(`🔑 Password    : ${HR_DATA.password}`);
    console.log(`🎭 Role        : ${hrUser.role}`);
    console.log(`🏢 Department  : ${dept.name}`);
    console.log(`💼 Designation : ${hrUser.designation}`);
    console.log(`🆔 User ID     : ${hrUser._id}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🎉 HR seeding completed successfully!');

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding HR:', error.message);
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

seedHR();