// seedAdmin.js
const User = require('./src/models/User');
const Department = require('./src/models/Department');

async function createSuperAdmin() {
  try {

    let adminDept = await Department.findOne({ name: 'Administration' });

    if (!adminDept) {
      adminDept = await Department.create({
        name: 'Administration',
        code: 'ADM',
        description: 'System Administration Department',
      });
    } else {
      console.log('✅ Administration department already exists.');
    }

    const existingAdmin = await User.findOne({ role: 'superadmin' });

    if (existingAdmin) {
      return;
    }

    const admin = await User.create({
      employeeId: 'ADM001',
      email: 'admin@staffsync.com',
      password: 'StaffSync@123',
      firstName: 'System',
      lastName: 'Administrator',
      role: 'superadmin',
      department: adminDept._id,
      designation: 'System Administrator',
      dateOfJoining: new Date(),
      isActive: true,
    });

  } catch (err) {
    console.error('❌ Error creating SuperAdmin:', err);
  }
}

module.exports = createSuperAdmin;