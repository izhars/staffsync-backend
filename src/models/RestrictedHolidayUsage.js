// models/RestrictedHolidayUsage.js
const mongoose = require('mongoose');

const RestrictedHolidayUsageSchema = new mongoose.Schema({
  employee: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  holiday: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Holiday',
    required: true
  },
  date: { type: Date, required: true },
  year: { type: Number, required: true },
  action: {
    type: String,
    enum: ['punched_in', 'applied_leave'],
    default: 'punched_in'
  }
}, { timestamps: true });

RestrictedHolidayUsageSchema.index({ employee: 1, holiday: 1 }, { unique: true });
RestrictedHolidayUsageSchema.index({ employee: 1, year: 1 });

module.exports = mongoose.model('RestrictedHolidayUsage', RestrictedHolidayUsageSchema);