// models/Holiday.js
const mongoose = require('mongoose');

const HolidaySchema = new mongoose.Schema({
  name: { 
    type: String, 
    required: [true, 'Holiday name is required'],
    trim: true,
    maxlength: [100, 'Name cannot exceed 100 characters']
  },
  date: { 
    type: Date, 
    required: [true, 'Date is required'],
    unique: true,
    validate: {
      validator: function(v) {
        return v instanceof Date && !isNaN(v.getTime());
      },
      message: 'Date must be a valid date'
    }
  },
  weekday: {
    type: String,
    enum: ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']
  },
  description: { 
    type: String, 
    trim: true,
    maxlength: [500, 'Description cannot exceed 500 characters']
  },
  type: { 
    type: String, 
    enum: {
      values: ['National', 'Festival', 'Regional', 'Religious'],
      message: 'Type must be one of: National, Festival, Regional, Religious'
    }, 
    default: 'Festival' 
  },
  
  // ✅ NEW: Holiday category (mandatory vs restricted)
  category: {
    type: String,
    enum: {
      values: ['Mandatory', 'Restricted'],
      message: 'Category must be either Mandatory or Restricted'
    },
    default: 'Mandatory',
    required: [true, 'Holiday category is required']
  },
  
  // ✅ NEW: For restricted holidays - max number an employee can take
  // Only relevant when category === 'Restricted'
  maxAllowed: {
    type: Number,
    default: null,
    min: [1, 'maxAllowed must be at least 1'],
    validate: {
      validator: function(v) {
        // Only validate if category is Restricted
        if (this.category === 'Restricted') {
          return v === null || (Number.isInteger(v) && v >= 1);
        }
        return true;
      },
      message: 'maxAllowed must be a positive integer for Restricted holidays'
    }
  },
  
  // ✅ NEW: For restricted holidays - which departments/roles can opt in
  applicableTo: {
    type: [String],
    default: ['all'] // 'all' or specific roles like ['hr', 'employee']
  },
  
  isActive: {
    type: Boolean,
    default: true
  },
  
  // ✅ NEW: Track who created it
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for better query performance
HolidaySchema.index({ date: 1 });
HolidaySchema.index({ type: 1 });
HolidaySchema.index({ category: 1 }); // ✅ NEW
HolidaySchema.index({ category: 1, date: 1 }); // ✅ NEW compound

// Pre-save hook to set weekday
HolidaySchema.pre('save', function(next) {
  const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  if (this.date) {
    this.date.setHours(0, 0, 0, 0);
    this.weekday = days[this.date.getDay()];
  }
  next();
});

// ✅ NEW: Virtual to check if it's a mandatory holiday
HolidaySchema.virtual('isMandatory').get(function() {
  return this.category === 'Mandatory';
});

// ✅ NEW: Virtual to check if it's a restricted holiday
HolidaySchema.virtual('isRestricted').get(function() {
  return this.category === 'Restricted';
});

const Holiday = mongoose.model('Holiday', HolidaySchema);
module.exports = Holiday;