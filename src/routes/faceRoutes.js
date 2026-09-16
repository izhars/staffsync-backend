// routes/faceRoutes.js
const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const {
  // Employee self-service
  registerFace,
  getFaceStatus,
  verifyFace,
  deleteFace,
  compareEmbeddings,
  // Admin/HR
  listEnrollments,
  getEnrollmentByEmployee,
  adminEnrollFace,
  toggleEnrollment,
  getEnrollmentStats,
  listNotEnrolled,
  adminVerifyAgainstEmployee,
  exportEnrollments,
  bulkDeleteEnrollments,
} = require('../controllers/faceController');

router.use(protect);

// ── Employee self-service ─────────────────────────────────────
router.post('/register', registerFace);
router.post('/verify', verifyFace);
router.get('/status', getFaceStatus);
router.delete('/enrollments', deleteFace);

// ── Debug / utility (any authenticated user) ──────────────────
router.post('/compare', compareEmbeddings);

// ── HR/Admin — manage any employee ───────────────────────────
router.delete(
  '/enrollments/:employeeId',
  authorize('hr', 'superadmin'),
  deleteFace
);

router.get(
  '/admin/enrollments',
  authorize('hr', 'superadmin'),
  listEnrollments
);

router.get(
  '/admin/enrollments/:employeeId',
  authorize('hr', 'superadmin'),
  getEnrollmentByEmployee
);

router.post(
  '/admin/enroll/:employeeId',
  authorize('hr', 'superadmin'),
  adminEnrollFace
);

router.patch(
  '/admin/enrollments/:employeeId/toggle',
  authorize('hr', 'superadmin'),
  toggleEnrollment
);

router.get(
  '/admin/stats',
  authorize('hr', 'superadmin'),
  getEnrollmentStats
);

router.get(
  '/admin/not-enrolled',
  authorize('hr', 'superadmin'),
  listNotEnrolled
);

router.post(
  '/admin/verify-against/:employeeId',
  authorize('hr', 'superadmin'),
  adminVerifyAgainstEmployee
);

router.get(
  '/admin/export',
  authorize('hr', 'superadmin'),
  exportEnrollments
);

router.delete(
  '/admin/enrollments/bulk',
  authorize('hr', 'superadmin'),
  bulkDeleteEnrollments
);

module.exports = router;