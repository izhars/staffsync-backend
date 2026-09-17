// models/ProfileLog.js
const mongoose = require('mongoose');

const profileLogSchema = new mongoose.Schema(
  {
    // Whose profile was changed
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    // Who made the change (may be self or an admin)
    changedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    // Whether the change was self-service or by an admin
    source: {
      type: String,
      enum: ['self', 'admin', 'system'],
      default: 'self',
      index: true,
    },

    // Field-level diff map:
    //   { "<fieldPath>": { before: <any>, after: <any> } }
    // Uses Mixed so we can store any shape (scalars, nested objects, arrays).
    changes: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
      default: {},
    },

    // Optional free-form reason / note
    reason: {
      type: String,
      trim: true,
      maxlength: 500,
    },

    // Request metadata (helpful for audits)
    ip:        { type: String, default: null },
    userAgent: { type: String, default: null },

    // When the change actually happened (in addition to createdAt)
    updatedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,               // adds createdAt + updatedAt (overridden above)
    toJSON:   { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ────────────────────────────────────────────────────────────────
// Indexes
// ────────────────────────────────────────────────────────────────
// Recent-first per user (common query for profile history pages)
profileLogSchema.index({ user: 1, updatedAt: -1 });

// Recent-first global (audit dashboards)
profileLogSchema.index({ updatedAt: -1 });

// Who-changed-what auditing
profileLogSchema.index({ changedBy: 1, updatedAt: -1 });

// ────────────────────────────────────────────────────────────────
// Virtuals
// ────────────────────────────────────────────────────────────────
profileLogSchema.virtual('changedFieldNames').get(function () {
  return Object.keys(this.changes || {});
});

profileLogSchema.virtual('changeCount').get(function () {
  return Object.keys(this.changes || {}).length;
});

// ────────────────────────────────────────────────────────────────
// Statics
// ────────────────────────────────────────────────────────────────

/**
 * Log a profile change.
 * @param {Object}  opts
 * @param {ObjectId|String} opts.user        - Target user whose profile changed.
 * @param {ObjectId|String} opts.changedBy   - Actor performing the change.
 * @param {Object}  opts.changes             - Field-level diff map.
 * @param {String}  [opts.source='self']     - 'self' | 'admin' | 'system'
 * @param {String}  [opts.reason]            - Optional note.
 * @param {Object}  [opts.req]               - Express req (for ip + userAgent).
 * @returns {Promise<Document>}
 */
profileLogSchema.statics.record = async function ({
  user,
  changedBy,
  changes,
  source = 'self',
  reason,
  req,
} = {}) {
  if (!changes || Object.keys(changes).length === 0) return null;

  const doc = {
    user,
    changedBy,
    source,
    changes,
    reason,
    ip:        req?.ip || req?.headers?.['x-forwarded-for'] || null,
    userAgent: req?.headers?.['user-agent'] || null,
    updatedAt: new Date(),
  };

  return this.create(doc);
};

/**
 * Compute a field-level diff between two objects.
 * Returns { field: { before, after } } for changed paths only.
 * Deep-compares via JSON stringify — sufficient for typical profile data.
 */
profileLogSchema.statics.diff = function (before = {}, after = {}) {
  const diff = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);

  for (const key of keys) {
    const b = before[key];
    const a = after[key];

    // Skip internal mongoose fields
    if (['_id', '__v', 'createdAt', 'updatedAt', 'password'].includes(key)) continue;

    if (JSON.stringify(b) !== JSON.stringify(a)) {
      diff[key] = { before: b, after: a };
    }
  }
  return diff;
};

module.exports = mongoose.model('ProfileLog', profileLogSchema);