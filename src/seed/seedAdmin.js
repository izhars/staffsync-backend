// src/seed/seedAdmin.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const User = require('../models/User');

// Admin Data
const adminData = {
  employeeId: 'ADMIN001',
  firstName: 'System',
  lastName: 'Administrator',
  email: 'admin@staffsync.com',
  password: 'Admin@123456',
  role: 'admin',
  department: 'Administration',
  designation: 'System Administrator',
  phone: '9876543210',
  gender: 'male',
  dateOfBirth: new Date('1990-01-01'),
  dateOfJoining: new Date('2023-01-01'),
  maritalStatus: 'single',
  bloodGroup: 'A+',
  address: {
    street: '123 Admin Tower',
    city: 'Mumbai',
    state: 'Maharashtra',
    country: 'India',
    postalCode: '400001'
  },
  salary: {
    basic: 80000,
    hra: 30000,
    transport: 10000,
    allowances: 15000,
    deductions: 10000,
    netSalary: 0
  },
  bankDetails: {
    accountNumber: '9876543210',
    bankName: 'SBI Bank',
    ifscCode: 'SBIN0001234',
    accountHolderName: 'System Administrator'
  },
  panNumber: 'FGHIJ5678K',
  pfNumber: 'MH987654321',
  uanNumber: '987654321098',
  employmentType: 'full-time',
  weekendType: 'sunday',
  isActive: true,
  isVerified: true,
  leaveBalance: {
    casual: 12,
    sick: 10,
    earned: 15,
    combo: 0,
    unpaid: 0
  }
};

// Function to seed Admin
async function seedAdmin() {
  try {
    const mongoURI = process.env.MONGODB_URI;
    console.log(`🔌 Connecting to MongoDB: ${mongoURI.replace(/\/\/.*@/, '//***@')}`);
    
    // Connect to MongoDB
    await mongoose.connect(mongoURI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('✅ Connected to MongoDB\n');

    // Check if Admin already exists
    const existingAdmin = await User.findOne({ 
      $or: [{ email: adminData.email }, { employeeId: adminData.employeeId }] 
    });

    if (existingAdmin) {
      console.log('⚠️ Admin user already exists:');
      console.log(`   📋 ID: ${existingAdmin.employeeId}`);
      console.log(`   👤 Name: ${existingAdmin.firstName} ${existingAdmin.lastName}`);
      console.log(`   📧 Email: ${existingAdmin.email}`);
      console.log(`   🏢 Department: ${existingAdmin.department?.name || 'N/A'}`);
      console.log('\n💡 To re-seed, delete this user first using resetSeeds.js');
      process.exit(0);
    }

    // Calculate net salary
    const { basic, hra, transport, allowances, deductions } = adminData.salary;
    adminData.salary.netSalary = Math.max(0, (basic + hra + transport + allowances) - deductions);

    // Hash password
    const salt = await bcrypt.genSalt(12);
    adminData.password = await bcrypt.hash(adminData.password, salt);

    // Create Admin user
    const adminUser = new User(adminData);
    await adminUser.save();

    console.log('\n✅ Admin user created successfully!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`📋 Employee ID: ${adminUser.employeeId}`);
    console.log(`👤 Name: ${adminUser.firstName} ${adminUser.lastName}`);
    console.log(`📧 Email: ${adminUser.email}`);
    console.log(`🔑 Password: Admin@123456`);
    console.log(`💼 Role: ${adminUser.role}`);
    console.log(`💰 Net Salary: ₹${adminUser.salary.netSalary}`);
    console.log(`🆔 User ID: ${adminUser._id}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🎉 Admin seeding completed successfully!');

    process.exit(0);

  } catch (error) {
    console.error('❌ Error seeding Admin:', error.message);
    if (error.code === 11000) {
      console.error('⚠️ Duplicate key error - user may already exist');
      console.error('   Try running: node src/seed/resetSeeds.js');
    }
    console.error('   Stack:', error.stack);
    process.exit(1);
  }
}

// Run the seed
seedAdmin();