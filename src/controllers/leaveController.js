const moment = require('moment-timezone');
const Leave = require('../models/Leave');
const User = require('../models/User');
const Attendance = require('../models/Attendance');
const Holiday = require('../models/Holiday');
const Notification = require('../models/Notification');
const RestrictedHolidayUsage = require('../models/RestrictedHolidayUsage');
const ComboOff = require('../models/ComboOff');
const { canActOnLeave } = require('../utils/leavePermissions');
const { ACCESS_ROLES } = require('../constants/roles');
const TZ = 'Asia/Kolkata';

// ====================================
// HELPERS: IST date utilities
// ====================================
const parseIST = (dateInput) => moment.tz(dateInput, TZ).startOf('day');
const toISTKey = (dateInput) => moment(dateInput).tz(TZ).format('YYYY-MM-DD');
const toISTDisplay = (dateInput) => moment(dateInput).tz(TZ).format('YYYY-MM-DD');

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
    createdBy,
  } = data;

  const notifications = [];

  if (Array.isArray(targetUsers) && targetUsers.length > 0) {
    const users = await User.find({ _id: { $in: targetUsers } }).select('_id role');
    notifications.push(
      ...users.map((user) => ({
        title,
        message,
        type,
        user: user._id,
        role: user.role,
        meta,
        createdBy,
        createdAt: new Date(),
      }))
    );
  }

  if (Array.isArray(targetRoles) && targetRoles.length > 0) {
    for (const role of targetRoles) {
      if (role === 'all') {
        const users = await User.find({ isActive: true }).select('_id role');
        notifications.push(
          ...users.map((u) => ({
            title,
            message,
            type,
            user: u._id,
            role: u.role,
            isGlobal: true,
            meta,
            createdBy,
            createdAt: new Date(),
          }))
        );
      } else {
        const users = await User.find({ role, isActive: true }).select('_id role');
        notifications.push(
          ...users.map((u) => ({
            title,
            message,
            type,
            user: u._id,
            role: u.role,
            meta,
            createdBy,
            createdAt: new Date(),
          }))
        );
      }
    }
  }

  if (notifications.length > 0) {
    await Notification.insertMany(notifications);
  }
};

// ====================================
// HELPER: Get target roles for leave notifications
// ====================================
const getNotificationTargetsForLeave = (userRole, actionType) => {
  const targets = {
    'leave:apply': {
      superadmin: ['hr', 'superadmin'],
      hr: ['hr'],
      manager: ['hr', 'manager'],
      employee: ['hr', 'manager'],
    },
    'leave:approved': { superadmin: [], hr: [], manager: [], employee: [] },
    'leave:rejected': { superadmin: [], hr: [], manager: [], employee: [] },
    'leave:cancelled': {
      superadmin: ['hr'],
      hr: ['hr'],
      manager: ['hr', 'manager'],
      employee: ['hr', 'manager'],
    },
  };
  return targets[actionType]?.[userRole] || [];
};

// ====================================
// HELPER: Working days (weekend + mandatory holiday aware)
// ====================================
const getWorkingDays = async (
  startInput,
  endInput,
  leaveDuration,
  halfDayType,
  leaveType,
  mandatoryDates = []
) => {
  const startM = moment(startInput).tz(TZ).startOf('day');
  const endM = moment(endInput).tz(TZ).startOf('day');

  if (!startM.isValid() || !endM.isValid()) {
    throw new Error('Invalid date range');
  }
  if (startM.isAfter(endM)) {
    throw new Error('Start date cannot be after end date');
  }
  if (leaveType === 'combo' && leaveDuration === 'half') {
    throw new Error('Combo leave cannot be half-day.');
  }

  // Normalize mandatory holiday keys (YYYY-MM-DD in IST)
  const mandatorySet = new Set(
    mandatoryDates.map((d) => toISTKey(d))
  );

  // Half-day
  if (leaveDuration === 'half') {
    if (startM.format('YYYY-MM-DD') !== endM.format('YYYY-MM-DD')) {
      throw new Error('Half-day leave can only be applied for a single day.');
    }
    if (!['first_half', 'second_half'].includes(halfDayType)) {
      throw new Error('halfDayType must be "first_half" or "second_half"');
    }
    return 0.5;
  }

  let workingDays = 0;
  const cur = startM.clone();

  while (cur.isSameOrBefore(endM, 'day')) {
    const dow = cur.day(); // 0 = Sunday, 6 = Saturday
    const key = cur.format('YYYY-MM-DD');
    const isWeekend = dow === 0 || dow === 6;
    const isMandatory = mandatorySet.has(key);

    if (!isWeekend && !isMandatory) workingDays++;
    cur.add(1, 'day');
  }

  return workingDays;
};

// ====================================
// 1. Apply for Leave
// ====================================
exports.applyLeave = async (req, res) => {
  try {
    const {
      startDate,
      endDate,
      reason,
      documents,
      leaveDuration,
      halfDayType,
      leaveType: requestedType,
    } = req.body;

    const leaveType = requestedType === 'combo' ? 'combo' : 'casual';

    if (!startDate || !endDate || !leaveDuration) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    // === Parse as IST midnight ===
    const start = parseIST(startDate);
    const end = parseIST(endDate);

    if (!start.isValid() || !end.isValid() || start.isAfter(end)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid date range. End date must be after start date.',
      });
    }

    // === Half-day validation ===
    if (leaveDuration === 'half') {
      if (!halfDayType || !['first_half', 'second_half'].includes(halfDayType)) {
        return res.status(400).json({
          success: false,
          message: 'halfDayType must be "first_half" or "second_half"',
        });
      }
      if (start.format('YYYY-MM-DD') !== end.format('YYYY-MM-DD')) {
        return res.status(400).json({
          success: false,
          message: 'Half-day leave can only be applied for a single day.',
        });
      }
      if (leaveType === 'combo') {
        return res.status(400).json({
          success: false,
          message: 'Combo leave cannot be half-day.',
        });
      }
    }

    // === Fetch holidays in range ===
    const holidays = await Holiday.find({
      date: { $gte: start.toDate(), $lte: end.endOf('day').toDate() },
      isActive: true,
    });

    const mandatoryHolidays = holidays.filter((h) => h.category === 'Mandatory');
    const restrictedHolidays = holidays.filter((h) => h.category === 'Restricted');

    const mandatoryDates = mandatoryHolidays.map((h) => toISTKey(h.date));
    const restrictedDates = restrictedHolidays.map((h) => toISTKey(h.date));

    // === Fetch user & probation check ===
    const user = await User.findById(req.user.id);
    const today = moment().tz(TZ);

    if (user.probationEndDate && today.isBefore(moment(user.probationEndDate).tz(TZ))) {
      return res.status(400).json({
        success: false,
        message: 'You are on probation. Leave is not allowed until probation completes.',
      });
    }

    // === Build leaveDays (skip mandatory holidays) ===
    const leaveDays = [];
    if (leaveDuration === 'full') {
      const cur = start.clone();
      while (cur.isSameOrBefore(end, 'day')) {
        if (!mandatoryDates.includes(cur.format('YYYY-MM-DD'))) {
          leaveDays.push(cur.clone());
        }
        cur.add(1, 'day');
      }
    } else {
      if (!mandatoryDates.includes(start.format('YYYY-MM-DD'))) {
        leaveDays.push(start.clone());
      }
    }

    if (leaveDays.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'All selected dates are mandatory holidays. Leave cannot be applied.',
      });
    }

    // === Restricted Holiday Quota Check ===
    const restrictedDatesInLeave = leaveDays
      .map((d) => d.format('YYYY-MM-DD'))
      .filter((ds) => restrictedDates.includes(ds));

    if (restrictedDatesInLeave.length > 0) {
      const currentYear = start.year();

      for (const rhDateStr of restrictedDatesInLeave) {
        const rh = restrictedHolidays.find(
          (h) => toISTKey(h.date) === rhDateStr
        );
        if (!rh) continue;

        if (
          rh.applicableTo &&
          !rh.applicableTo.includes('all') &&
          !rh.applicableTo.includes(user.role)
        ) {
          return res.status(403).json({
            success: false,
            message: `You are not eligible for the restricted holiday: ${rh.name} (${rhDateStr})`,
          });
        }

        const existingUsageForThisHoliday = await RestrictedHolidayUsage.findOne({
          employee: req.user.id,
          holiday: rh._id,
        });

        if (existingUsageForThisHoliday) {
          return res.status(400).json({
            success: false,
            message: `You have already availed the restricted holiday: ${rh.name}`,
          });
        }

        const quota = rh.maxAllowed && rh.maxAllowed > 0 ? rh.maxAllowed : 2;
        const usedCount = await RestrictedHolidayUsage.countDocuments({
          employee: req.user.id,
          year: currentYear,
        });

        if (usedCount >= quota) {
          return res.status(400).json({
            success: false,
            message: `You have exhausted your restricted holiday quota for ${currentYear} (${usedCount}/${quota} used). Cannot apply leave on ${rh.name}.`,
          });
        }
      }
    }

    // === Overlap checks ===
    const startDateObj = leaveDays[0].toDate();
    const endDateObj = leaveDays[leaveDays.length - 1].toDate();

    const fullDayOverlap = await Leave.findOne({
      employee: req.user.id,
      status: { $in: ['pending', 'approved'] },
      leaveDuration: 'full',
      startDate: { $lte: endDateObj },
      endDate: { $gte: startDateObj },
    });

    if (fullDayOverlap) {
      return res.status(400).json({
        success: false,
        message: 'Cannot apply leave. Full-day leave already exists for these dates.',
      });
    }

    if (leaveDuration === 'half') {
      const halfDayOverlap = await Leave.findOne({
        employee: req.user.id,
        status: { $in: ['pending', 'approved'] },
        leaveDuration: 'half',
        startDate: startDateObj,
        endDate: endDateObj,
        halfDayType,
      });

      if (halfDayOverlap) {
        return res.status(400).json({
          success: false,
          message: `Cannot apply ${halfDayType} leave. Already exists for this date.`,
        });
      }
    }

    // === Attendance conflicts ===
    const attendance = await Attendance.find({
      employee: req.user.id,
      date: { $gte: startDateObj, $lte: end.endOf('day').toDate() },
      'checkIn.time': { $ne: null },
    });

    if (attendance.length > 0) {
      if (leaveDuration === 'half') {
        const att = attendance.find(
          (a) => toISTKey(a.date) === start.format('YYYY-MM-DD')
        );
        if (att && halfDayType === 'first_half') {
          return res.status(400).json({
            success: false,
            message:
              'You already punched in today. First half leave not allowed, apply for second half instead.',
          });
        }
      } else {
        const punchedDates = attendance.map((a) => toISTKey(a.date));
        return res.status(400).json({
          success: false,
          message: `You already punched in on ${punchedDates.join(', ')}, leave not allowed for these dates.`,
        });
      }
    }

    // === Calculate totalDays ===
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

    // === Balance check ===
    const availableBalance = user.leaveBalance?.[leaveType] || 0;
    if (availableBalance < totalDays) {
      return res.status(400).json({
        success: false,
        message: `Insufficient ${leaveType} leave. Available: ${availableBalance} day(s), requested: ${totalDays}`,
      });
    }

    // === Create the leave ===
    const leave = await Leave.create({
      employee: req.user.id,
      leaveType,
      leaveDuration,
      halfDayType: leaveDuration === 'half' ? halfDayType : null,
      startDate: startDateObj,
      endDate: endDateObj,
      totalDays,
      reason,
      documents: documents || [],
    });

    await leave.populate(
      'employee',
      'firstName lastName employeeId email role department reportingManager'
    );

    // === Record restricted holiday usage ===
    const restrictedUsageRecorded = [];
    if (restrictedDatesInLeave.length > 0) {
      const currentYear = start.year();
      for (const rhDateStr of restrictedDatesInLeave) {
        const rh = restrictedHolidays.find((h) => toISTKey(h.date) === rhDateStr);
        if (!rh) continue;

        try {
          await RestrictedHolidayUsage.create({
            employee: req.user.id,
            holiday: rh._id,
            date: rh.date,
            year: currentYear,
            action: 'applied_leave',
          });
          restrictedUsageRecorded.push({ holidayName: rh.name, date: rhDateStr });
        } catch (err) {
          if (err.code !== 11000) {
            console.error('[Leave] Failed to record restricted holiday usage:', err);
          }
        }
      }
    }

    // === Notifications ===
    const managerUsers = [];
    if (user.reportingManager) {
      const manager = await User.findById(user.reportingManager).select('_id');
      if (manager) managerUsers.push(manager._id);
    }

    const restrictedInfo =
      restrictedUsageRecorded.length > 0
        ? ` [Includes ${restrictedUsageRecorded.length} restricted holiday: ${restrictedUsageRecorded
            .map((r) => r.holidayName)
            .join(', ')}]`
        : '';

    await sendRoleBasedNotification({
      title: 'New Leave Application',
      message: `${leave.employee.firstName} ${leave.employee.lastName} (${leave.employee.employeeId}) has applied for ${leave.leaveType} leave from ${toISTDisplay(leave.startDate)} to ${toISTDisplay(leave.endDate)} (${leave.totalDays} days).${restrictedInfo}`,
      type: 'info',
      targetRoles: ['hr'],
      targetUsers: managerUsers,
      meta: {
        leaveId: leave._id,
        applicantId: req.user.id,
        applicantName: `${leave.employee.firstName} ${leave.employee.lastName}`,
        leaveType: leave.leaveType,
        startDate: toISTDisplay(leave.startDate),
        endDate: toISTDisplay(leave.endDate),
        totalDays: leave.totalDays,
        restrictedHolidays: restrictedUsageRecorded,
      },
      createdBy: req.user._id,
    });

    await sendRoleBasedNotification({
      title: 'Leave Application Submitted',
      message: `Your ${leave.leaveType} leave application for ${toISTDisplay(leave.startDate)} to ${toISTDisplay(leave.endDate)} has been submitted successfully.${restrictedInfo}`,
      type: 'success',
      targetUsers: [req.user.id],
      meta: {
        leaveId: leave._id,
        status: 'pending',
        leaveType: leave.leaveType,
        startDate: toISTDisplay(leave.startDate),
        endDate: toISTDisplay(leave.endDate),
        restrictedHolidays: restrictedUsageRecorded,
      },
      createdBy: req.user._id,
    });

    // === Serialize leave with IST dates ===
    const leaveObj = leave.toObject();
    leaveObj.startDate = toISTDisplay(leave.startDate);
    leaveObj.endDate = toISTDisplay(leave.endDate);

    res.status(201).json({
      success: true,
      message: restrictedUsageRecorded.length
        ? `Leave applied successfully. Counted ${restrictedUsageRecorded.length} restricted holiday against your quota.`
        : 'Leave applied successfully. Holidays were skipped in calculation.',
      leave: leaveObj,
      restrictedHolidaysUsed: restrictedUsageRecorded,
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
    const leave = await Leave.findById(req.params.id).populate(
      'employee',
      'firstName lastName employeeId role reportingManager'
    );

    if (!leave) {
      return res.status(404).json({ success: false, message: 'Leave not found' });
    }

    if (leave.employee._id.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Only the employee who applied can cancel this leave. Use reject instead.',
      });
    }

    if (!['pending', 'approved'].includes(leave.status)) {
      return res.status(400).json({
        success: false,
        message: 'You can only cancel pending or approved leaves',
      });
    }

    if (leave.status === 'approved') {
      await User.findByIdAndUpdate(leave.employee._id, {
        $inc: { [`leaveBalance.${leave.leaveType}`]: leave.totalDays },
      });

      if (leave.leaveType === 'combo') {
        await ComboOff.updateMany(
          { usedInLeave: leave._id },
          { $set: { usedInLeave: null } }
        );
      }
    }

    const oldStatus = leave.status;
    leave.status = 'cancelled';
    leave.cancellationReason = req.body.cancellationReason || 'Cancelled by employee';
    await leave.save();

    const employeeName = `${leave.employee.firstName} ${leave.employee.lastName}`;
    const startStr = toISTDisplay(leave.startDate);
    const endStr = toISTDisplay(leave.endDate);

    await sendRoleBasedNotification({
      title: 'Leave Cancelled by Employee',
      message: `${employeeName} cancelled their ${leave.leaveType} leave application (${startStr} to ${endStr}). Previous status: ${oldStatus}`,
      type: 'warning',
      targetRoles: ['hr'],
      meta: {
        leaveId: leave._id,
        applicantId: leave.employee._id,
        applicantName: employeeName,
        oldStatus,
        leaveType: leave.leaveType,
        cancellationReason: leave.cancellationReason,
      },
      createdBy: req.user._id,
    });

    const employee = await User.findById(leave.employee._id).select('reportingManager');
    if (employee?.reportingManager) {
      await sendRoleBasedNotification({
        title: 'Employee Leave Cancelled',
        message: `${employeeName} cancelled their ${leave.leaveType} leave application (${startStr} to ${endStr}).`,
        type: 'info',
        targetUsers: [employee.reportingManager],
        meta: {
          leaveId: leave._id,
          employeeId: leave.employee._id,
          employeeName,
          leaveType: leave.leaveType,
          cancellationReason: leave.cancellationReason,
        },
        createdBy: req.user._id,
      });
    }

    const leaveObj = leave.toObject();
    leaveObj.startDate = startStr;
    leaveObj.endDate = endStr;

    res.status(200).json({ success: true, message: 'Leave cancelled', leave: leaveObj });
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
    const leave = await Leave.findById(req.params.id).populate(
      'employee',
      'firstName lastName employeeId email role'
    );

    if (!leave) {
      return res.status(404).json({ success: false, message: 'Leave not found' });
    }

    if (leave.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Leave already processed' });
    }

    const allowed = await canActOnLeave(req.user, leave.employee._id);
    if (!allowed) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to approve this leave',
      });
    }

    const approver = await User.findById(req.user.id || req.user._id);

    const employeeDoc = await User.findById(leave.employee._id).select('leaveBalance');
    const currentBalance = employeeDoc.leaveBalance?.[leave.leaveType] || 0;

    if (currentBalance < leave.totalDays) {
      return res.status(400).json({
        success: false,
        message: `Employee has insufficient ${leave.leaveType} balance. Available: ${currentBalance}, required: ${leave.totalDays}`,
      });
    }

    leave.status = 'approved';
    leave.approvedBy = req.user.id || req.user._id;
    leave.approvedAt = Date.now();
    await leave.save();

    await User.findByIdAndUpdate(leave.employee._id, {
      $inc: { [`leaveBalance.${leave.leaveType}`]: -leave.totalDays },
    });

    // Combo Off
    if (leave.leaveType === 'combo') {
      let remaining = leave.totalDays;
      while (remaining > 0) {
        const comboCredit = await ComboOff.findOne({
          employee: leave.employee._id,
          status: 'approved',
          isCredited: true,
          usedInLeave: null,
        }).sort({ workDate: 1 });

        if (!comboCredit) break;

        comboCredit.usedInLeave = leave._id;
        await comboCredit.save();
        remaining -= 1;
      }
    }

    // Mark attendance — iterate in IST days
    const cur = moment(leave.startDate).tz(TZ).startOf('day');
    const last = moment(leave.endDate).tz(TZ).startOf('day');

    while (cur.isSameOrBefore(last, 'day')) {
      const attendanceData = {
        employee: leave.employee._id,
        date: cur.toDate(),
        status:
          leave.leaveDuration === 'half'
            ? leave.halfDayType === 'first_half'
              ? 'half-day-first'
              : 'half-day-second'
            : 'on-leave',
      };

      await Attendance.findOneAndUpdate(
        { employee: leave.employee._id, date: cur.toDate() },
        attendanceData,
        { upsert: true }
      );

      cur.add(1, 'day');
    }

    const startStr = toISTDisplay(leave.startDate);
    const endStr = toISTDisplay(leave.endDate);

    await sendRoleBasedNotification({
      title: 'Leave Approved',
      message: `Your ${leave.leaveType} leave application (${startStr} to ${endStr}) has been approved by ${approver.firstName} ${approver.lastName}.`,
      type: 'success',
      targetUsers: [leave.employee._id],
      meta: {
        leaveId: leave._id,
        approvedBy: req.user.id || req.user._id,
        approvedByName: `${approver.firstName} ${approver.lastName}`,
        leaveType: leave.leaveType,
        startDate: startStr,
        endDate: endStr,
        totalDays: leave.totalDays,
      },
      createdBy: req.user._id || req.user.id,
    });

    if (req.user.role === ACCESS_ROLES.MANAGER) {
      await sendRoleBasedNotification({
        title: 'Leave Approved by Manager',
        message: `${approver.firstName} ${approver.lastName} (Manager) approved ${leave.employee.firstName} ${leave.employee.lastName}'s ${leave.leaveType} leave (${startStr} to ${endStr}).`,
        type: 'info',
        targetRoles: ['hr_admin'],
        meta: {
          leaveId: leave._id,
          employeeId: leave.employee._id,
          employeeName: `${leave.employee.firstName} ${leave.employee.lastName}`,
          approvedBy: req.user.id || req.user._id,
          approvedByName: `${approver.firstName} ${approver.lastName}`,
          leaveType: leave.leaveType,
        },
        createdBy: req.user._id || req.user.id,
      });
    }

    const leaveObj = leave.toObject();
    leaveObj.startDate = startStr;
    leaveObj.endDate = endStr;

    res.status(200).json({ success: true, message: 'Leave approved', leave: leaveObj });
  } catch (error) {
    console.error('[APPROVE LEAVE] ERROR:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ================================
// 8. Reject Leave
// ================================
exports.rejectLeave = async (req, res) => {
  try {
    const { rejectionReason } = req.body;
    const leave = await Leave.findById(req.params.id).populate(
      'employee',
      'firstName lastName employeeId email role'
    );

    if (!leave) return res.status(404).json({ success: false, message: 'Leave not found' });

    if (leave.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Leave already processed' });
    }

    const allowed = await canActOnLeave(req.user, leave.employee._id);
    if (!allowed) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to reject this leave',
      });
    }

    const rejecter = await User.findById(req.user.id);

    leave.status = 'rejected';
    leave.approvedBy = req.user.id;
    leave.approvedAt = Date.now();
    leave.rejectionReason = rejectionReason || 'No reason provided';
    await leave.save();

    const startStr = toISTDisplay(leave.startDate);
    const endStr = toISTDisplay(leave.endDate);

    await sendRoleBasedNotification({
      title: 'Leave Rejected',
      message: `Your ${leave.leaveType} leave application (${startStr} to ${endStr}) has been rejected by ${rejecter.firstName} ${rejecter.lastName}. Reason: ${leave.rejectionReason}`,
      type: 'error',
      targetUsers: [leave.employee._id],
      meta: {
        leaveId: leave._id,
        rejectedBy: req.user.id,
        rejectedByName: `${rejecter.firstName} ${rejecter.lastName}`,
        rejectionReason: leave.rejectionReason,
        leaveType: leave.leaveType,
        startDate: startStr,
        endDate: endStr,
      },
      createdBy: req.user._id,
    });

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
          leaveType: leave.leaveType,
        },
        createdBy: req.user._id,
      });
    }

    const leaveObj = leave.toObject();
    leaveObj.startDate = startStr;
    leaveObj.endDate = endStr;

    res.status(200).json({ success: true, message: 'Leave rejected', leave: leaveObj });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ================================
// 2. Get My Leaves
// ================================
exports.getMyLeaves = async (req, res) => {
  try {
    const { status, year } = req.query;
    const query = { employee: req.user.id };

    if (status) query.status = status;
    if (year) {
      const start = moment.tz(`${year}-01-01`, TZ).startOf('day').toDate();
      const end = moment.tz(`${year}-12-31`, TZ).endOf('day').toDate();
      query.startDate = { $gte: start, $lte: end };
    }

    const leaves = await Leave.find(query)
      .sort({ createdAt: -1 })
      .populate('approvedBy', 'firstName lastName email');

    res.status(200).json({ success: true, count: leaves.length, leaves });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ================================
// 3. Get Single Leave
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
    const allowed = isOwner || (await canActOnLeave(req.user, leave.employee._id));

    if (!allowed) {
      return res.status(403).json({ success: false, message: 'Not authorized to view this leave' });
    }

    res.status(200).json({ success: true, leave });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ================================
// 4. Get Leave Balance
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
// 6. Get Pending Leaves (Manager/HR)
// ================================
exports.getPendingLeaves = async (req, res) => {
  try {
    const { department } = req.query;
    const query = { status: 'pending' };

    if (req.user.role === 'manager') {
      const team = await User.find({ reportingManager: req.user.id }).select('_id');
      query.employee = { $in: team.map((t) => t._id) };
    }

    if (department) {
      const deptUsers = await User.find({ department }).select('_id');
      query.employee = { $in: deptUsers.map((u) => u._id) };
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
// 9. Get All Leaves (HR/Manager)
// ================================
exports.getAllLeaves = async (req, res) => {
  try {
    const { status, department, year } = req.query;
    const query = {};

    if (status) query.status = status;
    if (department) {
      const users = await User.find({ department }).select('_id');
      query.employee = { $in: users.map((u) => u._id) };
    }
    if (year) {
      const start = moment.tz(`${year}-01-01`, TZ).startOf('day').toDate();
      const end = moment.tz(`${year}-12-31`, TZ).endOf('day').toDate();
      query.startDate = { $gte: start, $lte: end };
    }

    if (req.user.role === 'manager') {
      const team = await User.find({ reportingManager: req.user.id }).select('_id');
      query.employee = { $in: team.map((t) => t._id) };
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