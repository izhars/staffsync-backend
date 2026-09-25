const mongoose = require('mongoose');
const moment = require('moment-timezone');

// ─────────────────────────────────────────────────────────────
// Location Snapshot
// ─────────────────────────────────────────────────────────────
const locationSubSchema = new mongoose.Schema(
  {
    latitude: Number,
    longitude: Number,
    address: String,
    matchedLocationName: String,
    distanceFromOffice: Number,
  },
  { _id: false }
);

// ─────────────────────────────────────────────────────────────
// Punch Details
// ─────────────────────────────────────────────────────────────
const punchSubSchema = new mongoose.Schema(
  {
    time: {
      type: Date,
      default: null,
    },

    location: {
      type: locationSubSchema,
      default: {},
    },

    deviceInfo: String,

    // ── Audit fields ───────────────────────────────────────────
    punchedFrom: {
      type: String,
      enum: ['mobile', 'desktop'],
      default: 'mobile',
    },

    verificationMethod: {
      type: String,
      enum: [
        'GPS',
        'OFFICE_NETWORK',
        'BYPASS_PRIVILEGED',
        'BYPASS_NO_GPS_PRIVILEGED',
        'FACE_GPS',
        'FACE_ONLY',
      ],
      default: 'GPS',
    },

    isGpsBypassed: {
      type: Boolean,
      default: false,
    },

    bypassReason: String,

    clientIp: String,

    // ── Face recognition audit ─────────────────────────────────
    faceVerified: {
      type: Boolean,
      default: false,
    },

    faceSimilarity: {
      type: Number,
      default: null,
    },

    faceThreshold: {
      type: Number,
      default: null,
    },

    faceModel: {
      type: String,
      default: null,
    },

    faceLivenessPassed: {
      type: Boolean,
      default: false,
    },
  },
  { _id: false }
);

// ─────────────────────────────────────────────────────────────
// Shift Snapshot
// ─────────────────────────────────────────────────────────────
// Stores the shift rules that were applicable when attendance
// was created. This protects historical attendance from future
// shift edits.
// ─────────────────────────────────────────────────────────────
const shiftSnapshotSchema = new mongoose.Schema(
  {
    code: String,
    name: String,

    startTime: String,
    endTime: String,

    breakDuration: Number,

    gracePeriod: Number,

    halfDayThreshold: Number,

    earlyLeaveGrace: Number,

    isNightShift: Boolean,
  },
  { _id: false }
);

// ─────────────────────────────────────────────────────────────
// Attendance Schema
// ─────────────────────────────────────────────────────────────
const attendanceSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    date: {
      type: Date,
      required: true,
    },

    // ── Shift ──────────────────────────────────────────────────
    // Reference to the actual Shift document.
    shift: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Shift',
      default: null,
    },

    // Snapshot of shift settings at attendance creation time.
    shiftSnapshot: {
      type: shiftSnapshotSchema,
      default: null,
    },

    // ── Punches ────────────────────────────────────────────────
    checkIn: {
      type: punchSubSchema,
      default: {},
    },

    checkOut: {
      type: punchSubSchema,
      default: {},
    },

    // ── Short Attendance ───────────────────────────────────────
    isShortAttendance: {
      type: Boolean,
      default: false,
    },

    shortByMinutes: {
      type: Number,
      default: 0,
    },

    // ── Working Hours ──────────────────────────────────────────
    workHours: {
      type: Number,
      default: 0,
    },

    // ── Attendance Status ──────────────────────────────────────
    status: {
      type: String,
      enum: [
        'present',
        'absent',
        'half-day',
        'on-leave',
        'public-holiday',
        'combo-off',
        'non-working-day',
      ],
      default: 'absent',
    },

    // ── Late Attendance ────────────────────────────────────────
    isLate: {
      type: Boolean,
      default: false,
    },

    lateBy: {
      type: Number,
      default: 0,
    },

    remarks: String,

    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  {
    timestamps: true,
  }
);

// ─────────────────────────────────────────────────────────────
// Index
// ─────────────────────────────────────────────────────────────
attendanceSchema.index(
  { employee: 1, date: 1 },
  { unique: true }
);

// ─────────────────────────────────────────────────────────────
// Virtuals
// ─────────────────────────────────────────────────────────────
attendanceSchema.virtual('checkInTimeFormatted').get(function () {
  return this.checkIn?.time
    ? moment(this.checkIn.time)
        .tz('Asia/Kolkata')
        .format('YYYY-MM-DD HH:mm:ss')
    : null;
});

attendanceSchema.virtual('checkOutTimeFormatted').get(function () {
  return this.checkOut?.time
    ? moment(this.checkOut.time)
        .tz('Asia/Kolkata')
        .format('YYYY-MM-DD HH:mm:ss')
    : null;
});

// ─────────────────────────────────────────────────────────────
// JSON / Object Virtuals
// ─────────────────────────────────────────────────────────────
attendanceSchema.set('toJSON', {
  virtuals: true,
});

attendanceSchema.set('toObject', {
  virtuals: true,
});

// ─────────────────────────────────────────────────────────────
// Model
// ─────────────────────────────────────────────────────────────
module.exports = mongoose.model(
  'Attendance',
  attendanceSchema
);