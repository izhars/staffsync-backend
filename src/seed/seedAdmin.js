// src/seed/seedAdmin.js
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const User = require('../models/User');
const Department = require('../models/Department');
const { ACCESS_ROLES } = require('../constants/roles');

// ────────────────────────────────────────────────────────────────
// Admin seed data
// NOTE: For ADMIN_ROLES (superadmin / hr_admin) the User model's
// pre-save hook strips personal / salary / bank info, so we don't
// bother including it here.
// ────────────────────────────────────────────────────────────────
const ADMIN_DATA = {
  employeeId: 'SCAIPLH001',
  firstName: 'System',
  lastName: 'Administrator',
  email: 'admin@staffsync.com',
  password: 'Admin@123456',
  role: ACCESS_ROLES.SUPER_ADMIN,   // 'superadmin'
  designation: 'System Administrator',
  dateOfJoining: new Date('2023-01-01'),
  isActive: true,
  isVerified: true,
};

const ADMIN_DEPT = {
  name: 'ADMINISTRATION',
  code: 'ADMIN',
};

async function seedAdmin() {
  try {
    const mongoURI = process.env.MONGODB_URI;
    if (!mongoURI) {
      console.error('❌ MONGODB_URI is not defined in .env');
      process.exit(1);
    }

    console.log(`🔌 Connecting to MongoDB: ${mongoURI.replace(/\/\/.*@/, '//***@')}`);
    await mongoose.connect(mongoURI);
    console.log('✅ Connected to MongoDB\n');

    // ── 1. Guard: does admin already exist? ──────────────────────
    const existing = await User.findOne({
      $or: [{ email: ADMIN_DATA.email }, { employeeId: ADMIN_DATA.employeeId }],
    }).populate('department', 'name code');

    if (existing) {
      console.log('⚠️  Admin user already exists:');
      console.log(`   📋 Employee ID : ${existing.employeeId}`);
      console.log(`   👤 Name        : ${existing.firstName} ${existing.lastName}`);
      console.log(`   📧 Email       : ${existing.email}`);
      console.log(`   🎭 Role        : ${existing.role}`);
      console.log(`   🏢 Department  : ${existing.department?.name || 'N/A'}`);
      console.log('\n💡 To re-seed, delete this user first (see resetSeeds.js).');
      await mongoose.disconnect();
      process.exit(0);
    }

    // ── 2. Ensure Department exists (schema requires an ObjectId) ─
    let dept = await Department.findOne({ name: ADMIN_DEPT.name });
    if (!dept) {
      console.log(`🏢 Creating department: ${ADMIN_DEPT.name}`);
      dept = await Department.create({
        name: ADMIN_DEPT.name,
        code: ADMIN_DEPT.code,
        description: 'System administration department',
      });
    } else {
      console.log(`🏢 Using existing department: ${dept.name} (${dept.code})`);
    }

    // ── 3. Create the superadmin user ────────────────────────────
    // NOTE: password is hashed automatically by the User pre-save hook,
    //       so we pass the plain-text value.
    const adminUser = await User.create({
      ...ADMIN_DATA,
      department: dept._id,
      createdBy: null,           // seed has no creator
    });

    // ── 4. Report ────────────────────────────────────────────────
    console.log('\n✅ Admin user created successfully!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`📋 Employee ID : ${adminUser.employeeId}`);
    console.log(`👤 Name        : ${adminUser.firstName} ${adminUser.lastName}`);
    console.log(`📧 Email       : ${adminUser.email}`);
    console.log(`🔑 Password    : ${ADMIN_DATA.password}`);
    console.log(`🎭 Role        : ${adminUser.role}`);
    console.log(`🏢 Department  : ${dept.name}`);
    console.log(`💼 Designation : ${adminUser.designation}`);
    console.log(`🆔 User ID     : ${adminUser._id}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🎉 Admin seeding completed successfully!');

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding Admin:', error.message);
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

seedAdmin();