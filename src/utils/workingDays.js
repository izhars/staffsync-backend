// utils/workingDays.js
const ALL_DAYS = [
  'monday', 'tuesday', 'wednesday', 'thursday',
  'friday', 'saturday', 'sunday',
];

/**
 * Returns the array of working days for a user based on their weekendType.
 * - 'sunday'          → Mon–Sat (only Sunday off)
 * - 'saturday_sunday' → Mon–Fri (Sat + Sun off)
 */
function getWorkingDays(user) {
  if (!user || !user.weekendType) {
    return ALL_DAYS.filter((d) => d !== 'sunday');
  }
  if (user.weekendType === 'saturday_sunday') {
    return ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
  }
  return ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
}

/**
 * Returns the weekend days (inverse of working days).
 */
function getWeekendDays(user) {
  const working = getWorkingDays(user);
  return ALL_DAYS.filter((d) => !working.includes(d));
}

/**
 * Is the given date a working day for this user?
 */
function isWorkingDay(user, date = new Date()) {
  const dayName = date
    .toLocaleDateString('en-US', { weekday: 'long' })
    .toLowerCase();
  return getWorkingDays(user).includes(dayName);
}

module.exports = { getWorkingDays, getWeekendDays, isWorkingDay, ALL_DAYS };