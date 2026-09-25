// utils/shiftUtils.js
const moment = require('moment-timezone');
const User = require('../models/User');
const Shift = require('../models/Shift');

const TZ = 'Asia/Kolkata';
const OVERNIGHT_CHECKOUT_BUFFER_HOURS = 4; // auto-close overnight shifts this long after end

// Used when user has no shift AND no default shift exists.
// Set these to match your old getISTStandardTime / getISTStandardCheckoutTime.
const DEFAULT_SNAPSHOT = Object.freeze({
  code: 'DEFAULT',
  name: 'Default',
  startTime: '09:00',
  endTime: '18:00',
  breakDuration: 60,
  gracePeriod: 15,
  halfDayThreshold: 240,
  earlyLeaveGrace: 0,
  isNightShift: false,
});

const SNAP_FIELDS = Object.keys(DEFAULT_SNAPSHOT);

const pick = (src) => SNAP_FIELDS.reduce((o, k) => ((o[k] = src[k]), o), {});

/** User's assigned active shift → default shift → null */
async function resolveUserShift(userId) {
  const user = await User.findById(userId).select('shift').populate('shift');
  if (user?.shift?.isActive) return user.shift;
  return Shift.getDefaultShift();
}

/** Plain copy of the shift fields stored on the attendance record */
const snapshotShift = (shift) => (shift ? pick(shift) : { ...DEFAULT_SNAPSHOT });

/** Read the snapshot back from an attendance doc (legacy records → default) */
const snapFromAttendance = (att) =>
  att?.shiftSnapshot?.startTime ? pick(att.shiftSnapshot) : { ...DEFAULT_SNAPSHOT };

const isOvernight = (s) => s.endTime <= s.startTime;

const at = (day, hm) => {
  const [h, m] = hm.split(':').map(Number);
  return day.clone().hour(h).minute(m).second(0).millisecond(0);
};

/** Start/end moments of the shift that begins on `shiftDate` */
function getShiftWindow(snap, shiftDate) {
  const day = moment.tz(shiftDate, TZ).startOf('day');
  const start = at(day, snap.startTime);
  const end = at(day, snap.endTime);
  if (!end.isAfter(start)) end.add(1, 'day');
  return { start, end };
}

/**
 * Which calendar day does a punch at `now` belong to?
 * Overnight shifts: punches before yesterday's shift end belong to yesterday.
 */
function resolveShiftDate(snap, now) {
  const today = now.clone().startOf('day');
  if (isOvernight(snap)) {
    const { end } = getShiftWindow(snap, today.clone().subtract(1, 'day'));
    if (now.isBefore(end)) return today.subtract(1, 'day');
  }
  return today;
}

function evaluateCheckIn(snap, shiftDate, now) {
  const { start, end } = getShiftWindow(snap, shiftDate);
  if (now.isAfter(end)) return { allowed: false, reason: 'SHIFT_ENDED' };

  const minsAfterStart = Math.max(0, now.diff(start, 'minutes'));
  const isLate = minsAfterStart > snap.gracePeriod;
  return {
    allowed: true,
    isLate,
    lateBy: isLate ? minsAfterStart : 0,
    isHalfDay: minsAfterStart >= snap.halfDayThreshold,
  };
}

function evaluateCheckOut(snap, shiftDate, now) {
  const { end } = getShiftWindow(snap, shiftDate);
  const cap = isOvernight(snap)
    ? end.clone().add(OVERNIGHT_CHECKOUT_BUFFER_HOURS, 'hours')
    : moment.tz(shiftDate, TZ).endOf('day');

  const missedCheckout = now.isAfter(cap);
  const out = missedCheckout ? cap : now;
  const isShort = out.isBefore(end.clone().subtract(snap.earlyLeaveGrace, 'minutes'));

  return {
    checkOutTime: out.toDate(),
    missedCheckout,
    isShort,
    shortByMinutes: isShort ? end.diff(out, 'minutes') : 0,
  };
}

module.exports = {
  TZ,
  DEFAULT_SNAPSHOT,
  resolveUserShift,
  snapshotShift,
  snapFromAttendance,
  isOvernight,
  getShiftWindow,
  resolveShiftDate,
  evaluateCheckIn,
  evaluateCheckOut,
};