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
  maxAllowed: {
    type: Number,
    default: null,
    min: [1, 'maxAllowed must be at least 1'],
    validate: {
      validator: function(v) {
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
    default: ['all']
  },
  
  // ✅ NEW: Holiday image
  image: {
    url: {
      type: String,
      default: null
    },
    publicId: {
      type: String,
      default: null
    },
    format: {
      type: String,
      default: null
    },
    bytes: {
      type: Number,
      default: null
    },
    width: {
      type: Number,
      default: null
    },
    height: {
      type: Number,
      default: null
    },
    originalFilename: {
      type: String,
      default: null
    },
    uploadedAt: {
      type: Date,
      default: null
    }
  },
  
  isActive: {
    type: Boolean,
    default: true
  },
  
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
HolidaySchema.index({ category: 1 });
HolidaySchema.index({ category: 1, date: 1 });
HolidaySchema.index({ 'image.publicId': 1 }); // ✅ NEW: Index for image queries

// Pre-save hook to set weekday
HolidaySchema.pre('save', function(next) {
  const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  if (this.date) {
    this.date.setHours(0, 0, 0, 0);
    this.weekday = days[this.date.getDay()];
  }
  next();
});

// ✅ NEW: Virtual to check if holiday has an image
HolidaySchema.virtual('hasImage').get(function() {
  return !!(this.image && this.image.url);
});

// ✅ NEW: Virtual to get image thumbnail URL
HolidaySchema.virtual('imageThumbnail').get(function() {
  if (!this.image || !this.image.url) return null;
  // Cloudinary transformation for thumbnail
  return this.image.url.replace('/upload/', '/upload/w_200,h_200,c_fill,q_auto,f_auto/');
});

HolidaySchema.virtual('isMandatory').get(function() {
  return this.category === 'Mandatory';
});

HolidaySchema.virtual('isRestricted').get(function() {
  return this.category === 'Restricted';
});

const Holiday = mongoose.model('Holiday', HolidaySchema);
module.exports = Holiday;