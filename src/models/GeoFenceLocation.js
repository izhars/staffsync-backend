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
    enum: ['office', 'site', 'warehouse', 'client', 'highway', 'polyline', 'other'],
    default: 'office',
  },
  shape: {
    type: String,
    enum: ['circle', 'polyline'],
    default: 'circle',
  },
  address: {
    type: String,
    required: [true, 'Address is required'],
    trim: true,
  },
  latitude: {
    type: Number,
    min: -90,
    max: 90,
  },
  longitude: {
    type: Number,
    min: -180,
    max: 180,
  },
  radiusMeters: {
    type: Number,
    default: 100,
    min: 10,
    max: 5000,
  },
  polylinePoints: [{
    latitude: { type: Number, required: true, min: -90, max: 90 },
    longitude: { type: Number, required: true, min: -180, max: 180 },
    label: { type: String, trim: true }, // optional: "KM 12", "Toll Plaza"
  }],
  corridorWidthMeters: {
    type: Number,
    default: 100,
    min: 10,
    max: 2000,
  },
  waypoints: [{
    latitude: { type: Number, required: true, min: -90, max: 90 },
    longitude: { type: Number, required: true, min: -180, max: 180 },
    label: { type: String, trim: true },
  }],
  isActive: {
    type: Boolean,
    default: true,
  },
  allowedDepartments: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department',
  }],
  allowedEmployees: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  }],
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  remarks: String,
}, {
  timestamps: true,
});

// Validate: circle needs lat/lng, polyline needs points
geoFenceLocationSchema.pre('validate', function (next) {
  if (this.shape === 'circle') {
    if (this.latitude === undefined || this.longitude === undefined) {
      return next(new Error('Latitude and longitude are required for circle geo-fence'));
    }
  } else if (this.shape === 'polyline') {
    if (!this.polylinePoints || this.polylinePoints.length < 2) {
      return next(new Error('At least 2 polyline points are required for polyline geo-fence'));
    }
  }
  next();
});

geoFenceLocationSchema.index({ isActive: 1 });

geoFenceLocationSchema.virtual('coordinates').get(function () {
  if (this.shape === 'polyline') {
    return `${this.polylinePoints?.length || 0} points`;
  }
  return `${this.latitude}, ${this.longitude}`;
});

geoFenceLocationSchema.set('toJSON', { virtuals: true });
geoFenceLocationSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('GeoFenceLocation', geoFenceLocationSchema);