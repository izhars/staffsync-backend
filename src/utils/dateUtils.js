// src/utils/dateTime.js
const moment = require("moment-timezone");

const TIMEZONE = "Asia/Kolkata";

const nowIST = () => moment().tz(TIMEZONE);

const getISTDate = () => nowIST().toDate();

const getISTMidnight = () => nowIST().startOf("day").toDate();

const getISTStandardTime = () =>
  nowIST().set({ hour: 10, minute: 0, second: 0, millisecond: 0 }).toDate();

const getISTStandardCheckoutTime = () =>
  nowIST().set({ hour: 18, minute: 0, second: 0, millisecond: 0 }).toDate();

const getISTAutoCheckoutTime = () =>
  nowIST().set({ hour: 21, minute: 0, second: 0, millisecond: 0 }).toDate();

const getStartOfDay = (date = new Date()) =>
  moment(date).tz(TIMEZONE).startOf("day").toDate();

const getEndOfDay = (date = new Date()) =>
  moment(date).tz(TIMEZONE).endOf("day").toDate();

const getStartOfMonth = (date = new Date()) =>
  moment(date).tz(TIMEZONE).startOf("month").toDate();

const getEndOfMonthDate = (date = new Date()) =>
  moment(date).tz(TIMEZONE).endOf("month").toDate();

const getMonthStart = (year, month) =>
  moment
    .tz(
      { year, month: month - 1, day: 1, hour: 0, minute: 0, second: 0, millisecond: 0 },
      TIMEZONE
    )
    .toDate();

const getMonthEnd = (year, month) =>
  moment.tz({ year, month: month - 1, day: 1 }, TIMEZONE).endOf("month").toDate();

const getEndOfMonth = (year, month) => getMonthEnd(year, month);

const getStartOfYear = (year = nowIST().year()) =>
  moment
    .tz(
      { year, month: 0, day: 1, hour: 0, minute: 0, second: 0, millisecond: 0 },
      TIMEZONE
    )
    .toDate();

const getEndOfYear = (year = nowIST().year()) =>
  moment
    .tz(
      { year, month: 11, day: 31, hour: 23, minute: 59, second: 59, millisecond: 999 },
      TIMEZONE
    )
    .toDate();

const parseMonthYear = (query = {}) => {
  const now = nowIST();
  const parsedYear = parseInt(query.year, 10);
  const parsedMonth = parseInt(query.month, 10);
  const year =
    Number.isInteger(parsedYear) && parsedYear > 0 ? parsedYear : now.year();
  const month =
    Number.isInteger(parsedMonth) && parsedMonth >= 1 && parsedMonth <= 12
      ? parsedMonth
      : now.month() + 1;
  return { year, month };
};

const getMonthName = (year, monthIndex) =>
  moment.tz({ year, month: monthIndex, day: 1 }, TIMEZONE).format("MMM");

const getISTDay = (date = new Date()) => moment(date).tz(TIMEZONE).day();

const getISTDateString = (date = new Date()) =>
  moment(date).tz(TIMEZONE).format("YYYY-MM-DD");

const getTodayIST = () => nowIST().format("YYYY-MM-DD");

const formatISTTime = (date) =>
  date ? moment(date).tz(TIMEZONE).format("YYYY-MM-DD HH:mm:ss") : null;

const formatISTDate = (date) =>
  date ? moment(date).tz(TIMEZONE).format("DD MMM YYYY") : null;

const getCurrentWorkHours = (attendance) => {
  if (!attendance?.checkIn?.time) return 0;
  const now = nowIST();
  const checkIn = moment(attendance.checkIn.time).tz(TIMEZONE);
  if (attendance.checkOut?.time) {
    return parseFloat(Number(attendance.workHours || 0).toFixed(2));
  }
  return parseFloat((now.diff(checkIn, "minutes") / 60).toFixed(2));
};

/** ✅ NEW: compute hours between two timestamps in IST */
const computeWorkHours = (checkIn, checkOut) => {
  if (!checkIn || !checkOut) return 0;
  const inT = moment(checkIn).tz(TIMEZONE);
  const outT = moment(checkOut).tz(TIMEZONE);
  const mins = outT.diff(inT, "minutes");
  if (mins <= 0) return 0;
  return parseFloat((mins / 60).toFixed(2));
};

module.exports = {
  TIMEZONE,
  nowIST,
  getISTDate,
  getISTMidnight,
  getISTStandardTime,
  getISTStandardCheckoutTime,
  getISTAutoCheckoutTime,
  getStartOfDay,
  getEndOfDay,
  getStartOfMonth,
  getEndOfMonthDate,
  getMonthStart,
  getMonthEnd,
  getEndOfMonth,
  getStartOfYear,
  getEndOfYear,
  parseMonthYear,
  formatISTTime,
  formatISTDate,
  getMonthName,
  getISTDateString,
  getTodayIST,
  getISTDay,
  getCurrentWorkHours,
  computeWorkHours,
};