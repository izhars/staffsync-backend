// models/Department.js
const mongoose = require('mongoose');

const departmentSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Department name is required'],
      unique: true,
      trim: true,
      uppercase: true,
    },
    code: {
      type: String,
      required: [true, 'Department code is required'],
      unique: true,
      uppercase: true,
      trim: true,
      minlength: 2,
      maxlength: 10,
    },
    description: { type: String, trim: true },
    head: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    // Denormalized count — informational only. Source of truth is User.department.
    employeeCount: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { timestamps: true }
);

departmentSchema.index({ isActive: 1 });

departmentSchema.pre('save', async function (next) {
  if (!this.isModified('employeeCount')) return next();
  if (this.employeeCount < 0) {
    return next(new Error('Employee count cannot be negative'));
  }
  next();
});

module.exports = mongoose.model('Department', departmentSchema);