// src/seed/seedEmployee.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const User = require('../models/User');
const Department = require('../models/Department');

// Employee Data
const employeeData = {
  employeeId: 'EMP017',
  firstName: 'Shashank',
  lastName: 'Singh',
  email: 'shashank.singh@staffsync.com',
  password: 'Scaipl@123',
  role: 'employee',
  department: 'Maintenance',
  designation: 'Database Administrator',
  phone: '9123456789',
  gender: 'male',
  dateOfBirth: new Date('1998-11-14'),
  dateOfJoining: new Date('2024-02-12'),
  maritalStatus: 'single',
  bloodGroup: 'O+',
  address: {
    street: '72 Green Valley Road',
    city: 'Gurugram',
    state: 'Haryana',
    country: 'India',
    postalCode: '122018'
  },
  salary: {
    basic: 42000,
    hra: 16800,
    transport: 4500,
    allowances: 7500,
    deductions: 4200,
    netSalary: 0
  },
  bankDetails: {
    accountNumber: '987654321012',
    bankName: 'ICICI Bank',
    ifscCode: 'ICIC0002456',
    accountHolderName: 'Shashank Singh'
  },
  panNumber: 'FGHIJ5678K',
  pfNumber: 'HR987654321',
  uanNumber: '987654321098',
  employmentType: 'full-time',
  weekendType: 'saturday_sunday',
  isActive: true,
  isVerified: true,
  leaveBalance: {
    casual: 8,
    sick: 7,
    earned: 18,
    combo: 2,
    unpaid: 0
  }
};

// Function to seed Employee
async function seedEmployee() {
  try {
    const mongoURI = process.env.MONGODB_URI;
    console.log(`🔌 Connecting to MongoDB: ${mongoURI.replace(/\/\/.*@/, '//***@')}`);
    
    // Connect to MongoDB
    await mongoose.connect(mongoURI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('✅ Connected to MongoDB\n');

    // Check if Employee already exists
    const existingEmployee = await User.findOne({ 
      $or: [{ email: employeeData.email }, { employeeId: employeeData.employeeId }] 
    });

    if (existingEmployee) {
      console.log('⚠️ Employee user already exists:');
      console.log(`   📋 ID: ${existingEmployee.employeeId}`);
      console.log(`   👤 Name: ${existingEmployee.firstName} ${existingEmployee.lastName}`);
      console.log(`   📧 Email: ${existingEmployee.email}`);
      console.log(`   🏢 Department: ${existingEmployee.department?.name || 'N/A'}`);
      console.log('\n💡 To re-seed, delete this user first using resetSeeds.js');
      process.exit(0);
    }

    // Get or create Department
    let department = await Department.findOne({ 
      name: { $regex: new RegExp(`^${employeeData.department.trim()}$`, 'i') } 
    });

    if (!department) {
      const code = employeeData.department
        .split(' ')
        .map(word => word[0])
        .join('')
        .toUpperCase()
        .substring(0, 4);

      department = await Department.create({
        name: employeeData.department.trim(),
        code: code,
        isActive: true
      });
      console.log(`✅ Department created: ${department.name} (${department.code})`);
    } else {
      console.log(`✅ Department found: ${department.name} (${department.code})`);
    }

    // Set department ID
    employeeData.department = department._id;

    // Find HR user to set as reporting manager
    const hrUser = await User.findOne({ role: 'hr', isActive: true });
    
    if (hrUser) {
      employeeData.reportingManager = hrUser._id;
      console.log(`✅ Reporting manager set: ${hrUser.firstName} ${hrUser.lastName} (${hrUser.employeeId})`);
    } else {
      console.log('⚠️ No HR user found - reporting manager not set');
      console.log('💡 Run node src/seed/seedHr.js first to create HR user');
    }

    // Set probation dates
    const probationStart = employeeData.dateOfJoining;
    const probationEnd = new Date(probationStart);
    probationEnd.setMonth(probationEnd.getMonth() + 6);
    employeeData.probationStartDate = probationStart;
    employeeData.probationEndDate = probationEnd;
    employeeData.isProbationCompleted = false;

    // Calculate net salary
    const { basic, hra, transport, allowances, deductions } = employeeData.salary;
    employeeData.salary.netSalary = Math.max(0, (basic + hra + transport + allowances) - deductions);

    // Hash password
    const salt = await bcrypt.genSalt(12);
    employeeData.password = await bcrypt.hash(employeeData.password, salt);

    // Create Employee user
    const employeeUser = new User(employeeData);
    await employeeUser.save();

    // Update department employee count
    department.employeeCount = (department.employeeCount || 0) + 1;
    await department.save();

    console.log('\n✅ Employee user created successfully!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`📋 Employee ID: ${employeeUser.employeeId}`);
    console.log(`👤 Name: ${employeeUser.firstName} ${employeeUser.lastName}`);
    console.log(`📧 Email: ${employeeUser.email}`);
    console.log(`🔑 Password: Emp@123456`);
    console.log(`🏢 Department: ${employeeData.department}`);
    console.log(`💼 Role: ${employeeUser.role}`);
    console.log(`💰 Net Salary: ₹${employeeUser.salary.netSalary}`);
    if (hrUser) {
      console.log(`👔 Reporting Manager: ${hrUser.firstName} ${hrUser.lastName} (${hrUser.employeeId})`);
    }
    console.log(`🆔 User ID: ${employeeUser._id}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🎉 Employee seeding completed successfully!');

    process.exit(0);

  } catch (error) {
    console.error('❌ Error seeding Employee:', error.message);
    if (error.code === 11000) {
      console.error('⚠️ Duplicate key error - user may already exist');
      console.error('   Try running: node src/seed/resetSeeds.js');
    }
    console.error('   Stack:', error.stack);
    process.exit(1);
  }
}

// Run the seed
seedEmployee();