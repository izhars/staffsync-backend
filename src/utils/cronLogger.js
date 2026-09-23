// utils/cronLogger.js
const CronLog = require('../models/CronLog');

/** 🕒 Update the last run time for a given cron job */
exports.updateCronRun = async (jobName) => {
  await CronLog.findOneAndUpdate(
    { jobName },
    { lastRun: new Date() },
    { upsert: true, new: true }
  );
};

/** 📅 Get the last run time for a specific cron job */
exports.getLastCronRun = async (jobName) => {
  const log = await CronLog.findOne({ jobName });
  return log ? log.lastRun : null;
};