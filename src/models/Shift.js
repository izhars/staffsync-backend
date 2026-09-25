// models/Shift.js
const mongoose = require('mongoose');

const shiftSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Shift name is required'],
      trim: true,
      unique: true,
      maxlength: 50,
    },
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      maxlength: 20,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 200,
    },

    // ── Timing ──────────────────────────────────────────────────
    startTime: {
      type: String, // "09:00" (24hr format)
      required: [true, 'Start time is required'],
      match: [/^([01]\d|2[0-3]):([0-5]\d)$/, 'Start time must be HH:MM (24hr)'],
    },
    endTime: {
      type: String, // "18:00"
      required: [true, 'End time is required'],
      match: [/^([01]\d|2[0-3]):([0-5]\d)$/, 'End time must be HH:MM (24hr)'],
    },
    breakDuration: {
      type: Number, // in minutes
      default: 60,
      min: 0,
      max: 240,
    },

    // ── Grace & Overtime ────────────────────────────────────────
    gracePeriod: {
      type: Number, // minutes after start before marked late
      default: 15,
      min: 0,
      max: 60,
    },
    halfDayThreshold: {
      type: Number, // minutes after start before half-day
      default: 240,
      min: 0,
    },
    earlyLeaveGrace: {
      type: Number, // minutes before end allowed to leave early
      default: 15,
      min: 0,
    },
    type: {
      type: String,
      enum: ['fixed', 'rotational', 'flexible', 'night'],
      default: 'fixed',
    },
    isNightShift: {
      type: Boolean,
      default: false,
    },
    nightShiftAllowance: {
      type: Number, // percentage of basic
      default: 0,
      min: 0,
      max: 100,
    },

    // ── Applicability ───────────────────────────────────────────
    applicableDepartments: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Department',
    }],
    applicableDesignations: [{
      type: String,
      trim: true,
    }],

    // ── Status ──────────────────────────────────────────────────
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    isDefault: {
      type: Boolean,
      default: false,
    },

    // ── Audit ───────────────────────────────────────────────────
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ── Indexes ────────────────────────────────────────────────────
shiftSchema.index({ isActive: 1, isDefault: 1 });
shiftSchema.index({ applicableDepartments: 1 });

// ── Virtuals ───────────────────────────────────────────────────
shiftSchema.virtual('durationMinutes').get(function () {
  const [sh, sm] = this.startTime.split(':').map(Number);
  const [eh, em] = this.endTime.split(':').map(Number);
  let start = sh * 60 + sm;
  let end = eh * 60 + em;
  if (end <= start) end += 24 * 60; // overnight shift
  return end - start - (this.breakDuration || 0);
});

shiftSchema.virtual('durationHours').get(function () {
  return (this.durationMinutes / 60).toFixed(2);
});

shiftSchema.virtual('displayTiming').get(function () {
  return `${this.startTime} - ${this.endTime}`;
});

// ── Pre-save: ensure only one default ──────────────────────────
shiftSchema.pre('save', async function (next) {
  if (this.isDefault && this.isModified('isDefault')) {
    await this.constructor.updateMany(
      { _id: { $ne: this._id }, isDefault: true },
      { $set: { isDefault: false } }
    );
  }
  next();
});

// ── Static: get default shift ──────────────────────────────────
shiftSchema.statics.getDefaultShift = function () {
  return this.findOne({ isDefault: true, isActive: true });
};

module.exports = mongoose.model('Shift', shiftSchema);