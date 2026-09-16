// models/FaceEmbedding.js
const mongoose = require('mongoose');

const faceEmbeddingSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    // 128-D vector from FaceNet / MobileFaceNet
    embedding: {
      type: [Number],
      required: true,
      validate: {
        validator: (v) => v.length === 128 || v.length === 192 || v.length === 512,
        message: 'Embedding must be 128, 192, or 512 dimensions',
      },
    },
    model: {
      type: String,
      default: 'mobilefacenet',
      enum: ['mobilefacenet', 'facenet', 'arcface'],
    },
    // Anti-spoof metadata
    livenessPassed: { type: Boolean, default: false },
    // Enrollment audit
    enrolledAt: { type: Date, default: Date.now },
    enrolledFrom: {
      type: String,
      enum: ['mobile', 'desktop', 'admin-enroll'],
      default: 'mobile',
    },
    // Reference thumbnail (optional, for HR verification UI)
    referenceImageUrl: String,
    isActive: { type: Boolean, default: true },
    updatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Only one active embedding per employee
faceEmbeddingSchema.index({ employee: 1, isActive: 1 });

module.exports = mongoose.model('FaceEmbedding', faceEmbeddingSchema);