const mongoose = require('mongoose');

const payrollSchema = new mongoose.Schema({
  employee: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  month: { type: Number, required: true, min: 1, max: 12 },
  year: { type: Number, required: true },

  earnings: {
    basicSalary: { type: Number, required: true, default: 0 },
    hra: { type: Number, default: 0 },
    transport: { type: Number, default: 0 },
    medical: { type: Number, default: 0 },
    conveyance: { type: Number, default: 0 },
    specialAllowance: { type: Number, default: 0 },
    bonus: { type: Number, default: 0 },
    overtime: { type: Number, default: 0 },
    other: { type: Number, default: 0 },
    total: { type: Number, default: 0 }
  },

  deductions: {
    pf: { type: Number, default: 0 },
    tax: { type: Number, default: 0 },
    pt: { type: Number, default: 0 },          // Professional Tax
    insurance: { type: Number, default: 0 },
    advance: { type: Number, default: 0 },
    other: { type: Number, default: 0 },
    total: { type: Number, default: 0 }
  },

  attendance: {
    workDays: { type: Number, default: 0 },
    presentDays: { type: Number, default: 0 },
    absentDays: { type: Number, default: 0 },
    leaveDays: { type: Number, default: 0 },
    halfDays: { type: Number, default: 0 },
    offDays: { type: Number, default: 0 },
    publicHolidays: { type: Number, default: 0 },
    payableDays: { type: Number, default: 0 }
  },

  netSalary: { type: Number, required: true, default: 0 },

  status: {
    type: String,
    enum: ['draft', 'processed', 'paid'],
    default: 'draft'
  },

  paidOn: Date,
  paymentMethod: { type: String, enum: ['bank-transfer', 'cash', 'cheque'] },
  transactionId: String,

  generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  paidBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, {
  timestamps: true
});

// Unique payroll per employee per month/year
payrollSchema.index({ employee: 1, month: 1, year: 1 }, { unique: true });

// ─────────────────────────────────────────────
// Shared recalculation logic
// ─────────────────────────────────────────────
function recalc(doc) {
  const e = doc.earnings || {};
  const d = doc.deductions || {};

  e.total =
    (e.basicSalary || 0) +
    (e.hra || 0) +
    (e.transport || 0) +
    (e.medical || 0) +
    (e.conveyance || 0) +
    (e.specialAllowance || 0) +
    (e.bonus || 0) +
    (e.overtime || 0) +
    (e.other || 0);

  d.total =
    (d.pf || 0) +
    (d.tax || 0) +
    (d.pt || 0) +
    (d.insurance || 0) +
    (d.advance || 0) +
    (d.other || 0);

  doc.earnings.total = round2(e.total);
  doc.deductions.total = round2(d.total);
  doc.netSalary = round2(e.total - d.total);
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Instance method (useful for controller-level recalcs)
payrollSchema.methods.recalculate = function () {
  recalc(this);
  return this;
};

// Runs on .save()
payrollSchema.pre('save', function (next) {
  recalc(this);
  next();
});

// Runs on findOneAndUpdate / findByIdAndUpdate
payrollSchema.pre('findOneAndUpdate', function (next) {
  const update = this.getUpdate() || {};
  // Only recalc if earnings or deductions are being touched
  if (update.earnings || update.deductions || update.$set?.earnings || update.$set?.deductions) {
    this._recalcAfterUpdate = true;
  }
  next();
});

payrollSchema.post('findOneAndUpdate', async function (doc) {
  if (this._recalcAfterUpdate && doc) {
    recalc(doc);
    await doc.save(); // triggers pre('save') again — safe & idempotent
  }
});

payrollSchema.virtual('grossSalary').get(function () {
  return this.earnings.total;
});

module.exports = mongoose.model('Payroll', payrollSchema);