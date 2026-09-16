const Leave = require('../models/Leave');
const User = require('../models/User');
const Attendance = require('../models/Attendance');
const Holiday = require('../models/Holiday');
const Notification = require('../models/Notification');
const RestrictedHolidayUsage = require('../models/RestrictedHolidayUsage');

// ====================================
// HELPER: Can current user act on leave?
// ====================================
const canActOnLeave = async (currentUser, leaveEmployeeId) => {
  if (['hr', 'superadmin'].includes(currentUser.role)) return true;

  if (currentUser.role === 'manager') {
    const employee = await User.findById(leaveEmployeeId).select('reportingManager');
    return employee && employee.reportingManager?.toString() === currentUser.id;
  }
  return false;
};

// ====================================
// HELPER: Send role-based notifications
// ====================================
const sendRoleBasedNotification = async (data) => {
  const {
    title,
    message,
    type = 'info',
    targetRoles = [],
    targetUsers = [],
    meta = {},
    createdBy
  } = data;

  let notifications = [];

  // Add individual user notifications
  if (Array.isArray(targetUsers) && targetUsers.length > 0) {
    // Get user roles for each target user
    const users = await User.find({ _id: { $in: targetUsers } }).select('_id role');

    notifications.push(...users.map(user => ({
      title,
      message,
      type,
      user: user._id,
      role: user.role, // Set the user's actual role instead of null
      meta,
      createdBy,
      createdAt: new Date()
    })));
  }

  // Add role-based notifications
  if (Array.isArray(targetRoles) && targetRoles.length > 0) {
    for (const role of targetRoles) {
      if (role === 'all') {
        // Send to all active users
        const users = await User.find({ isActive: true }).select('_id role');
        notifications.push(...users.map(u => ({
          title,
          message,
          type,
          user: u._id,
          role: u.role, // User's actual role
          isGlobal: true, // Flag for global notifications
          meta,
          createdBy,
          createdAt: new Date()
        })));
      } else {
        // Send to specific role
        const users = await User.find({ role, isActive: true }).select('_id role');
        notifications.push(...users.map(u => ({
          title,
          message,
          type,
          user: u._id,
          role: u.role,
          meta,
          createdBy,
          createdAt: new Date()
        })));
      }
    }
  }

  if (notifications.length > 0) {
    await Notification.insertMany(notifications);

    // Emit socket events if needed
    // if (global.io) {
    //   notifications.forEach(n => {
    //     global.io.to(n.user?.toString()).emit('notification:new', n);
    //   });
    // }
  }
};

// ====================================
// HELPER: Get target roles for leave notifications
// ====================================
const getNotificationTargetsForLeave = (userRole, actionType) => {
  const targets = {
    // When employee applies for leave
    'leave:apply': {
      superadmin: ['hr', 'superadmin'], // Superadmin notifies HR (can add superadmin if needed)
      hr: ['hr'], // HR notifies other HRs
      manager: ['hr', 'manager'], // Manager notifies HR and managers
      employee: ['hr', 'manager'] // Employee notifies HR and their manager
    },
    // When leave is approved
    'leave:approved': {
      superadmin: [], // Usually just notify the applicant
      hr: [], // Usually just notify the applicant
      manager: [], // Usually just notify the applicant
      employee: [] // N/A
    },
    // When leave is rejected
    'leave:rejected': {
      superadmin: [], // Usually just notify the applicant
      hr: [], // Usually just notify the applicant
      manager: [], // Usually just notify the applicant
      employee: [] // N/A
    },
    // When leave is cancelled
    'leave:cancelled': {
      superadmin: ['hr'], // Notify HR
      hr: ['hr'], // Notify other HRs
      manager: ['hr', 'manager'], // Notify HR and managers
      employee: ['hr', 'manager'] // Notify HR and manager
    }
  };

  return targets[actionType]?.[userRole] || [];
};

// ================================
// 1. Apply for Leave (Employee)
// ================================
exports.applyLeave = async (req, res) => {
  try {
    console.log('[Leave] Request body:', req.body);

    const {
      leaveType,
      startDate,
      endDate,
      reason,
      documents,
      leaveDuration,
      halfDayType
    } = req.body;

    if (!leaveType || !startDate || !endDate || !leaveDuration) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (isNaN(start) || isNaN(end) || start > end) {
      return res.status(400).json({
        success: false,
        message: 'Invalid date range. End date must be after start date.'
      });
    }

    // === Half-day validation ===
    if (leaveDuration === 'half') {
      if (!halfDayType || !['first_half', 'second_half'].includes(halfDayType)) {
        return res.status(400).json({
          success: false,
          message: 'halfDayType must be "first_half" or "second_half"'
        });
      }
      if (start.toDateString() !== end.toDateString()) {
        return res.status(400).json({
          success: false,
          message: 'Half-day leave can only be applied for a single day.'
        });
      }
    }

    // === Fetch ALL holidays in range (with full details) ===
    const holidays = await Holiday.find({
      date: { $gte: start, $lte: end },
      isActive: true
    });

    // Separate by category
    const mandatoryHolidays = holidays.filter(h => h.category === 'Mandatory');
    const restrictedHolidays = holidays.filter(h => h.category === 'Restricted');
    const mandatoryDates = mandatoryHolidays.map(h => h.date.toDateString());
    const restrictedDates = restrictedHolidays.map(h => h.date.toDateString());

    console.log('[Leave] Mandatory holidays in range:', mandatoryDates);
    console.log('[Leave] Restricted holidays in range:', restrictedDates);

    // === Fetch user & probation check ===
    const user = await User.findById(req.user.id);
    const today = new Date();
    if (user.probationEndDate && today < new Date(user.probationEndDate)
      && leaveType !== 'unpaid' && leaveType !== 'combo') {
      return res.status(400).json({
        success: false,
        message: 'You are on probation. Paid leaves are locked. Only unpaid or combo leave can be applied.'
      });
    }

    // === Build leaveDays: exclude MANDATORY holidays only ===
    // Restricted holidays are kept so they count against quota
    let leaveDays = [];
    if (leaveDuration === 'full') {
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        if (!mandatoryDates.includes(d.toDateString())) {
          leaveDays.push(new Date(d));
        }
      }
    } else {
      // Half-day: check if the single date is a mandatory holiday
      if (!mandatoryDates.includes(start.toDateString())) {
        leaveDays.push(new Date(start));
      }
    }

    if (leaveDays.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'All selected dates are mandatory holidays. Leave cannot be applied.'
      });
    }

    // === Restricted Holiday Quota Check ===
    // Find which restricted holidays the user is trying to take leave on
    const restrictedDatesInLeave = leaveDays
      .map(d => d.toDateString())
      .filter(ds => restrictedDates.includes(ds));

    if (restrictedDatesInLeave.length > 0) {
      const currentYear = new Date(start).getFullYear();

      for (const rhDateStr of restrictedDatesInLeave) {
        // Find the Holiday doc for this date
        const rh = restrictedHolidays.find(
          h => h.date.toDateString() === rhDateStr
        );
        if (!rh) continue;

        // Check eligibility
        if (
          rh.applicableTo &&
          !rh.applicableTo.includes('all') &&
          !rh.applicableTo.includes(user.role)
        ) {
          return res.status(403).json({
            success: false,
            message: `You are not eligible for the restricted holiday: ${rh.name} (${rhDateStr})`
          });
        }

        // Check if user already availed this specific holiday
        const existingUsageForThisHoliday = await RestrictedHolidayUsage.findOne({
          employee: req.user.id,
          holiday: rh._id
        });

        if (existingUsageForThisHoliday) {
          return res.status(400).json({
            success: false,
            message: `You have already availed the restricted holiday: ${rh.name}`
          });
        }

        // Quota check
        const quota = rh.maxAllowed && rh.maxAllowed > 0 ? rh.maxAllowed : 2;

        const usedCount = await RestrictedHolidayUsage.countDocuments({
          employee: req.user.id,
          year: currentYear
        });

        if (usedCount >= quota) {
          return res.status(400).json({
            success: false,
            message: `You have exhausted your restricted holiday quota for ${currentYear} (${usedCount}/${quota} used). Cannot apply leave on ${rh.name}.`
          });
        }
      }
    }

    // === Check for overlapping full-day leaves ===
    const fullDayOverlap = await Leave.findOne({
      employee: req.user.id,
      status: { $in: ['pending', 'approved'] },
      leaveDuration: 'full',
      startDate: { $lte: end },
      endDate: { $gte: start }
    });

    if (fullDayOverlap) {
      return res.status(400).json({
        success: false,
        message: 'Cannot apply leave. Full-day leave already exists for these dates.'
      });
    }

    // === Check for overlapping half-day leaves ===
    if (leaveDuration === 'half') {
      const halfDayOverlap = await Leave.findOne({
        employee: req.user.id,
        status: { $in: ['pending', 'approved'] },
        leaveDuration: 'half',
        startDate: start,
        endDate: end,
        halfDayType
      });

      if (halfDayOverlap) {
        return res.status(400).json({
          success: false,
          message: `Cannot apply ${halfDayType} leave. Already exists for this date.`
        });
      }
    }

    // === Check attendance conflicts ===
    const attendance = await Attendance.find({
      employee: req.user.id,
      date: { $gte: start, $lte: end },
      'checkIn.time': { $ne: null }
    });

    if (attendance.length > 0) {
      if (leaveDuration === 'half') {
        const att = attendance.find(
          a => new Date(a.date).toDateString() === start.toDateString()
        );
        if (att && halfDayType === 'first_half') {
          return res.status(400).json({
            success: false,
            message: 'You already punched in today. First half leave not allowed, apply for second half instead.'
          });
        }
      } else {
        const punchedDates = attendance.map(a => a.date.toDateString());
        return res.status(400).json({
          success: false,
          message: `You already punched in on ${punchedDates.join(', ')}, leave not allowed for these dates.`
        });
      }
    }

    // === Calculate totalDays, excluding MANDATORY holidays ===
    // Pass mandatoryDates to getWorkingDays so restricted holidays still count
    let totalDays;
    try {
      totalDays = await getWorkingDays(
        leaveDays[0],
        leaveDays[leaveDays.length - 1],
        leaveDuration,
        halfDayType,
        leaveType,
        mandatoryDates
      );
    } catch (err) {
      return res.status(400).json({ success: false, message: err.message });
    }

    // === Check leave balance ===
    if (leaveType !== 'unpaid' && user.leaveBalance[leaveType] < totalDays) {
      return res.status(400).json({
        success: false,
        message: `Insufficient ${leaveType} leave. Available: ${user.leaveBalance[leaveType]} days`
      });
    }

    // === Create the leave ===
    const leave = await Leave.create({
      employee: req.user.id,
      leaveType,
      leaveDuration,
      halfDayType: leaveDuration === 'half' ? halfDayType : null,
      startDate: leaveDays[0],
      endDate: leaveDays[leaveDays.length - 1],
      totalDays,
      reason,
      documents: documents || []
    });

    await leave.populate(
      'employee',
      'firstName lastName employeeId email role department reportingManager'
    );

    // === Record restricted holiday usage (if any) ===
    let restrictedUsageRecorded = [];
    if (restrictedDatesInLeave.length > 0) {
      const currentYear = new Date(start).getFullYear();

      for (const rhDateStr of restrictedDatesInLeave) {
        const rh = restrictedHolidays.find(
          h => h.date.toDateString() === rhDateStr
        );
        if (!rh) continue;

        try {
          const usage = await RestrictedHolidayUsage.create({
            employee: req.user.id,
            holiday: rh._id,
            date: rh.date,
            year: currentYear,
            action: 'applied_leave'
          });
          restrictedUsageRecorded.push({
            holidayName: rh.name,
            date: rhDateStr
          });
          console.log(
            `[Leave] ✅ Restricted holiday usage recorded: ${rh.name} for user ${req.user.id}`
          );
        } catch (err) {
          // Duplicate key → already recorded (shouldn't happen due to earlier check)
          if (err.code !== 11000) {
            console.error('[Leave] Failed to record restricted holiday usage:', err);
          }
        }
      }
    }

    // === Get HR users for notification ===
    const hrUsers = await User.find({ role: 'hr', isActive: true }).select('_id');

    // === Get manager if employee has one ===
    let managerUsers = [];
    if (user.reportingManager) {
      const manager = await User.findById(user.reportingManager).select('_id');
      if (manager) managerUsers.push(manager._id);
    }

    // === Build restricted-holiday info for notification ===
    const restrictedInfo =
      restrictedUsageRecorded.length > 0
        ? ` [Includes ${restrictedUsageRecorded.length} restricted holiday: ${restrictedUsageRecorded
          .map(r => r.holidayName)
          .join(', ')}]`
        : '';

    // === Send role-based notifications ===
    // 1. Notify HR + manager
    await sendRoleBasedNotification({
      title: 'New Leave Application',
      message: `${leave.employee.firstName} ${leave.employee.lastName} (${leave.employee.employeeId}) has applied for ${leave.leaveType} leave from ${leave.startDate.toDateString()} to ${leave.endDate.toDateString()} (${leave.totalDays} days).${restrictedInfo}`,
      type: 'info',
      targetRoles: ['hr'],
      targetUsers: managerUsers,
      meta: {
        leaveId: leave._id,
        applicantId: req.user.id,
        applicantName: `${leave.employee.firstName} ${leave.employee.lastName}`,
        leaveType: leave.leaveType,
        startDate: leave.startDate,
        endDate: leave.endDate,
        totalDays: leave.totalDays,
        restrictedHolidays: restrictedUsageRecorded
      },
      createdBy: req.user._id
    });

    // 2. Notify the employee
    await sendRoleBasedNotification({
      title: 'Leave Application Submitted',
      message: `Your ${leave.leaveType} leave application for ${leave.startDate.toDateString()} to ${leave.endDate.toDateString()} has been submitted successfully.${restrictedInfo}`,
      type: 'success',
      targetUsers: [req.user.id],
      meta: {
        leaveId: leave._id,
        status: 'pending',
        leaveType: leave.leaveType,
        startDate: leave.startDate,
        endDate: leave.endDate,
        restrictedHolidays: restrictedUsageRecorded
      },
      createdBy: req.user._id
    });

    res.status(201).json({
      success: true,
      message: restrictedUsageRecorded.length
        ? `Leave applied successfully. Counted ${restrictedUsageRecorded.length} restricted holiday against your quota.`
        : 'Leave applied successfully. Holidays were skipped in calculation.',
      leave,
      restrictedHolidaysUsed: restrictedUsageRecorded
    });
  } catch (error) {
    console.error('[Leave] Apply Leave Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ================================
// 5. Cancel Leave
// ================================
exports.cancelLeave = async (req, res) => {
  try {
    const leave = await Leave.findById(req.params.id)
      .populate('employee', 'firstName lastName employeeId role reportingManager');

    if (!leave) return res.status(404).json({ success: false, message: 'Leave not found' });

    const isEmployee = leave.employee._id.toString() === req.user.id;
    const isManagerOrAbove = await canActOnLeave(req.user, leave.employee._id);

    if (!isEmployee && !isManagerOrAbove) {
      return res.status(403).json({ success: false, message: 'Not authorized to cancel this leave' });
    }

    if (isEmployee && !['pending', 'approved'].includes(leave.status)) {
      return res.status(400).json({ success: false, message: 'You can only cancel pending or approved leaves' });
    }

    // ✅ Restore balance if approved
    if (leave.status === 'approved' && leave.leaveType !== 'unpaid') {
      await User.findByIdAndUpdate(
        leave.employee._id,
        { $inc: { [`leaveBalance.${leave.leaveType}`]: leave.totalDays } }
      );
    }

    const oldStatus = leave.status;
    leave.status = 'cancelled';
    if (isManagerOrAbove) {
      leave.cancelledBy = req.user.id;
      leave.cancellationReason = req.body.cancellationReason || 'Cancelled by manager/HR';
    } else {
      leave.cancellationReason = req.body.cancellationReason || 'Cancelled by employee';
    }

    await leave.save();

    // === Send role-based notifications ===
    const actorName = isManagerOrAbove ?
      `${req.user.firstName} ${req.user.lastName} (${req.user.role})` :
      `${leave.employee.firstName} ${leave.employee.lastName}`;

    // 1. Notify HR about cancellation
    await sendRoleBasedNotification({
      title: 'Leave Cancelled',
      message: `${actorName} cancelled a ${leave.leaveType} leave application (${leave.startDate.toDateString()} to ${leave.endDate.toDateString()}). Previous status: ${oldStatus}`,
      type: 'warning',
      targetRoles: ['hr'],
      meta: {
        leaveId: leave._id,
        applicantId: leave.employee._id,
        applicantName: `${leave.employee.firstName} ${leave.employee.lastName}`,
        cancelledBy: req.user.id,
        cancelledByName: actorName,
        oldStatus,
        leaveType: leave.leaveType,
        cancellationReason: leave.cancellationReason
      },
      createdBy: req.user._id
    });

    // 2. Notify the employee (if cancelled by manager/HR)
    if (isManagerOrAbove) {
      await sendRoleBasedNotification({
        title: 'Leave Cancelled by Manager/HR',
        message: `Your ${leave.leaveType} leave application (${leave.startDate.toDateString()} to ${leave.endDate.toDateString()}) has been cancelled by ${req.user.firstName} ${req.user.lastName}. Reason: ${leave.cancellationReason}`,
        type: 'warning',
        targetUsers: [leave.employee._id],
        meta: {
          leaveId: leave._id,
          cancelledBy: req.user.id,
          cancelledByName: `${req.user.firstName} ${req.user.lastName}`,
          cancellationReason: leave.cancellationReason
        },
        createdBy: req.user._id
      });
    } else {
      // 3. Notify employee's manager (if cancelled by employee)
      const employee = await User.findById(leave.employee._id).select('reportingManager');
      if (employee.reportingManager) {
        await sendRoleBasedNotification({
          title: 'Employee Leave Cancelled',
          message: `${leave.employee.firstName} ${leave.employee.lastName} cancelled their ${leave.leaveType} leave application (${leave.startDate.toDateString()} to ${leave.endDate.toDateString()}).`,
          type: 'info',
          targetUsers: [employee.reportingManager],
          meta: {
            leaveId: leave._id,
            employeeId: leave.employee._id,
            employeeName: `${leave.employee.firstName} ${leave.employee.lastName}`,
            leaveType: leave.leaveType,
            cancellationReason: leave.cancellationReason
          },
          createdBy: req.user._id
        });
      }
    }

    res.status(200).json({ success: true, message: 'Leave cancelled', leave });
  } catch (error) {
    console.error('Cancel Leave Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ================================
// 7. Approve Leave
// ================================
exports.approveLeave = async (req, res) => {
  try {
    const leave = await Leave.findById(req.params.id)
      .populate('employee', 'firstName lastName employeeId email role');

    if (!leave)
      return res.status(404).json({ success: false, message: 'Leave not found' });

    if (leave.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Leave already processed' });
    }

    const allowed = await canActOnLeave(req.user, leave.employee._id);
    if (!allowed) {
      return res.status(403).json({ success: false, message: 'Not authorized to approve this leave' });
    }

    const approver = await User.findById(req.user.id);

    leave.status = 'approved';
    leave.approvedBy = req.user.id;
    leave.approvedAt = Date.now();
    await leave.save();

    // Deduct leave balance
    if (leave.leaveType !== 'unpaid') {
      if (leave.leaveType === 'combo') {
        await User.findByIdAndUpdate(
          leave.employee._id,
          { $inc: { 'leaveBalance.combo': -leave.totalDays } }
        );
      } else {
        await User.findByIdAndUpdate(
          leave.employee._id,
          { $inc: { [`leaveBalance.${leave.leaveType}`]: -leave.totalDays } }
        );
      }
    }

    // Mark attendance
    const current = new Date(leave.startDate);
    while (current <= leave.endDate) {
      const attendanceData = {
        employee: leave.employee._id,
        date: new Date(current),
        status: leave.leaveDuration === 'half'
          ? (leave.halfDayType === 'first_half' ? 'half-day-first' : 'half-day-second')
          : 'on-leave'
      };

      await Attendance.findOneAndUpdate(
        { employee: leave.employee._id, date: new Date(current) },
        attendanceData,
        { upsert: true }
      );

      current.setDate(current.getDate() + 1);
    }

    // === Send role-based notifications ===

    // 1. Notify the employee
    await sendRoleBasedNotification({
      title: 'Leave Approved',
      message: `Your ${leave.leaveType} leave application (${leave.startDate.toDateString()} to ${leave.endDate.toDateString()}) has been approved by ${approver.firstName} ${approver.lastName}.`,
      type: 'success',
      targetUsers: [leave.employee._id],
      meta: {
        leaveId: leave._id,
        approvedBy: req.user.id,
        approvedByName: `${approver.firstName} ${approver.lastName}`,
        leaveType: leave.leaveType,
        startDate: leave.startDate,
        endDate: leave.endDate,
        totalDays: leave.totalDays
      },
      createdBy: req.user._id
    });

    // 2. Notify HR if approved by manager
    if (req.user.role === 'manager') {
      await sendRoleBasedNotification({
        title: 'Leave Approved by Manager',
        message: `${approver.firstName} ${approver.lastName} (Manager) approved ${leave.employee.firstName} ${leave.employee.lastName}'s ${leave.leaveType} leave (${leave.startDate.toDateString()} to ${leave.endDate.toDateString()}).`,
        type: 'info',
        targetRoles: ['hr'],
        meta: {
          leaveId: leave._id,
          employeeId: leave.employee._id,
          employeeName: `${leave.employee.firstName} ${leave.employee.lastName}`,
          approvedBy: req.user.id,
          approvedByName: `${approver.firstName} ${approver.lastName}`,
          leaveType: leave.leaveType
        },
        createdBy: req.user._id
      });
    }

    res.status(200).json({ success: true, message: 'Leave approved', leave });

  } catch (error) {
    console.error('Approve Leave Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ================================
// 8. Reject Leave
// ================================
exports.rejectLeave = async (req, res) => {
  try {
    const { rejectionReason } = req.body;
    const leave = await Leave.findById(req.params.id)
      .populate('employee', 'firstName lastName employeeId email role');

    if (!leave) return res.status(404).json({ success: false, message: 'Leave not found' });

    if (leave.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Leave already processed' });
    }

    const allowed = await canActOnLeave(req.user, leave.employee._id);
    if (!allowed) {
      return res.status(403).json({ success: false, message: 'Not authorized to reject this leave' });
    }

    const rejecter = await User.findById(req.user.id);

    leave.status = 'rejected';
    leave.approvedBy = req.user.id;
    leave.approvedAt = Date.now();
    leave.rejectionReason = rejectionReason || 'No reason provided';
    await leave.save();

    // === Send role-based notifications ===

    // 1. Notify the employee
    await sendRoleBasedNotification({
      title: 'Leave Rejected',
      message: `Your ${leave.leaveType} leave application (${leave.startDate.toDateString()} to ${leave.endDate.toDateString()}) has been rejected by ${rejecter.firstName} ${rejecter.lastName}. Reason: ${leave.rejectionReason}`,
      type: 'error',
      targetUsers: [leave.employee._id],
      meta: {
        leaveId: leave._id,
        rejectedBy: req.user.id,
        rejectedByName: `${rejecter.firstName} ${rejecter.lastName}`,
        rejectionReason: leave.rejectionReason,
        leaveType: leave.leaveType,
        startDate: leave.startDate,
        endDate: leave.endDate
      },
      createdBy: req.user._id
    });

    // 2. Notify HR if rejected by manager
    if (req.user.role === 'manager') {
      await sendRoleBasedNotification({
        title: 'Leave Rejected by Manager',
        message: `${rejecter.firstName} ${rejecter.lastName} (Manager) rejected ${leave.employee.firstName} ${leave.employee.lastName}'s ${leave.leaveType} leave. Reason: ${leave.rejectionReason}`,
        type: 'info',
        targetRoles: ['hr'],
        meta: {
          leaveId: leave._id,
          employeeId: leave.employee._id,
          employeeName: `${leave.employee.firstName} ${leave.employee.lastName}`,
          rejectedBy: req.user.id,
          rejectedByName: `${rejecter.firstName} ${rejecter.lastName}`,
          rejectionReason: leave.rejectionReason,
          leaveType: leave.leaveType
        },
        createdBy: req.user._id
      });
    }

    res.status(200).json({ success: true, message: 'Leave rejected', leave });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ================================
// 2. Get My Leaves (remains the same)
// ================================
exports.getMyLeaves = async (req, res) => {
  try {
    const { status, year } = req.query;
    const query = { employee: req.user.id };

    if (status) query.status = status;
    if (year) {
      const start = new Date(year, 0, 1);
      const end = new Date(year, 11, 31, 23, 59, 59);
      query.startDate = { $gte: start, $lte: end };
    }

    const leaves = await Leave.find(query)
      .sort({ createdAt: -1 })
      .populate('approvedBy', 'firstName lastName email');

    res.status(200).json({
      success: true,
      count: leaves.length,
      leaves
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ================================
// 3. Get Single Leave (remains the same)
// ================================
exports.getLeave = async (req, res) => {
  try {
    const leave = await Leave.findById(req.params.id)
      .populate('employee', 'firstName lastName employeeId email profilePicture department')
      .populate('employee.department', 'name')
      .populate('approvedBy', 'firstName lastName email');

    if (!leave) {
      return res.status(404).json({ success: false, message: 'Leave not found' });
    }

    const isOwner = leave.employee._id.toString() === req.user.id;
    const allowed = isOwner || await canActOnLeave(req.user, leave.employee._id);

    if (!allowed) {
      return res.status(403).json({ success: false, message: 'Not authorized to view this leave' });
    }

    res.status(200).json({ success: true, leave });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ================================
// 4. Get Leave Balance (remains the same)
// ================================
exports.getLeaveBalance = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('leaveBalance');
    res.status(200).json({ success: true, leaveBalance: user.leaveBalance });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ================================
// 6. Get Pending Leaves (Manager/HR) (remains the same)
// ================================
exports.getPendingLeaves = async (req, res) => {
  try {
    const { department } = req.query;
    let query = { status: 'pending' };

    if (req.user.role === 'manager') {
      const team = await User.find({ reportingManager: req.user.id }).select('_id');
      query.employee = { $in: team.map(t => t._id) };
    }

    if (department) {
      const deptUsers = await User.find({ department }).select('_id');
      query.employee = { $in: deptUsers.map(u => u._id) };
    }

    const leaves = await Leave.find(query)
      .sort({ createdAt: -1 })
      .populate('employee', 'firstName lastName employeeId email department profilePicture')
      .populate('employee.department', 'name');

    res.status(200).json({ success: true, count: leaves.length, leaves });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ================================
// 9. Get All Leaves (HR/Manager) (remains the same)
// ================================
exports.getAllLeaves = async (req, res) => {
  try {
    const { status, department, year } = req.query;
    let query = {};

    if (status) query.status = status;
    if (department) {
      const users = await User.find({ department }).select('_id');
      query.employee = { $in: users.map(u => u._id) };
    }
    if (year) {
      const start = new Date(year, 0, 1);
      const end = new Date(year, 11, 31, 23, 59, 59);
      query.startDate = { $gte: start, $lte: end };
    }

    if (req.user.role === 'manager') {
      const team = await User.find({ reportingManager: req.user.id }).select('_id');
      query.employee = { $in: team.map(t => t._id) };
    }

    const leaves = await Leave.find(query)
      .sort({ createdAt: -1 })
      .populate('employee', 'firstName lastName employeeId email department profilePicture')
      .populate('approvedBy', 'firstName lastName email');

    res.status(200).json({ success: true, count: leaves.length, leaves });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ---------------------------------------------------
// Helper: count *working* days (skip Sat/Sun + holidays)
// ---------------------------------------------------
// ---------------------------------------------------
// Helper: count *working* days
// Skips weekends (Sat/Sun) and MANDATORY holidays only.
// Restricted holidays are COUNTED (they consume quota separately).
// ---------------------------------------------------
const getWorkingDays = async (
  start,
  end,
  leaveDuration,
  halfDayType,
  leaveType,
  mandatoryDates = []   // array of Date.toDateString() strings
) => {
  if (!(start instanceof Date) || !(end instanceof Date) || isNaN(start) || isNaN(end)) {
    throw new Error('Invalid date range');
  }

  if (start > end) throw new Error('Start date cannot be after end date');

  // Combo leave cannot be half-day
  if (leaveType === 'combo' && leaveDuration === 'half') {
    throw new Error('Combo leave cannot be half-day.');
  }

  const startDate = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const endDate   = new Date(end.getFullYear(), end.getMonth(), end.getDate());

  // Build a Set of mandatory holiday date strings for O(1) lookup
  // Both sides use toDateString() so they match reliably
  const mandatoryHolidaySet = new Set(
    mandatoryDates.map(d => (d instanceof Date ? d.toDateString() : String(d)))
  );

  let workingDays = 0;
  const cur = new Date(startDate);

  console.log(
    '[WorkingDays] Calculating working days from',
    startDate.toDateString(),
    'to',
    endDate.toDateString()
  );
  console.log('[WorkingDays] Mandatory holiday set:', [...mandatoryHolidaySet]);

  while (cur <= endDate) {
    const dayStr = cur.toDateString(); // ✅ same format as mandatoryDates entries
    const dayOfWeek = cur.getDay();    // 0 = Sunday, 6 = Saturday

    if (dayOfWeek === 0 || dayOfWeek === 6) {
      console.log(`[WorkingDays] ${dayStr} is weekend, skipped`);
    } else if (mandatoryHolidaySet.has(dayStr)) {
      console.log(`[WorkingDays] ${dayStr} is MANDATORY holiday, skipped`);
    } else {
      workingDays++;
      console.log(
        `[WorkingDays] ${dayStr} counted as working day (total so far: ${workingDays})`
      );
    }

    cur.setDate(cur.getDate() + 1);
  }

  // Handle half-day
  if (leaveDuration === 'half') {
    if (startDate.toDateString() !== endDate.toDateString()) {
      throw new Error('Half-day leave can only be applied for a single day.');
    }
    if (!['first_half', 'second_half'].includes(halfDayType)) {
      throw new Error('halfDayType must be "first_half" or "second_half"');
    }
    console.log('[WorkingDays] Half-day leave applied: 0.5 days');
    return 0.5;
  }

  console.log('[WorkingDays] Total working days:', workingDays);
  return workingDays;
};