// controllers/faceController.js
const FaceEmbedding = require('../models/FaceEmbedding');
const User = require('../models/User');
const Attendance = require('../models/Attendance');
const { verifyFaceMatch, l2Normalize } = require('../utils/faceMatch');
const { getISTMidnight } = require('../utils/dateUtils');

// ─────────────────────────────────────────────────────────────
// SHARED HELPERS (validation only — no authorization logic)
// ─────────────────────────────────────────────────────────────

const validateEmbedding = (embedding) => {
  if (!Array.isArray(embedding) || embedding.length < 128) {
    return { ok: false, reason: 'INVALID_EMBEDDING',
             message: 'Invalid embedding. Must be an array of at least 128 floats.' };
  }
  const badIndex = embedding.findIndex(
    (v) => typeof v !== 'number' || !Number.isFinite(v)
  );
  if (badIndex !== -1) {
    return { ok: false, reason: 'INVALID_EMBEDDING_VALUES',
             message: `Embedding value at index ${badIndex} is not a finite number.` };
  }
  return { ok: true };
};

// ─────────────────────────────────────────────────────────────
// EMPLOYEE SELF-SERVICE
// ─────────────────────────────────────────────────────────────

/**
 * POST /api/face/register
 * Any authenticated user. Registers/updates their OWN face.
 * Blocks re-enrollment while an active record exists.
 * Admin re-enrollment goes through /admin/re-enroll/:employeeId instead.
 */
exports.registerFace = async (req, res) => {
  const requestId = `FACE-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const logPrefix = `[registerFace][${requestId}]`;

  try {
    const {
      embedding,
      model = 'mobilefacenet',
      livenessPassed = false,
      referenceImageUrl,
      enrolledFrom = 'mobile',
    } = req.body;

    const check = validateEmbedding(embedding);
    if (!check.ok) {
      console.warn(`${logPrefix} ❌ ${check.reason}`);
      return res.status(400).json({ success: false, ...check });
    }

    if (!livenessPassed) {
      console.warn(`${logPrefix} ❌ LIVENESS_FAILED`);
      return res.status(400).json({
        success: false,
        reason: 'LIVENESS_FAILED',
        message: 'Liveness check failed. A live face is required.',
      });
    }

    // Self-service: never overwrite an active enrollment.
    const existing = await FaceEmbedding.findOne({ employee: req.user.id });
    if (existing && existing.isActive) {
      console.warn(`${logPrefix} ❌ ALREADY_ENROLLED`, { userId: req.user.id });
      return res.status(409).json({
        success: false,
        reason: 'ALREADY_ENROLLED',
        message: 'Face already registered. Contact HR to re-enroll.',
        data: {
          model: existing.model,
          enrolledAt: existing.enrolledAt,
          livenessPassed: existing.livenessPassed,
        },
      });
    }

    const normalized = l2Normalize(embedding);
    const record = await FaceEmbedding.findOneAndUpdate(
      { employee: req.user.id },
      {
        employee: req.user.id,
        embedding: normalized,
        model,
        livenessPassed,
        enrolledAt: new Date(),
        enrolledFrom,
        referenceImageUrl,
        isActive: true,
        updatedAt: new Date(),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return res.status(200).json({
      success: true,
      message: 'Face registered successfully',
      data: {
        employeeId: req.user.id,
        model: record.model,
        enrolledAt: record.enrolledAt,
        embeddingSize: record.embedding.length,
      },
    });
  } catch (err) {
    console.error(`${logPrefix} ❌ SERVER_ERROR:`, err);
    return res.status(500).json({
      success: false, reason: 'SERVER_ERROR',
      message: err.message, requestId,
    });
  }
};

/**
 * GET /api/face/status
 * Any authenticated user. Reports whether the caller has an active enrollment.
 */
exports.getFaceStatus = async (req, res) => {
  const logPrefix = `[getFaceStatus][user=${req.user?.id}]`;
  try {
    const record = await FaceEmbedding.findOne({
      employee: req.user.id,
      isActive: true,
    }).select('model enrolledAt livenessPassed embeddingSize');

    return res.json({
      success: true,
      registered: !!record,
      data: record
        ? {
            model: record.model,
            enrolledAt: record.enrolledAt,
            livenessPassed: record.livenessPassed,
          }
        : null,
    });
  } catch (err) {
    console.error(`${logPrefix} ❌ Error:`, err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * POST /api/face/verify
 * Any authenticated user. Verifies the caller's own face against their
 * stored embedding, then reports their attendance state.
 * Does NOT itself create a punch.
 */
exports.verifyFace = async (req, res) => {
  const requestId = `VERIFY-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const logPrefix = `[verifyFace][${requestId}]`;

  try {
    const { embedding, action = 'check-in' } = req.body;

    if (!Array.isArray(embedding) || embedding.length < 128) {
      console.warn(`${logPrefix} ❌ Invalid embedding payload`);
      return res.status(400).json({
        success: false, message: 'Invalid embedding payload.',
      });
    }

    const record = await FaceEmbedding.findOne({
      employee: req.user.id,
      isActive: true,
    });

    if (!record) {
      console.warn(`${logPrefix} ❌ NOT_ENROLLED`);
      return res.status(404).json({
        success: false, reason: 'NOT_ENROLLED',
        message: 'No face registered. Please enroll first.',
      });
    }

    const result = verifyFaceMatch(embedding, record.embedding, 0.80);

    if (!result.matched) {
      console.warn(`${logPrefix} ❌ FACE_MISMATCH`, {
        similarity: result.similarity, threshold: result.threshold,
      });
      return res.status(401).json({
        success: false, reason: 'FACE_MISMATCH',
        message: 'Face does not match registered profile.',
        similarity: result.similarity,
        threshold: result.threshold,
      });
    }

    const today = getISTMidnight();
    const attendance = await Attendance.findOne({
      employee: req.user.id, date: today,
    });

    if (action === 'check-out' && !attendance?.checkIn?.time) {
      console.warn(`${logPrefix} ❌ NO_CHECK_IN`);
      return res.status(400).json({
        success: false, reason: 'NO_CHECK_IN',
        message: 'Please check in first.',
      });
    }

    return res.json({
      success: true,
      message: 'Face verified',
      similarity: result.similarity,
      action,
      attendanceState: {
        hasCheckedIn: !!attendance?.checkIn?.time,
        hasCheckedOut: !!attendance?.checkOut?.time,
      },
    });
  } catch (err) {
    console.error(`${logPrefix} ❌ SERVER_ERROR:`, err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * DELETE /api/face/enrollments
 * Any authenticated user. Deactivates the CALLER'S OWN enrollment.
 * Route has no role middleware → the only thing a caller can touch is self.
 */
exports.deleteOwnFace = async (req, res) => {
  try {
    const result = await FaceEmbedding.findOneAndUpdate(
      { employee: req.user.id },
      { isActive: false, updatedAt: new Date() },
      { new: true }
    );

    if (!result) {
      return res.status(404).json({ success: false, message: 'No enrollment found' });
    }
    return res.json({ success: true, message: 'Face enrollment removed' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * POST /api/face/compare
 * Any authenticated user. Debug utility — compares two embeddings directly.
 */
exports.compareEmbeddings = async (req, res) => {
  try {
    const { embeddingA, embeddingB, threshold = 0.80 } = req.body;

    if (
      !Array.isArray(embeddingA) || !Array.isArray(embeddingB) ||
      embeddingA.length < 128 || embeddingB.length < 128
    ) {
      return res.status(400).json({
        success: false,
        message: 'Both embeddings must be arrays of at least 128 numbers.',
      });
    }
    if (embeddingA.length !== embeddingB.length) {
      return res.status(400).json({
        success: false, message: 'Embeddings must be the same length.',
      });
    }

    const result = verifyFaceMatch(embeddingA, embeddingB, threshold);

    return res.json({
      success: true,
      data: {
        matched: result.matched,
        similarity: result.similarity,
        distance: result.distance,
        threshold: result.threshold,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────
// HR / ADMIN — the routes that reach these are gated by
// `hrAdminAndAbove`. They trust `req.params.employeeId` blindly.
// ─────────────────────────────────────────────────────────────

/**
 * DELETE /api/face/enrollments/:employeeId
 * HR/Admin. Deactivates ANY employee's enrollment.
 */
exports.deleteFace = async (req, res) => {
  try {
    const { employeeId } = req.params;

    const result = await FaceEmbedding.findOneAndUpdate(
      { employee: employeeId },
      { isActive: false, updatedAt: new Date() },
      { new: true }
    );

    if (!result) {
      return res.status(404).json({ success: false, message: 'No enrollment found' });
    }
    return res.json({ success: true, message: 'Face enrollment removed' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * GET /api/face/admin/enrollments
 * HR/Admin. Paginated list with filters. Never returns raw embeddings.
 * Query: ?page=1&limit=20&isActive=true&model=mobilefacenet&search=john
 */
exports.listEnrollments = async (req, res) => {
  const logPrefix = '[listEnrollments]';
  try {
    const { page = 1, limit = 20, isActive, model, search } = req.query;

    const filter = {};
    if (isActive !== undefined) filter.isActive = isActive === 'true';
    if (model) filter.model = model;

    if (search) {
      const users = await User.find({
        $or: [
          { name:  { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } },
        ],
      }).select('_id');
      filter.employee = { $in: users.map((u) => u._id) };
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [records, total] = await Promise.all([
      FaceEmbedding.find(filter)
        .populate('employee', 'name email role department employeeId')
        .sort({ enrolledAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .select('-embedding'),
      FaceEmbedding.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      data: records,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (err) {
    console.error(`${logPrefix} ❌ Error:`, err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * GET /api/face/admin/enrollments/:employeeId
 * HR/Admin. Single enrollment detail (no raw embedding).
 */
exports.getEnrollmentByEmployee = async (req, res) => {
  try {
    const record = await FaceEmbedding.findOne({
      employee: req.params.employeeId,
    })
      .populate('employee', 'name email role department employeeId')
      .select('-embedding');

    if (!record) {
      return res.status(404).json({
        success: false, reason: 'NOT_FOUND',
        message: 'No enrollment found for this employee.',
      });
    }
    return res.json({ success: true, data: record });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * POST /api/face/admin/enroll/:employeeId
 * HR/Admin. Enrolls a face on behalf of an employee.
 * Unlike self-service `registerFace`, this NEVER 409s — it overwrites.
 */
exports.adminEnrollFace = async (req, res) => {
  const logPrefix = '[adminEnrollFace]';
  try {
    const { employeeId } = req.params;
    const {
      embedding,
      model = 'mobilefacenet',
      livenessPassed = false,
      referenceImageUrl,
    } = req.body;

    const employee = await User.findById(employeeId);
    if (!employee) {
      return res.status(404).json({
        success: false, reason: 'EMPLOYEE_NOT_FOUND',
        message: 'Employee does not exist.',
      });
    }

    const check = validateEmbedding(embedding);
    if (!check.ok) {
      return res.status(400).json({ success: false, ...check });
    }

    const normalized = l2Normalize(embedding);
    const record = await FaceEmbedding.findOneAndUpdate(
      { employee: employeeId },
      {
        employee: employeeId,
        embedding: normalized,
        model,
        livenessPassed,
        enrolledAt: new Date(),
        enrolledFrom: 'admin-enroll',
        referenceImageUrl,
        isActive: true,
        updatedAt: new Date(),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return res.status(200).json({
      success: true,
      message: `Face enrolled for ${employee.name}`,
      data: {
        employeeId,
        model: record.model,
        enrolledAt: record.enrolledAt,
        embeddingSize: record.embedding.length,
      },
    });
  } catch (err) {
    console.error(`${logPrefix} ❌ Error:`, err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * PATCH /api/face/admin/enrollments/:employeeId/toggle
 * HR/Admin. Activate/deactivate without deleting.
 * Body: { isActive: true|false }
 */
exports.toggleEnrollment = async (req, res) => {
  try {
    const { isActive } = req.body;
    if (typeof isActive !== 'boolean') {
      return res.status(400).json({
        success: false, message: 'isActive must be a boolean.',
      });
    }

    const record = await FaceEmbedding.findOneAndUpdate(
      { employee: req.params.employeeId },
      { isActive, updatedAt: new Date() },
      { new: true }
    ).select('-embedding');

    if (!record) {
      return res.status(404).json({ success: false, message: 'No enrollment found.' });
    }

    return res.json({
      success: true,
      message: `Enrollment ${isActive ? 'activated' : 'deactivated'}.`,
      data: record,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * GET /api/face/admin/stats
 * HR/Admin. Enrollment dashboard numbers.
 */
exports.getEnrollmentStats = async (req, res) => {
  try {
    const [
      totalEmployees,
      totalEnrolled,
      activeEnrolled,
      inactiveEnrolled,
      byModel,
      recentEnrollments,
    ] = await Promise.all([
      User.countDocuments({ role: { $in: ['employee', 'hr_admin', 'superadmin'] } }),
      FaceEmbedding.countDocuments({}),
      FaceEmbedding.countDocuments({ isActive: true }),
      FaceEmbedding.countDocuments({ isActive: false }),
      FaceEmbedding.aggregate([{ $group: { _id: '$model', count: { $sum: 1 } } }]),
      FaceEmbedding.countDocuments({
        enrolledAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      }),
    ]);

    const enrolledIds = await FaceEmbedding.distinct('employee', { isActive: true });
    const notEnrolled = await User.countDocuments({
      role: { $in: ['employee', 'hr_admin', 'superadmin'] },
      _id: { $nin: enrolledIds },
    });

    return res.json({
      success: true,
      data: {
        totalEmployees,
        totalEnrolled,
        activeEnrolled,
        inactiveEnrolled,
        notEnrolled,
        enrollmentRate: totalEmployees
          ? ((activeEnrolled / totalEmployees) * 100).toFixed(2) + '%'
          : '0%',
        byModel: byModel.reduce((acc, m) => ({ ...acc, [m._id]: m.count }), {}),
        recentEnrollments7d: recentEnrollments,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * GET /api/face/admin/not-enrolled
 * HR/Admin. Paginated list of users who have no active enrollment.
 */
exports.listNotEnrolled = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;

    const enrolledIds = await FaceEmbedding.distinct('employee', { isActive: true });
    const filter = {
      role: { $in: ['employee', 'hr_admin', 'superadmin'] },
      _id: { $nin: enrolledIds },
    };

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [users, total] = await Promise.all([
      User.find(filter)
        .select('name email role department employeeId createdAt')
        .sort({ name: 1 })
        .skip(skip)
        .limit(parseInt(limit)),
      User.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      data: users,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * POST /api/face/admin/verify-against/:employeeId
 * HR/Admin. Test a live embedding against a specific employee's stored one.
 * Body: { embedding: [Number] }
 */
exports.adminVerifyAgainstEmployee = async (req, res) => {
  const logPrefix = '[adminVerifyAgainstEmployee]';
  try {
    const { embedding } = req.body;
    const { employeeId } = req.params;

    if (!Array.isArray(embedding) || embedding.length < 128) {
      return res.status(400).json({
        success: false, reason: 'INVALID_EMBEDDING', message: 'Invalid embedding.',
      });
    }

    const record = await FaceEmbedding.findOne({
      employee: employeeId, isActive: true,
    });

    if (!record) {
      return res.status(404).json({
        success: false, reason: 'NOT_ENROLLED',
        message: 'Employee has no active enrollment.',
      });
    }

    const result = verifyFaceMatch(embedding, record.embedding, 0.80);

    return res.json({
      success: true,
      data: {
        employeeId,
        matched: result.matched,
        similarity: result.similarity,
        distance: result.distance,
        threshold: result.threshold,
      },
    });
  } catch (err) {
    console.error(`${logPrefix} ❌ Error:`, err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * GET /api/face/admin/export
 * HR/Admin. Export enrollment metadata (no raw embeddings).
 * Query: ?format=json|csv
 */
exports.exportEnrollments = async (req, res) => {
  try {
    const { format = 'json' } = req.query;

    const records = await FaceEmbedding.find({ isActive: true })
      .populate('employee', 'name email role department employeeId')
      .select('-embedding')
      .lean();

    if (format === 'csv') {
      const headers = [
        'employeeId', 'name', 'email', 'role', 'department',
        'model', 'enrolledAt', 'enrolledFrom', 'livenessPassed',
      ];
      const rows = records.map((r) => [
        r.employee?.employeeId || '',
        r.employee?.name       || '',
        r.employee?.email      || '',
        r.employee?.role       || '',
        r.employee?.department || '',
        r.model,
        r.enrolledAt?.toISOString() || '',
        r.enrolledFrom || '',
        r.livenessPassed,
      ]);

      const csv = [headers, ...rows]
        .map((row) => row.map((v) => `"${v}"`).join(','))
        .join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=face-enrollments.csv');
      return res.send(csv);
    }

    return res.json({
      success: true,
      exportedAt: new Date().toISOString(),
      count: records.length,
      data: records,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * DELETE /api/face/admin/enrollments/bulk
 * HR/Admin. Deactivates many enrollments at once.
 * Body: { employeeIds: [String] }
 */
exports.bulkDeleteEnrollments = async (req, res) => {
  try {
    const { employeeIds } = req.body;

    if (!Array.isArray(employeeIds) || employeeIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'employeeIds must be a non-empty array.',
      });
    }

    const result = await FaceEmbedding.updateMany(
      { employee: { $in: employeeIds } },
      { isActive: false, updatedAt: new Date() }
    );

    return res.json({
      success: true,
      message: `${result.modifiedCount} enrollment(s) deactivated.`,
      data: { matched: result.matchedCount, modified: result.modifiedCount },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};