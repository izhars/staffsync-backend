const mongoose = require('mongoose');

const geoFenceLocationSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Location name is required'],
    trim: true,
    unique: true,
  },
  type: {
    type: String,
    enum: ['office', 'site', 'warehouse', 'client', 'other'],
    default: 'office',
  },
  address: {
    type: String,
    required: [true, 'Address is required'],
    trim: true,
  },
  latitude: {
    type: Number,
    required: [true, 'Latitude is required'],
    min: -90,
    max: 90,
  },
  longitude: {
    type: Number,
    required: [true, 'Longitude is required'],
    min: -180,
    max: 180,
  },
  radiusMeters: {
    type: Number,
    required: true,
    default: 100,
    min: 10,
    max: 5000, // max 5km
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  // Optional: assign specific departments/employees
  // If empty, location is available to ALL employees
  allowedDepartments: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department',
  }],
  allowedEmployees: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  }],
  // Who created this location
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  remarks: String,
}, {
  timestamps: true,
});

// Index for quick lookups
geoFenceLocationSchema.index({ isActive: 1 });

// Virtual for formatted coordinates
geoFenceLocationSchema.virtual('coordinates').get(function () {
  return `${this.latitude}, ${this.longitude}`;
});

geoFenceLocationSchema.set('toJSON', { virtuals: true });
geoFenceLocationSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('GeoFenceLocation', geoFenceLocationSchema);