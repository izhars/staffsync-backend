const Payroll = require('../models/Payroll');
const User = require('../models/User');
const Attendance = require('../models/Attendance');

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Count working days (Mon–Fri) in a given month.
 * Public holidays can be passed as an array of Date or 'YYYY-MM-DD' strings.
 */
function countWorkingDays(year, month, publicHolidays = []) {
  const daysInMonth = new Date(year, month, 0).getDate();
  const holidaySet = new Set(
    publicHolidays.map((h) =>
      (h instanceof Date ? h : new Date(h)).toISOString().slice(0, 10)
    )
  );

  let working = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month - 1, d);
    const dow = date.getDay(); // 0 = Sun, 6 = Sat
    const iso = date.toISOString().slice(0, 10);
    if (dow !== 0 && dow !== 6 && !holidaySet.has(iso)) {
      working++;
    }
  }
  return working;
}

// ─────────────────────────────────────────────
// @desc    Generate Payroll (with accurate proration)
// @route   POST /api/payroll/generate
// @access  Private (HR, Admin)
// ─────────────────────────────────────────────
exports.generatePayroll = async (req, res) => {
  try {
    const {
      employeeId,
      month,
      year,
      bonus = 0,
      overtime = 0,
      otherEarnings = 0,
      insurance = 0,
      advance = 0,
      otherDeductions = 0,
      pfRate = 0.12,
      taxRate = 0.10,
      pt = 200,                 // Professional Tax (flat)
      publicHolidays = [],      // e.g. ['2025-01-26']
      includeLeaveAsPaid = true,
      includeOffDaysAsPaid = true,
      includeHolidaysAsPaid = true
    } = req.body;

    // ── Validation ──
    if (!employeeId || !month || !year) {
      return res.status(400).json({
        success: false,
        message: 'employeeId, month, and year are required'
      });
    }
    if (month < 1 || month > 12) {
      return res.status(400).json({ success: false, message: 'Invalid month' });
    }

    // ── Reject future months and the current (incomplete) month ──
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    if (year > currentYear || (year === currentYear && month >= currentMonth)) {
      return res.status(400).json({
        success: false,
        message:
          month === currentMonth && year === currentYear
            ? `Cannot generate payroll for the current month (${month}/${year}). Wait until the month ends.`
            : `Cannot generate payroll for a future period (${month}/${year}).`,
      });
    }

    // ── Duplicate check ──
    const existing = await Payroll.findOne({ employee: employeeId, month, year });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'Payroll already exists for this period'
      });
    }

    // ── Employee lookup ──
    const employee = await User.findById(employeeId);
    if (!employee) {
      return res.status(404).json({ success: false, message: 'Employee not found' });
    }

    const salary = employee.salary || {};
    const basic = salary.basic || 0;
    const hra = salary.hra || 0;
    const transport = salary.transport || 0;
    const medical = salary.medical || 0;
    const conveyance = salary.conveyance || 0;
    const specialAllowance = salary.specialAllowance || 0;

    if (basic === 0) {
      return res.status(400).json({
        success: false,
        message: 'Employee has no basic salary set'
      });
    }

    // ── Date range ──
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59);

    // ── Working days (Mon–Fri minus public holidays) ──
    const workDays = countWorkingDays(year, month, publicHolidays);

    // ── Attendance ──
    const attendance = await Attendance.find({
      employee: employeeId,
      date: { $gte: startDate, $lte: endDate }
    });

    const presentDays = attendance.filter(a => a.status === 'present').length;
    const leaveDays = attendance.filter(a => a.status === 'on-leave').length;
    const halfDays = attendance.filter(a => a.status === 'half-day').length;
    const absentDays = attendance.filter(a => a.status === 'absent').length;

    // Off-days & public holidays are the *non-working* days in the month
    const totalDaysInMonth = new Date(year, month, 0).getDate();
    const offDays = totalDaysInMonth - workDays - publicHolidays.length;
    const holidaysCount = publicHolidays.length;

    // ── Payable days ──
    let payableDays = presentDays + (halfDays * 0.5);
    if (includeLeaveAsPaid) payableDays += leaveDays;
    if (includeOffDaysAsPaid) payableDays += offDays;
    if (includeHolidaysAsPaid) payableDays += holidaysCount;

    // Safety: never exceed the calendar month's days
    payableDays = Math.min(payableDays, totalDaysInMonth);

    // ── Proration ──
    const ratio = workDays > 0 ? payableDays / totalDaysInMonth : 0;

    const earnedBasic = round2(basic * ratio);
    const earnedHra = round2(hra * ratio);
    const earnedTransport = round2(transport * ratio);
    const earnedMedical = round2(medical * ratio);
    const earnedConveyance = round2(conveyance * ratio);
    const earnedSpecial = round2(specialAllowance * ratio);

    // ── Statutory deductions ──
    const pf = round2(earnedBasic * pfRate);
    const tax = round2(earnedBasic * taxRate);

    // ── Create payroll ──
    const payroll = await Payroll.create({
      employee: employeeId,
      month,
      year,
      earnings: {
        basicSalary: earnedBasic,
        hra: earnedHra,
        transport: earnedTransport,
        medical: earnedMedical,
        conveyance: earnedConveyance,
        specialAllowance: earnedSpecial,
        bonus,
        overtime,
        other: otherEarnings
      },
      deductions: {
        pf,
        tax,
        pt,
        insurance,
        advance,
        other: otherDeductions
      },
      attendance: {
        workDays,
        presentDays,
        absentDays,
        leaveDays,
        halfDays,
        offDays,
        publicHolidays: holidaysCount,
        payableDays
      },
      generatedBy: req.user.id,
      status: 'draft'
    });

    await payroll.populate([
      { path: 'employee', select: 'firstName lastName employeeId email department' },
      { path: 'generatedBy', select: 'firstName lastName' }
    ]);

    res.status(201).json({
      success: true,
      message: 'Payroll generated successfully',
      payroll
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────
// @desc    Get all payrolls
// @route   GET /api/payroll
// @access  Private (HR, Admin)
// ─────────────────────────────────────────────
exports.getAllPayrolls = async (req, res) => {
  try {
    const { month, year, status, employeeId } = req.query;
    const query = {};
    if (month) query.month = month;
    if (year) query.year = year;
    if (status) query.status = status;
    if (employeeId) query.employee = employeeId;

    const payrolls = await Payroll.find(query)
      .populate('employee', 'firstName lastName employeeId email department')
      .populate('generatedBy', 'firstName lastName')
      .sort({ year: -1, month: -1 });

    res.status(200).json({
      success: true,
      count: payrolls.length,
      payrolls
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────
// @desc    Get single payroll by ID
// @route   GET /api/payroll/:id
// @access  Private (HR, Admin)
// ─────────────────────────────────────────────
exports.getPayrollById = async (req, res) => {
  try {
    const payroll = await Payroll.findById(req.params.id)
      .populate('employee', 'firstName lastName employeeId email department')
      .populate('generatedBy', 'firstName lastName')
      .populate('paidBy', 'firstName lastName');

    if (!payroll) {
      return res.status(404).json({
        success: false,
        message: 'Payroll not found'
      });
    }

    // Employees can only see their own payroll
    const isOwner =
      payroll.employee._id.toString() === req.user.id.toString();
    const isHr = ['hr', 'admin'].includes(req.user.role);

    if (!isOwner && !isHr) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view this payroll'
      });
    }

    res.status(200).json({ success: true, payroll });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────
// @desc    Get my payroll
// @route   GET /api/payroll/my-payroll
// @access  Private
// ─────────────────────────────────────────────
exports.getMyPayroll = async (req, res) => {
  try {
    const { month, year } = req.query;
    const query = { employee: req.user.id };
    if (month) query.month = month;
    if (year) query.year = year;

    const payrolls = await Payroll.find(query).sort({ year: -1, month: -1 });

    res.status(200).json({
      success: true,
      count: payrolls.length,
      payrolls
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────
// @desc    Update payroll
// @route   PUT /api/payroll/:id
// @access  Private (HR, Admin)
// ─────────────────────────────────────────────
exports.updatePayroll = async (req, res) => {
  try {
    const payroll = await Payroll.findById(req.params.id);

    if (!payroll) {
      return res.status(404).json({
        success: false,
        message: 'Payroll not found'
      });
    }

    if (payroll.status === 'paid') {
      return res.status(400).json({
        success: false,
        message: 'Cannot edit a payroll that has already been paid'
      });
    }

    // Only allow safe fields
    const allowed = ['earnings', 'deductions', 'attendance', 'status'];
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        payroll[key] = { ...payroll[key].toObject(), ...req.body[key] };
      }
    }

    // Trigger recalc + save (hook runs)
    payroll.recalculate();
    await payroll.save();

    await payroll.populate([
      { path: 'employee', select: 'firstName lastName employeeId email department' },
      { path: 'generatedBy', select: 'firstName lastName' }
    ]);

    res.status(200).json({
      success: true,
      message: 'Payroll updated successfully',
      payroll
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────
// @desc    Process payroll
// @route   PUT /api/payroll/:id/process
// @access  Private (HR, Admin)
// ─────────────────────────────────────────────
exports.processPayroll = async (req, res) => {
  try {
    const payroll = await Payroll.findById(req.params.id);

    if (!payroll) {
      return res.status(404).json({
        success: false,
        message: 'Payroll not found'
      });
    }

    if (payroll.status === 'paid') {
      return res.status(400).json({
        success: false,
        message: 'Payroll is already paid'
      });
    }

    payroll.status = 'processed';
    await payroll.save();

    res.status(200).json({
      success: true,
      message: 'Payroll processed successfully',
      payroll
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────
// @desc    Mark payroll as paid
// @route   PUT /api/payroll/:id/pay
// @access  Private (HR, Admin)
// ─────────────────────────────────────────────
exports.markAsPaid = async (req, res) => {
  try {
    const { paymentMethod, transactionId } = req.body;

    if (!paymentMethod) {
      return res.status(400).json({
        success: false,
        message: 'paymentMethod is required'
      });
    }

    const payroll = await Payroll.findById(req.params.id);

    if (!payroll) {
      return res.status(404).json({
        success: false,
        message: 'Payroll not found'
      });
    }

    if (payroll.status === 'paid') {
      return res.status(400).json({
        success: false,
        message: 'Payroll already marked as paid'
      });
    }

    payroll.status = 'paid';
    payroll.paidOn = Date.now();
    payroll.paymentMethod = paymentMethod;
    payroll.transactionId = transactionId;
    payroll.paidBy = req.user.id;
    await payroll.save();

    await payroll.populate([
      { path: 'employee', select: 'firstName lastName employeeId' },
      { path: 'paidBy', select: 'firstName lastName' }
    ]);

    res.status(200).json({
      success: true,
      message: 'Payroll marked as paid',
      payroll
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};