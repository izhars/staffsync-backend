// controllers/shiftController.js
const Shift = require('../models/Shift');
const User = require('../models/User');
const { ADMIN_ROLES } = require('../constants/roles');
const { getWorkingDays, getWeekendDays } = require('../utils/workingDays');

// ────────────────────────────────────────────────────────────────
// @desc    Create new shift
// @route   POST /api/shifts
// @access  Private (Superadmin, HR Admin)
// ────────────────────────────────────────────────────────────────
exports.createShift = async (req, res) => {
  try {
    const {
      name, code, description, startTime, endTime, breakDuration,
      gracePeriod, halfDayThreshold, earlyLeaveGrace,
      type, isNightShift, nightShiftAllowance,
      applicableDepartments, applicableDesignations,
      isDefault,
    } = req.body;

    // ── Required validation ──────────────────────────────────────
    if (!name || !code || !startTime || !endTime) {
      return res.status(400).json({
        success: false,
        message: 'Name, code, start time, and end time are required',
      });
    }

    // ── Duplicate check ──────────────────────────────────────────
    const existing = await Shift.findOne({
      $or: [{ name: name.trim() }, { code: code.trim().toUpperCase() }],
    });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: existing.name === name.trim()
          ? 'Shift name already exists'
          : 'Shift code already exists',
      });
    }

    // ── Auto-detect night shift ──────────────────────────────────
    const [sh] = startTime.split(':').map(Number);
    const [eh] = endTime.split(':').map(Number);
    const autoNight = sh >= 20 || sh < 6 || eh <= sh;

    const shift = await Shift.create({
      name: name.trim(),
      code: code.trim().toUpperCase(),
      description: description?.trim() || '',
      startTime,
      endTime,
      breakDuration: breakDuration ?? 60,
      gracePeriod: gracePeriod ?? 15,
      halfDayThreshold: halfDayThreshold ?? 240,
      earlyLeaveGrace: earlyLeaveGrace ?? 15,
      type: type || 'fixed',
      isNightShift: isNightShift ?? autoNight,
      nightShiftAllowance: nightShiftAllowance ?? 0,
      applicableDepartments: applicableDepartments || [],
      applicableDesignations: applicableDesignations || [],
      isDefault: isDefault || false,
      createdBy: req.user._id,
    });

    res.status(201).json({
      success: true,
      message: 'Shift created successfully',
      data: shift,
    });
  } catch (error) {
    console.error('Create shift error:', error);

    if (error.name === 'ValidationError') {
      const errors = {};
      Object.keys(error.errors).forEach((key) => {
        errors[key] = error.errors[key].message;
      });
      return res.status(400).json({ success: false, message: 'Validation failed', errors });
    }

    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Duplicate entry: Shift name or code already exists',
      });
    }

    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ────────────────────────────────────────────────────────────────
// @desc    Get all shifts
// @route   GET /api/shifts
// @access  Private
// ────────────────────────────────────────────────────────────────
// ────────────────────────────────────────────────────────────────
// @desc    Get all shifts (with assigned users)
// @route   GET /api/shifts
// @access  Private
// ────────────────────────────────────────────────────────────────
exports.getShifts = async (req, res) => {
  try {
    const { isActive, type, departmentId, includeInactive } = req.query;

    const query = {};
    if (isActive !== undefined) query.isActive = isActive === 'true';
    else if (!includeInactive) query.isActive = true;

    if (type) query.type = type;
    if (departmentId) query.applicableDepartments = departmentId;

    const shifts = await Shift.find(query)
      .populate('applicableDepartments', 'name code')
      .populate('createdBy', 'firstName lastName employeeId')
      .populate('updatedBy', 'firstName lastName employeeId')
      .sort({ isDefault: -1, name: 1 })
      .lean();

    // ── Fetch assigned users for each shift ─────────────────────
    const shiftIds = shifts.map((s) => s._id);

    const users = await User.find({
      shift: { $in: shiftIds },
      isActive: true,
    })
      .select('employeeId firstName lastName email designation department role profilePicture shift weekendType')
      .populate('department', 'name code')
      .lean();

    // Group users by shift ID
    const usersByShift = {};
    users.forEach((u) => {
      const sid = u.shift.toString();
      if (!usersByShift[sid]) usersByShift[sid] = [];
      usersByShift[sid].push({
        ...u,
        workingDays: getWorkingDays(u),
        weekendDays: getWeekendDays(u),
      });
    });

    // ── Clean up response ───────────────────────────────────────
    const data = shifts.map((shift) => {
      // Remove applicableDepartments & applicableDesignations
      const {
        applicableDepartments,
        applicableDesignations,
        ...shiftData
      } = shift;

      // Clean createdBy / updatedBy — keep only basic fields
      const cleanUser = (u) => {
        if (!u) return null;
        return {
          _id: u._id,
          firstName: u.firstName,
          lastName: u.lastName,
          employeeId: u.employeeId,
        };
      };

      return {
        ...shiftData,
        createdBy: cleanUser(shift.createdBy),
        updatedBy: cleanUser(shift.updatedBy),
        assignedUsers: usersByShift[shift._id.toString()] || [],
        assignedCount: (usersByShift[shift._id.toString()] || []).length,
      };
    });

    res.status(200).json({
      success: true,
      count: data.length,
      data,
    });
  } catch (error) {
    console.error('Get shifts error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ────────────────────────────────────────────────────────────────
// @desc    Get single shift
// @route   GET /api/shifts/:id
// @access  Private
// ────────────────────────────────────────────────────────────────
exports.getShift = async (req, res) => {
  try {
    const shift = await Shift.findById(req.params.id)
      .populate('applicableDepartments', 'name code')
      .populate('createdBy', 'firstName lastName employeeId');

    if (!shift) {
      return res.status(404).json({ success: false, message: 'Shift not found' });
    }

    res.status(200).json({ success: true, data: shift });
  } catch (error) {
    console.error('Get shift error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ────────────────────────────────────────────────────────────────
// @desc    Update shift
// @route   PUT /api/shifts/:id
// @access  Private (Superadmin, HR Admin)
// ────────────────────────────────────────────────────────────────
exports.updateShift = async (req, res) => {
  try {
    const shift = await Shift.findById(req.params.id);
    if (!shift) {
      return res.status(404).json({ success: false, message: 'Shift not found' });
    }

    const allowedUpdates = [
      'name', 'code', 'description', 'startTime', 'endTime', 'breakDuration',
      'gracePeriod', 'halfDayThreshold', 'earlyLeaveGrace',
      'type', 'isNightShift', 'nightShiftAllowance',
      'applicableDepartments', 'applicableDesignations',
      'isActive', 'isDefault',
    ];

    const updates = {};
    allowedUpdates.forEach((field) => {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    });

    // ── Duplicate check for name/code ────────────────────────────
    if (updates.name || updates.code) {
      const dupQuery = { _id: { $ne: shift._id } };
      if (updates.name) dupQuery.name = updates.name.trim();
      if (updates.code) dupQuery.code = updates.code.trim().toUpperCase();

      const existing = await Shift.findOne(dupQuery);
      if (existing) {
        return res.status(400).json({
          success: false,
          message: 'Another shift with this name or code already exists',
        });
      }
    }

    // ── Auto-detect night shift if times changed ─────────────────
    if (updates.startTime || updates.endTime) {
      const st = updates.startTime || shift.startTime;
      const et = updates.endTime || shift.endTime;
      const [sh] = st.split(':').map(Number);
      const [eh] = et.split(':').map(Number);
      if (updates.isNightShift === undefined) {
        updates.isNightShift = sh >= 20 || sh < 6 || eh <= sh;
      }
    }

    Object.assign(shift, updates);
    shift.updatedBy = req.user._id;
    await shift.save();

    res.status(200).json({
      success: true,
      message: 'Shift updated successfully',
      data: shift,
    });
  } catch (error) {
    console.error('Update shift error:', error);

    if (error.name === 'ValidationError') {
      const errors = {};
      Object.keys(error.errors).forEach((key) => {
        errors[key] = error.errors[key].message;
      });
      return res.status(400).json({ success: false, message: 'Validation failed', errors });
    }

    if (error.code === 11000) {
      return res.status(400).json({ success: false, message: 'Duplicate entry' });
    }

    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ────────────────────────────────────────────────────────────────
// @desc    Delete shift (soft delete if assigned to users)
// @route   DELETE /api/shifts/:id
// @access  Private (Superadmin, HR Admin)
// ────────────────────────────────────────────────────────────────
exports.deleteShift = async (req, res) => {
  try {
    const shift = await Shift.findById(req.params.id);
    if (!shift) {
      return res.status(404).json({ success: false, message: 'Shift not found' });
    }

    // ── Check if assigned to any active users ────────────────────
    const assignedCount = await User.countDocuments({
      shift: shift._id,
      isActive: true,
    });

    if (assignedCount > 0) {
      // Soft delete
      shift.isActive = false;
      await shift.save();

      return res.status(200).json({
        success: true,
        message: `Shift deactivated (${assignedCount} active employee(s) still assigned). Reassign them to another shift.`,
        data: { isActive: false, assignedCount },
      });
    }

    // Hard delete if unassigned
    await shift.deleteOne();

    res.status(200).json({
      success: true,
      message: 'Shift deleted successfully',
    });
  } catch (error) {
    console.error('Delete shift error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ────────────────────────────────────────────────────────────────
// @desc    Assign shift to user(s)
// @route   PATCH /api/shifts/assign
// @access  Private (Superadmin, HR Admin)
// ────────────────────────────────────────────────────────────────
exports.assignShift = async (req, res) => {
  try {
    const { userIds, shiftId, effectiveFrom } = req.body;

    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ success: false, message: 'userIds array is required' });
    }

    if (!shiftId) {
      return res.status(400).json({ success: false, message: 'shiftId is required' });
    }

    const shift = await Shift.findById(shiftId);
    if (!shift) {
      return res.status(404).json({ success: false, message: 'Shift not found' });
    }

    if (!shift.isActive) {
      return res.status(400).json({ success: false, message: 'Cannot assign an inactive shift' });
    }

    const result = await User.updateMany(
      { _id: { $in: userIds } },
      {
        $set: {
          shift: shift._id,
          shiftAssignedAt: effectiveFrom ? new Date(effectiveFrom) : new Date(),
          shiftAssignedBy: req.user._id,
        },
      }
    );

    res.status(200).json({
      success: true,
      message: `Shift "${shift.name}" assigned to ${result.modifiedCount} user(s)`,
      data: {
        shift: { id: shift._id, name: shift.name, timing: shift.displayTiming },
        assignedCount: result.modifiedCount,
      },
    });
  } catch (error) {
    console.error('Assign shift error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ────────────────────────────────────────────────────────────────
// @desc    Remove shift from user(s) → fallback to default
// @route   PATCH /api/shifts/unassign
// @access  Private (Superadmin, HR Admin)
// ────────────────────────────────────────────────────────────────
exports.unassignShift = async (req, res) => {
  try {
    const { userIds } = req.body;

    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ success: false, message: 'userIds array is required' });
    }

    const defaultShift = await Shift.getDefaultShift();

    const result = await User.updateMany(
      { _id: { $in: userIds } },
      {
        $set: {
          shift: defaultShift ? defaultShift._id : null,
          shiftAssignedAt: new Date(),
          shiftAssignedBy: req.user._id,
        },
      }
    );

    res.status(200).json({
      success: true,
      message: defaultShift
        ? `Shift removed → ${result.modifiedCount} user(s) moved to default shift "${defaultShift.name}"`
        : `Shift removed from ${result.modifiedCount} user(s)`,
      data: { affectedCount: result.modifiedCount },
    });
  } catch (error) {
    console.error('Unassign shift error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ────────────────────────────────────────────────────────────────
// @desc    Get users assigned to a shift
// @route   GET /api/shifts/:id/users
// @access  Private (Superadmin, HR Admin)
// ────────────────────────────────────────────────────────────────
exports.getShiftUsers = async (req, res) => {
  try {
    const shift = await Shift.findById(req.params.id);
    if (!shift) {
      return res.status(404).json({ success: false, message: 'Shift not found' });
    }

    const users = await User.find({ shift: shift._id, isActive: true })
      .select('employeeId firstName lastName email designation department role profilePicture weekendType')
      .populate('department', 'name code')
      .sort({ firstName: 1 });

    // Attach derived working/weekend days so the UI can show them
    const data = users.map((u) => ({
      ...u.toObject(),
      workingDays: getWorkingDays(u),
      weekendDays: getWeekendDays(u),
    }));

    res.status(200).json({
      success: true,
      count: data.length,
      data,
    });
  } catch (error) {
    console.error('Get shift users error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ────────────────────────────────────────────────────────────────
// @desc    Get available shifts for a user (based on dept/designation)
// @route   GET /api/shifts/available
// @access  Private
// ────────────────────────────────────────────────────────────────
exports.getAvailableShifts = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('department designation');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const shifts = await Shift.find({
      isActive: true,
      $or: [
        { applicableDepartments: { $size: 0 } },
        { applicableDepartments: user.department },
        { applicableDesignations: { $size: 0 } },
        { applicableDesignations: user.designation },
      ],
    }).sort({ isDefault: -1, name: 1 });

    res.status(200).json({
      success: true,
      count: shifts.length,
      data: shifts,
    });
  } catch (error) {
    console.error('Get available shifts error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ────────────────────────────────────────────────────────────────
// @desc    Set default shift
// @route   PATCH /api/shifts/:id/set-default
// @access  Private (Superadmin, HR Admin)
// ────────────────────────────────────────────────────────────────
exports.setDefaultShift = async (req, res) => {
  try {
    const shift = await Shift.findById(req.params.id);
    if (!shift) {
      return res.status(404).json({ success: false, message: 'Shift not found' });
    }

    if (!shift.isActive) {
      return res.status(400).json({
        success: false,
        message: 'Cannot set an inactive shift as default',
      });
    }

    shift.isDefault = true;
    await shift.save(); // pre-save hook clears other defaults

    res.status(200).json({
      success: true,
      message: `"${shift.name}" is now the default shift`,
      data: shift,
    });
  } catch (error) {
    console.error('Set default shift error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ────────────────────────────────────────────────────────────────
// @desc    Get shift statistics
// @route   GET /api/shifts/stats
// @access  Private (Superadmin, HR Admin)
// ────────────────────────────────────────────────────────────────
exports.getShiftStats = async (req, res) => {
  try {
    const shifts = await Shift.find({ isActive: true })
      .select('name code startTime endTime type isDefault');

    const stats = await Promise.all(
      shifts.map(async (shift) => {
        const count = await User.countDocuments({ shift: shift._id, isActive: true });
        return {
          shiftId: shift._id,
          name: shift.name,
          code: shift.code,
          timing: `${shift.startTime} - ${shift.endTime}`,
          type: shift.type,
          isDefault: shift.isDefault,
          assignedEmployees: count,
        };
      })
    );

    const unassigned = await User.countDocuments({
      shift: null,
      isActive: true,
      role: { $nin: ADMIN_ROLES },
    });

    res.status(200).json({
      success: true,
      data: {
        shifts: stats,
        totalShifts: shifts.length,
        unassignedEmployees: unassigned,
      },
    });
  } catch (error) {
    console.error('Get shift stats error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ────────────────────────────────────────────────────────────────
// @desc    Get currently assigned shift for logged-in user
// @route   GET /api/shifts/my-shift
// @access  Private
// ────────────────────────────────────────────────────────────────
exports.getMyShift = async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .select('shift shiftAssignedAt weekendType')
      .populate({
        path: 'shift',
        select: `
          name
          code
          description
          startTime
          endTime
          breakDuration
          gracePeriod
          halfDayThreshold
          earlyLeaveGrace
          type
          isNightShift
          nightShiftAllowance
        `,
      });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    if (!user.shift) {
      return res.status(200).json({
        success: true,
        message: 'No shift assigned',
        data: {
          shift: null,
          assignedAt: null,
          weekendType: user.weekendType,
          workingDays: getWorkingDays(user),
          weekendDays: getWeekendDays(user),
        },
      });
    }

    res.status(200).json({
      success: true,
      data: {
        shift: user.shift,
        assignedAt: user.shiftAssignedAt,
        weekendType: user.weekendType,
        workingDays: getWorkingDays(user),
        weekendDays: getWeekendDays(user),
      },
    });
  } catch (error) {
    console.error('Get my shift error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
    });
  }
};