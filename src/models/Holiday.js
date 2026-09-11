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
  isActive: {
    type: Boolean,
    default: true
  }
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Index for better query performance
HolidaySchema.index({ date: 1 });
HolidaySchema.index({ type: 1 });

// ✅ Pre-save hook to set weekday
HolidaySchema.pre('save', function(next) {
  const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

  if (this.date) {
    this.date.setHours(0, 0, 0, 0);   // Normalize date
    this.weekday = days[this.date.getDay()];
  }

  next();
});

const Holiday = mongoose.model('Holiday', HolidaySchema);
module.exports = Holiday;
