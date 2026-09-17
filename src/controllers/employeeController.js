const User = require('../models/User');
const Department = require('../models/Department');
const { isUserOnline, debugUserConnection } = require('../socket/chat'); // adjust path

// @desc    Get all employees
// @route   GET /api/employees
// @access  Private (HR, Manager, Admin)
exports.getAllEmployees = async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 10, 
      search, 
      department, 
      isActive,
      sortBy = 'createdAt',
      order = 'desc'
    } = req.query;
    
    // ✅ Build query to include both employee and manager
    const query = { role: { $in: ['employee', 'manager', 'hr_admin'] } };

    if (search) {
      query.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { employeeId: { $regex: search, $options: 'i' } }
      ];
    }

    if (department) query.department = department;
    if (isActive !== undefined) query.isActive = isActive === 'true';

    // Sort object
    const sort = {};
    sort[sortBy] = order === 'asc' ? 1 : -1;

    // Execute query with pagination
    const employees = await User.find(query)
      .populate('department', 'name code')
      .populate('reportingManager', 'firstName lastName email employeeId')
      .sort(sort)
      .limit(Number(limit))
      .skip((page - 1) * limit)
      .select('-password');

    // Get total count
    const count = await User.countDocuments(query);

    res.status(200).json({
      success: true,
      count: employees.length,
      totalPages: Math.ceil(count / limit),
      currentPage: Number(page),
      totalEmployees: count,
      employees
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};

exports.getEmployeeList = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    // 🔥 Exclude superadmin
    const filter = { role: { $ne: 'superadmin' } };

    // Total count (WITHOUT superadmin)
    const totalEmployees = await User.countDocuments(filter);

    // Fetch employees
    const employees = await User.find(filter)
      .populate('department', 'name code description head')
      .populate(
        'reportingManager',
        'firstName lastName email employeeId profilePicture designation'
      )
      .select('-password')
      .sort({ firstName: 1 })
      .skip(skip)
      .limit(limit);

    const employeeList = employees.map(emp => {
      const userId = emp._id.toString();
      const online = isUserOnline(userId);
      const connectionInfo = debugUserConnection(userId);

      let lastSeen = emp.lastSeen;
      if (online) lastSeen = 'Now';
      else if (!lastSeen) lastSeen = 'Never';

      return {
        id: userId,
        name: `${emp.firstName} ${emp.lastName}`,
        email: emp.email,
        employeeId: emp.employeeId,
        role: emp.role,
        department: emp.department,
        reportingManager: emp.reportingManager,
        isOnline: online,
        lastSeen,
        socketConnections: connectionInfo.socketIds,
        currentConnections: connectionInfo.currentConnections
      };
    });

    res.status(200).json({
      success: true,
      page,
      limit,
      totalEmployees,
      totalPages: Math.ceil(totalEmployees / limit),
      employees: employeeList
    });

  } catch (error) {
    console.error('Error fetching employee list:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};


// @desc    Get all HR employees
// @route   GET /api/employees/hr
// @access  Private (HR, Manager, Admin)
exports.getAllHRs = async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 10, 
      search, 
      department, 
      isActive,
      isAvailable, // ✅ NEW: Filter by availability
      sortBy = 'createdAt',
      order = 'desc'
    } = req.query;
    
    // ✅ Only HR employees
    const query = { role: 'hr' };

    if (search) {
      query.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { employeeId: { $regex: search, $options: 'i' } }
      ];
    }

    if (department) query.department = department;
    if (isActive !== undefined) query.isActive = isActive === 'true';
    
    // ✅ NEW: Filter by availability
    if (isAvailable !== undefined) {
      query.isAvailable = isAvailable === 'true';
    }

    // Sorting logic - default by availability status
    const sort = {};
    
    // If sortBy is availability-related, handle specially
    if (sortBy === 'isAvailable' || sortBy === 'nextAvailableAt') {
      sort[sortBy] = order === 'asc' ? 1 : -1;
      // Secondary sort by name for better organization
      sort.firstName = 1;
    } else {
      sort[sortBy] = order === 'asc' ? 1 : -1;
    }

    // Fetch HRs
    const hrs = await User.find(query)
      .populate('department', 'name code')
      .populate('reportingManager', 'firstName lastName email employeeId')
      .sort(sort)
      .limit(Number(limit))
      .skip((page - 1) * limit)
      .select('-password')
      .select('+availabilityStatus +nextAvailableAt +availabilityLastChanged'); // Include availability fields

    // Count total
    const count = await User.countDocuments(query);
    
    // ✅ Calculate availability statistics
    const allHRs = await User.find({ role: 'hr', isActive: true });
    const availableHRs = allHRs.filter(hr => hr.isAvailable).length;
    const unavailableHRs = allHRs.filter(hr => !hr.isAvailable).length;

    res.status(200).json({
      success: true,
      count: hrs.length,
      totalPages: Math.ceil(count / limit),
      currentPage: Number(page),
      totalHRs: count,
      availabilityStats: {
        total: allHRs.length,
        available: availableHRs,
        unavailable: unavailableHRs,
        availabilityRate: allHRs.length > 0 ? Math.round((availableHRs / allHRs.length) * 100) : 0
      },
      hrs: hrs.map(hr => ({
        id: hr._id,
        firstName: hr.firstName,
        lastName: hr.lastName,
        email: hr.email,
        employeeId: hr.employeeId,
        profilePicture: hr.profilePicture,
        designation: hr.designation,
        department: hr.department,
        isActive: hr.isActive,
        // ✅ Include availability information
        isAvailable: hr.isAvailable,
        availabilityStatus: hr.availabilityStatus,
        nextAvailableAt: hr.nextAvailableAt,
        availabilityLastChanged: hr.availabilityLastChanged,
        // Additional useful info
        phone: hr.phone,
        location: hr.location,
        joiningDate: hr.joiningDate
      }))
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};


// @desc    Get single employee
// @route   GET /api/employees/:id
// @access  Private
exports.getEmployee = async (req, res) => {
  try {
    const employee = await User.findById(req.params.id)
      .populate('department', 'name code description head')
      .populate('reportingManager', 'firstName lastName email employeeId profilePicture designation')
      .select('-password');
    
    if (!employee) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found'
      });
    }
    
    // Check if user has permission to view this employee
    if (req.user.role === 'employee' && req.user.id !== employee.id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view this employee'
      });
    }
    
    res.status(200).json({
      success: true,
      employee
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// @desc    Create employee
// @route   POST /api/employees
// @access  Private (HR, Admin)
exports.createEmployee = async (req, res) => {
  try {
    const employeeData = req.body;
    
    // Check if email or employeeId already exists
    const existingEmployee = await User.findOne({
      $or: [
        { email: employeeData.email },
        { employeeId: employeeData.employeeId }
      ]
    });
    
    if (existingEmployee) {
      return res.status(400).json({
        success: false,
        message: 'Email or Employee ID already exists'
      });
    }
    
    // Create employee
    const employee = await User.create(employeeData);
    
    // Update department employee count
    if (employee.department) {
      await Department.findByIdAndUpdate(
        employee.department,
        { $inc: { employeeCount: 1 } }
      );
    }
    
    res.status(201).json({
      success: true,
      message: 'Employee created successfully',
      employee
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// @desc    Update employee
// @route   PUT /api/employees/:id
// @access  Private (HR, Admin)
exports.updateEmployee = async (req, res) => {
  try {
    const employee = await User.findById(req.params.id);
    
    if (!employee) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found'
      });
    }
    
    // Don't allow updating password through this route
    if (req.body.password) {
      delete req.body.password;
    }
    
    // Handle department change
    const oldDepartment = employee.department;
    const newDepartment = req.body.department;
    
    // Update employee
    const updatedEmployee = await User.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    ).populate('department reportingManager');
    
    // Update department counts if department changed
    if (oldDepartment && newDepartment && oldDepartment.toString() !== newDepartment.toString()) {
      await Department.findByIdAndUpdate(oldDepartment, { $inc: { employeeCount: -1 } });
      await Department.findByIdAndUpdate(newDepartment, { $inc: { employeeCount: 1 } });
    }
    
    res.status(200).json({
      success: true,
      message: 'Employee updated successfully',
      employee: updatedEmployee
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// @desc    Delete employee (soft delete)
// @route   DELETE /api/employees/:id
// @access  Private (Admin only)
exports.deleteEmployee = async (req, res) => {
  try {
    const employee = await User.findById(req.params.id);
    
    if (!employee) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found'
      });
    }
    
    // Soft delete - deactivate account
    employee.isActive = false;
    employee.dateOfLeaving = Date.now();
    await employee.save();
    
    // Update department count
    if (employee.department) {
      await Department.findByIdAndUpdate(
        employee.department,
        { $inc: { employeeCount: -1 } }
      );
    }
    
    res.status(200).json({
      success: true,
      message: 'Employee deactivated successfully'
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// @desc    Upload employee document
// @route   POST /api/employees/:id/documents
// @access  Private
exports.uploadDocument = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Please upload a file'
      });
    }
    
    const employee = await User.findById(req.params.id);
    
    if (!employee) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found'
      });
    }
    
    // Add document to employee
    employee.documents.push({
      type: req.body.type || 'other',
      fileName: req.file.originalname,
      fileUrl: `/uploads/${req.file.filename}`
    });
    
    await employee.save();
    
    res.status(200).json({
      success: true,
      message: 'Document uploaded successfully',
      document: employee.documents[employee.documents.length - 1]
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// @desc    Update profile picture
// @route   PUT /api/employees/:id/profile-picture
// @access  Private
exports.updateProfilePicture = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Please upload an image'
      });
    }
    
    const employee = await User.findById(req.params.id);
    
    if (!employee) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found'
      });
    }
    
    // Update profile picture
    employee.profilePicture = `/uploads/${req.file.filename}`;
    await employee.save();
    
    res.status(200).json({
      success: true,
      message: 'Profile picture updated successfully',
      profilePicture: employee.profilePicture
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};


// @desc    Toggle HR availability
// @route   PUT /api/employees/:id/availability
// @access  Private (HR themselves, Admin)
exports.toggleHRAvailability = async (req, res) => {
  try {
    const { id } = req.params;
    const { isAvailable, availabilityStatus, nextAvailableAt } = req.body;
    
    // Find the employee
    const employee = await User.findById(id);
    
    if (!employee) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found'
      });
    }
    
    // Check if user is HR
    if (employee.role !== 'hr') {
      return res.status(400).json({
        success: false,
        message: 'This endpoint is only for HR staff'
      });
    }
    
    // Check authorization - HR can update their own status, admin can update any HR
    if (req.user.role !== 'superadmin' && req.user.id !== id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this HR availability'
      });
    }
    
    // Prepare update data
    const updateData = {};
    
    // Handle isAvailable flag
    if (isAvailable !== undefined) {
      updateData.isAvailable = isAvailable;
    }
    
    // Handle availability status message
    if (availabilityStatus !== undefined) {
      updateData.availabilityStatus = availabilityStatus;
    }
    
    // Handle next available time
    if (nextAvailableAt !== undefined) {
      updateData.nextAvailableAt = nextAvailableAt;
    }
    
    // If setting to unavailable without nextAvailableAt, set to 1 hour from now
    if (isAvailable === false && !nextAvailableAt) {
      const oneHourLater = new Date();
      oneHourLater.setHours(oneHourLater.getHours() + 1);
      updateData.nextAvailableAt = oneHourLater;
    }
    
    // If setting to available, clear nextAvailableAt
    if (isAvailable === true) {
      updateData.nextAvailableAt = null;
      if (!availabilityStatus) {
        updateData.availabilityStatus = 'Available';
      }
    }
    
    // Update availability last changed timestamp
    updateData.availabilityLastChanged = Date.now();
    
    // Apply the updates
    const updatedEmployee = await User.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    ).select('-password');
    
    // Log the availability change
    await User.findByIdAndUpdate(id, {
      $push: {
        availabilityLogs: {
          isAvailable: updatedEmployee.isAvailable,
          status: updatedEmployee.availabilityStatus,
          changedBy: req.user.id,
          changedAt: new Date()
        }
      }
    });
    
    res.status(200).json({
      success: true,
      message: 'HR availability updated successfully',
      data: {
        id: updatedEmployee._id,
        name: `${updatedEmployee.firstName} ${updatedEmployee.lastName}`,
        isAvailable: updatedEmployee.isAvailable,
        availabilityStatus: updatedEmployee.availabilityStatus,
        nextAvailableAt: updatedEmployee.nextAvailableAt,
        availabilityLastChanged: updatedEmployee.availabilityLastChanged
      }
    });
    
  } catch (error) {
    console.error('Error updating HR availability:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// @desc    Get HR availability status
// @route   GET /api/employees/:id/availability-status
// @access  Private
exports.getAvailabilityStatus = async (req, res) => {
  try {
    const { id } = req.params;

    const hr = await User.findById(id).select(
      "firstName lastName isAvailable availabilityStatus nextAvailableAt availabilityLastChanged role"
    );

    if (!hr) {
      return res.status(404).json({
        success: false,
        message: "Employee not found"
      });
    }

    if (hr.role !== "hr") {
      return res.status(400).json({
        success: false,
        message: "This feature is only for HR"
      });
    }

    return res.status(200).json({
      success: true,
      hrId: hr._id,
      name: `${hr.firstName} ${hr.lastName}`,
      isAvailable: hr.isAvailable,
      availabilityStatus: hr.availabilityStatus,
      nextAvailableAt: hr.nextAvailableAt,
      lastUpdated: hr.availabilityLastChanged
    });

  } catch (error) {
    console.error("Error fetching availability:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
