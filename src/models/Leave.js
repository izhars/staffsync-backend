const mongoose = require('mongoose');

const leaveSchema = new mongoose.Schema({
  employee: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  leaveType: {
    type: String,
    enum: ['casual', 'combo'],   // ← trimmed
    required: true,
  },

  // 👇 Added for full-day or half-day selection
  leaveDuration: {
    type: String,
    enum: ['full', 'half'],
    default: 'full',
    required: true
  },

  // 👇 Only required if leaveDuration is 'half'
  halfDayType: {
    type: String,
    enum: ['first_half', 'second_half', null],
    default: null
  },

  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  totalDays: { type: Number, required: true },

  reason: { type: String, required: true, trim: true },

  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'cancelled'],
    default: 'pending',
    index: true
  },

  cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  cancellationReason: String,

  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  approvedAt: Date,
  rejectionReason: String,

  documents: [
    {
      fileName: String,
      fileUrl: String
    }
  ],

  appliedOn: { type: Date, default: Date.now }
}, {
  timestamps: true
});

// ✅ Validate end date is after start date
leaveSchema.pre('validate', function (next) {
  if (this.endDate < this.startDate) {
    return next(new Error('End date must be after start date'));
  }

  // ✅ Half-day validation
  if (this.leaveDuration === 'half') {
    if (!this.halfDayType) {
      return next(new Error('Half day type (first_half or second_half) is required for half-day leave'));
    }
    this.totalDays = 0.5;
  }

  next();
});

module.exports = mongoose.model('Leave', leaveSchema);
