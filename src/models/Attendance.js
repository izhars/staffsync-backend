const mongoose = require('mongoose');
const moment = require('moment-timezone');

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

const punchSubSchema = new mongoose.Schema(
  {
    time: { type: Date, default: null },
    location: { type: locationSubSchema, default: {} },
    deviceInfo: String,

    // ── NEW audit fields ─────────────────────────────────────────────
    punchedFrom: {
      type: String,
      enum: ['mobile', 'desktop'],
      default: 'mobile',
    },
    verificationMethod: {
      type: String,
      enum: [
        'GPS',                     // normal mobile GPS inside fence
        'OFFICE_NETWORK',          // HR/Admin desktop on office IP
        'BYPASS_PRIVILEGED',       // HR/Admin with GPS but outside fence
        'BYPASS_NO_GPS_PRIVILEGED' // HR/Admin desktop, IP check skipped (dev/staging)
      ],
      default: 'GPS',
    },
    isGpsBypassed: { type: Boolean, default: false },
    bypassReason: String,
    clientIp: String,
  },
  { _id: false }
);

const attendanceSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    date: { type: Date, required: true },

    checkIn: { type: punchSubSchema, default: {} },
    checkOut: { type: punchSubSchema, default: {} },

    isShortAttendance: { type: Boolean, default: false },
    shortByMinutes: { type: Number, default: 0 },

    workHours: { type: Number, default: 0 },
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

    isLate: { type: Boolean, default: false },
    lateBy: { type: Number, default: 0 },
    remarks: String,
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

attendanceSchema.index({ employee: 1, date: 1 }, { unique: true });

attendanceSchema.virtual('checkInTimeFormatted').get(function () {
  return this.checkIn?.time
    ? moment(this.checkIn.time).tz('Asia/Kolkata').format('YYYY-MM-DD HH:mm:ss')
    : null;
});

attendanceSchema.virtual('checkOutTimeFormatted').get(function () {
  return this.checkOut?.time
    ? moment(this.checkOut.time).tz('Asia/Kolkata').format('YYYY-MM-DD HH:mm:ss')
    : null;
});

attendanceSchema.set('toJSON', { virtuals: true });
attendanceSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Attendance', attendanceSchema);