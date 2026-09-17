// controllers/departmentController.js
const Department = require('../models/Department');
const User = require('../models/User');
const { ACCESS_ROLES } = require('../constants/roles');

// @desc    Get all departments
// @route   GET /api/departments
// @access  Private
exports.getAllDepartments = async (req, res) => {
  try {
    const { isActive } = req.query;
    const query = {};

    if (isActive !== undefined) {
      query.isActive = isActive === 'true';
    } else {
      query.isActive = true;
    }

    const departments = await Department.find(query)
      .populate('head', 'firstName lastName email employeeId designation role')
      .sort({ name: 1 });

    const departmentsWithCount = await Promise.all(
      departments.map(async (dept) => {
        const employeeCount = await User.countDocuments({ department: dept._id });
        return { ...dept.toObject(), employeeCount };
      })
    );

    res.status(200).json({
      success: true,
      count: departmentsWithCount.length,
      departments: departmentsWithCount,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get single department
// @route   GET /api/departments/:id
// @access  Private
exports.getDepartment = async (req, res) => {
  try {
    const department = await Department.findById(req.params.id)
      .populate('head', 'firstName lastName email employeeId profilePicture designation role');

    if (!department) {
      return res.status(404).json({ success: false, message: 'Department not found' });
    }

    const employees = await User.find({
      department: req.params.id,
      isActive: true,
    }).select('firstName lastName employeeId email profilePicture designation role');

    res.status(200).json({ success: true, department, employees });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Create department
// @route   POST /api/departments
// @access  Private (HR Admin, Superadmin)
exports.createDepartment = async (req, res) => {
  try {
    const { name, code, description, head } = req.body;

    const existingDept = await Department.findOne({ $or: [{ name }, { code }] });
    if (existingDept) {
      return res.status(400).json({
        success: false,
        message: 'Department name or code already exists',
      });
    }

    const payload = { name, code, description };
    if (head) payload.head = head;

    const department = await Department.create(payload);
    await department.populate('head', 'firstName lastName email designation role');

    res.status(201).json({
      success: true,
      message: 'Department created successfully',
      department,
    });
  } catch (error) {
    console.error('❌ [CREATE-DEPARTMENT] Error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Update department
// @route   PUT /api/departments/:id
// @access  Private (HR Admin, Superadmin)
exports.updateDepartment = async (req, res) => {
  try {
    let department = await Department.findById(req.params.id);
    if (!department) {
      return res.status(404).json({ success: false, message: 'Department not found' });
    }

    department = await Department.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    ).populate('head', 'firstName lastName email designation role');

    res.status(200).json({
      success: true,
      message: 'Department updated successfully',
      department,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Delete department
// @route   DELETE /api/departments/:id
// @access  Private (Superadmin only)
exports.deleteDepartment = async (req, res) => {
  try {
    const department = await Department.findById(req.params.id);
    if (!department) {
      return res.status(404).json({ success: false, message: 'Department not found' });
    }

    const employeeCount = await User.countDocuments({ department: req.params.id });
    if (employeeCount > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete department. There are ${employeeCount} user(s) assigned to this department.`,
      });
    }

    await Department.deleteOne({ _id: req.params.id });

    res.status(200).json({ success: true, message: 'Department deleted successfully' });
  } catch (error) {
    console.error('❌ [DELETE-DEPARTMENT] Error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Toggle department active status
// @route   PATCH /api/departments/:id/toggle-status
// @access  Private (HR Admin, Superadmin)
exports.toggleDepartmentStatus = async (req, res) => {
  try {
    const department = await Department.findById(req.params.id);
    if (!department) {
      return res.status(404).json({ success: false, message: 'Department not found' });
    }

    if (!department.isActive) {
      department.isActive = true;
    } else {
      const employeeCount = await User.countDocuments({
        department: req.params.id,
        isActive: true,
      });

      if (employeeCount > 0) {
        return res.status(400).json({
          success: false,
          message: `Cannot deactivate department with ${employeeCount} active employees`,
        });
      }

      department.isActive = false;
    }

    await department.save();

    res.status(200).json({
      success: true,
      message: `Department ${department.isActive ? 'activated' : 'deactivated'}`,
      department,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};