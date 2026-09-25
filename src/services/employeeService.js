const User = require('../models/User');

/**
 * Get paginated list of active employees
 */
const getPaginatedEmployees = async (page = 1, limit = 10) => {
  const skip = (page - 1) * limit;

  const [employees, total] = await Promise.all([
    User.find({ role: 'employee', isActive: true })
      .select('-password')
      .populate('department', 'name code')
      .skip(skip)
      .limit(limit)
      .lean(),
    User.countDocuments({ role: 'employee', isActive: true }),
  ]);

  return {
    employees,
    total,
    page,
    pages: Math.ceil(total / limit),
  };
};

/**
 * Get a single employee by ID
 */
const getEmployeeById = async (id) => {
  const employee = await User.findById(id)
    .select('-password')
    .populate('department', 'name code')
    .lean();

  if (!employee || employee.role !== 'employee') {
    return null;
  }

  return employee;
};

module.exports = {
  getPaginatedEmployees,
  getEmployeeById,
};