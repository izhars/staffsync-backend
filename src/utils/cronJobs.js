// utils/cronJobs.js
const cron = require('node-cron');
const moment = require('moment-timezone');
const User = require('../models/User');
const Leave = require('../models/Leave');
const { updateCronRun, getLastCronRun } = require('./cronLogger');
const { sendCelebrationNotifications, scheduleCelebrationNotifications } = require('./celebrationScheduler');
const { notifyMorningPunchIn, notifyEveningPunchOut } = require('./attendanceNotifications');
const { ADMIN_ROLES } = require('../constants/roles');

// ───────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────

/**
 * Check if employee is on approved leave today
 */
async function isEmployeeOnLeave(employeeId) {
  const today = moment().tz('Asia/Kolkata').startOf('day').toDate();

  const leave = await Leave.findOne({
    employee: employeeId,
    startDate: { $lte: today },
    endDate: { $gte: today },
    status: 'approved',
  });

  return !!leave;
}

/**
 * Fetch employees who need morning punch-in notification
 * (active, non-admin, not on leave, no check-in today)
 */
async function getEmployeesForMorningPunchIn() {
  const Attendance = require('../models/Attendance');
  const today = moment().tz('Asia/Kolkata').startOf('day').toDate();

  const employees = await User.find({
    isActive: true,
    role: { $nin: ADMIN_ROLES },
  }).select('_id');

  const toNotify = [];
  for (const emp of employees) {
    if (await isEmployeeOnLeave(emp._id)) continue;

    const attendance = await Attendance.findOne({ employee: emp._id, date: today });

    if (!attendance || !attendance.checkIn || !attendance.checkIn.time) {
      toNotify.push(emp._id);
    }
  }

  return toNotify;
}

/**
 * Fetch employees who need evening punch-out notification
 * (already evening checked-in but not checked-out)
 */
async function getEmployeesForEveningPunchOut() {
  const Attendance = require('../models/Attendance');
  const today = moment().tz('Asia/Kolkata').startOf('day').toDate();

  const employees = await User.find({
    isActive: true,
    role: { $nin: ADMIN_ROLES },
  }).select('_id');

  const toNotify = [];
  for (const emp of employees) {
    if (await isEmployeeOnLeave(emp._id)) continue;

    const attendance = await Attendance.findOne({ employee: emp._id, date: today });

    if (
      attendance &&
      attendance.eveningCheckIn?.time &&
      (!attendance.eveningCheckOut || !attendance.eveningCheckOut.time)
    ) {
      toNotify.push(emp._id);
    }
  }

  return toNotify;
}

// ───────────────────────────────────────────────
// Task Definitions
// ───────────────────────────────────────────────
const cronTasks = {
  /**
   * Reset leave balances for all eligible employees.
   * Employees still in probation remain at ZERO.
   */
  resetLeaveBalance: async () => {
    try {
      await updateCronRun('resetLeaveBalance');

      // 1. Employees past probation → full quota
      const fullQuotaResult = await User.updateMany(
        {
          isActive: true,
          role: { $nin: ADMIN_ROLES },
          isProbationCompleted: true,
        },
        {
          $set: {
            'leaveBalance.casual': 12,
            'leaveBalance.sick': 10,
            'leaveBalance.earned': 15,
            'leaveBalance.combo': 0,
            'leaveBalance.unpaid': 0,
            leaveCreditedAt: new Date(),
            leaveCreditType: 'annual-reset',
          },
        }
      );

      // 2. Employees still in probation → keep at zero
      const probationResult = await User.updateMany(
        {
          isActive: true,
          role: { $nin: ADMIN_ROLES },
          isProbationCompleted: false,
        },
        {
          $set: {
            'leaveBalance.casual': 0,
            'leaveBalance.sick': 0,
            'leaveBalance.earned': 0,
            'leaveBalance.combo': 0,
            'leaveBalance.unpaid': 0,
            leaveCreditType: 'none',
            leaveCreditedAt: null,
          },
        }
      );

      return {
        success: true,
        credited: fullQuotaResult.modifiedCount,
        probationHold: probationResult.modifiedCount,
      };
    } catch (error) {
      console.error('❌ Error resetting leave balance:', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Send birthday wishes (data fetch + hook for email/push).
   */
  sendBirthdayWishes: async () => {
    try {
      await updateCronRun('sendBirthdayWishes');

      const today = moment().tz('Asia/Kolkata');
      const month = today.month() + 1;
      const day = today.date();

      const employees = await User.find({
        isActive: true,
        $expr: {
          $and: [
            { $eq: [{ $month: '$dateOfBirth' }, month] },
            { $eq: [{ $dayOfMonth: '$dateOfBirth' }, day] },
          ],
        },
      });

      if (employees.length === 0) {
        return { success: true, count: 0, message: 'No birthdays today' };
      }

      // TODO: await emailService.sendBirthdayWish(emp);

      return { success: true, count: employees.length };
    } catch (error) {
      console.error('❌ Error sending birthday wishes:', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Generate monthly attendance report.
   */
  generateMonthlyReport: async () => {
    try {
      await updateCronRun('generateMonthlyReport');

      // TODO: Generate and save report

      return { success: true };
    } catch (error) {
      console.error('❌ Error generating monthly report:', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Morning punch-in reminder (9:00 AM IST).
   */
  notifyMorningPunchIn: async () => {
    try {
      await updateCronRun('notifyMorningPunchIn');

      const employees = await getEmployeesForMorningPunchIn();

      if (employees.length === 0) {
        return { success: true, count: 0 };
      }

      const results = await Promise.allSettled(
        employees.map(id => notifyMorningPunchIn(id))
      );

      const successful = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;

      return {
        success: true,
        count: employees.length,
        successful,
        failed,
      };
    } catch (error) {
      console.error('❌ Error sending morning punch-in notifications:', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Evening punch-out reminder (6:00 PM IST).
   */
  notifyEveningPunchOut: async () => {
    try {
      await updateCronRun('notifyEveningPunchOut');

      const employees = await getEmployeesForEveningPunchOut();

      if (employees.length === 0) {
        return { success: true, count: 0 };
      }

      const results = await Promise.allSettled(
        employees.map(id => notifyEveningPunchOut(id))
      );

      const successful = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;

      return {
        success: true,
        count: employees.length,
        successful,
        failed,
      };
    } catch (error) {
      console.error('❌ Error sending evening punch-out notifications:', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Celebration notifications (birthdays + work anniversaries).
   */
  sendCelebrationNotifications: async () => {
    try {
      await updateCronRun('sendCelebrationNotifications');
      const result = await sendCelebrationNotifications();
      return result;
    } catch (error) {
      console.error('❌ Error in celebration notifications cron:', error);
      return { success: false, error: error.message };
    }
  },

  /**
 * Credit MONTHLY_CASUAL_CREDIT (2) casual leaves to every
 * post-probation employee. Runs on the 1st of every month.
 * Probation employees stay at zero.
 */
  creditMonthlyLeave: async () => {
    try {
      await updateCronRun('creditMonthlyLeave');

      // 1. Post-probation employees → +2 casual
      const result = await User.creditMonthlyLeaves();

      // 2. Probation employees → keep at zero (idempotent safety)
      await User.updateMany(
        {
          isActive: true,
          role: { $nin: ADMIN_ROLES },
          isProbationCompleted: false,
        },
        {
          $set: {
            'leaveBalance.casual': 0,
            'leaveBalance.combo': 0,
          },
        }
      );

      return {
        success: true,
        credited: result.credited,
        amount: result.amount,
      };
    } catch (error) {
      console.error('❌ Error crediting monthly leave:', error);
      return { success: false, error: error.message };
    }
  },
};

// ───────────────────────────────────────────────
// Cron Schedules
// ───────────────────────────────────────────────

/* 🔄 RESET LEAVE BALANCE — Jan 1, 12:00 AM IST */
exports.resetLeaveBalance = cron.schedule(
  '0 0 1 1 *',
  cronTasks.resetLeaveBalance,
  { scheduled: true, timezone: 'Asia/Kolkata' }
);

/* 🎂 SEND BIRTHDAY WISHES — 9:00 AM IST daily */
exports.sendBirthdayWishes = cron.schedule(
  '0 9 * * *',
  cronTasks.sendBirthdayWishes,
  { scheduled: true, timezone: 'Asia/Kolkata' }
);

/* 📅 MONTHLY CASUAL LEAVE ACCRUAL — 1st of every month, 12:05 AM IST */
exports.creditMonthlyLeave = cron.schedule(
  '5 0 1 * *',
  cronTasks.creditMonthlyLeave,
  { scheduled: true, timezone: 'Asia/Kolkata' }
);

/* 📊 GENERATE MONTHLY ATTENDANCE REPORT — 1st of every month, 1:00 AM IST */
exports.generateMonthlyReport = cron.schedule(
  '0 1 1 * *',
  cronTasks.generateMonthlyReport,
  { scheduled: true, timezone: 'Asia/Kolkata' }
);

/* ⏰ MORNING PUNCH-IN REMINDER — 9:00 AM IST */
exports.notifyMorningPunchIn = cron.schedule(
  '0 9 * * *',
  cronTasks.notifyMorningPunchIn,
  { scheduled: true, timezone: 'Asia/Kolkata' }
);

/* ⏰ EVENING PUNCH-OUT REMINDER — 6:00 PM IST */
exports.notifyEveningPunchOut = cron.schedule(
  '0 18 * * *',
  cronTasks.notifyEveningPunchOut,
  { scheduled: true, timezone: 'Asia/Kolkata' }
);

/* 🎉 CELEBRATION NOTIFICATIONS — 9:00 AM IST */
exports.sendCelebrationNotifications = cron.schedule(
  '0 9 * * *',
  cronTasks.sendCelebrationNotifications,
  { scheduled: true, timezone: 'Asia/Kolkata' }
);

// ───────────────────────────────────────────────
// Lifecycle
// ───────────────────────────────────────────────

/* 🚀 START ALL CRON JOBS */
exports.startCronJobs = async () => {
  try {
    if (scheduleCelebrationNotifications) {
      scheduleCelebrationNotifications();
    }

    const jobs = [
      exports.creditMonthlyLeave,          // ← renamed
      exports.sendBirthdayWishes,
      exports.generateMonthlyReport,
      exports.notifyMorningPunchIn,
      exports.notifyEveningPunchOut,
      exports.sendCelebrationNotifications,
    ];

    jobs.forEach(job => job.start());
    console.log('✅ Cron jobs started (6 active)');
  } catch (error) {
    console.error('❌ Failed to start cron jobs:', error);
  }
};

exports.stopCronJobs = () => {
  const jobs = [
    exports.creditMonthlyLeave,            // ← renamed
    exports.sendBirthdayWishes,
    exports.generateMonthlyReport,
    exports.notifyMorningPunchIn,
    exports.notifyEveningPunchOut,
    exports.sendCelebrationNotifications,
  ];
  jobs.forEach(job => job.stop());
  console.log('🛑 Cron jobs stopped');
};

exports.getCronStatus = () => {
  const jobs = [
    { name: 'creditMonthlyLeave', task: exports.creditMonthlyLeave }, // ← renamed
    { name: 'sendBirthdayWishes', task: exports.sendBirthdayWishes },
    { name: 'generateMonthlyReport', task: exports.generateMonthlyReport },
    { name: 'notifyMorningPunchIn', task: exports.notifyMorningPunchIn },
    { name: 'notifyEveningPunchOut', task: exports.notifyEveningPunchOut },
    { name: 'sendCelebrationNotifications', task: exports.sendCelebrationNotifications },
  ];

  return jobs.map(job => ({
    name: job.name,
    isRunning: job.task.getStatus() === 'started',
    nextRun: job.task.nextDate(),
  }));
};

// Export tasks for manual testing/triggering
exports.cronTasks = cronTasks;