// routes/faceRoutes.js
const express = require('express');
const router = express.Router();

const {
  protect,
  hrAdminAndAbove,   // super_admin + hr_admin
} = require('../middleware/auth');

const {
  registerFace,
  getFaceStatus,
  verifyFace,
  deleteFace,
  compareEmbeddings,
  deleteOwnFace, 
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

// All routes below require authentication
router.use(protect);

// ─────────────────────────────────────────────
// Employee self-service (any authenticated user)
// ─────────────────────────────────────────────
router.post('/register', registerFace);
router.post('/verify', verifyFace);
router.get('/status', getFaceStatus);
router.delete('/enrollments', deleteOwnFace);
// ─────────────────────────────────────────────
// Debug / utility (any authenticated user)
// ─────────────────────────────────────────────
router.post('/compare', compareEmbeddings);

// ─────────────────────────────────────────────
// HR/Admin — manage any employee
// ─────────────────────────────────────────────
router.delete(
  '/enrollments/:employeeId',
  hrAdminAndAbove,
  deleteFace
);

router.get(
  '/admin/enrollments',
  hrAdminAndAbove,
  listEnrollments
);

router.get(
  '/admin/enrollments/:employeeId',
  hrAdminAndAbove,
  getEnrollmentByEmployee
);

router.post(
  '/admin/enroll/:employeeId',
  hrAdminAndAbove,
  adminEnrollFace
);

router.patch(
  '/admin/enrollments/:employeeId/toggle',
  hrAdminAndAbove,
  toggleEnrollment
);

router.get(
  '/admin/stats',
  hrAdminAndAbove,
  getEnrollmentStats
);

router.get(
  '/admin/not-enrolled',
  hrAdminAndAbove,
  listNotEnrolled
);

router.post(
  '/admin/verify-against/:employeeId',
  hrAdminAndAbove,
  adminVerifyAgainstEmployee
);

router.get(
  '/admin/export',
  hrAdminAndAbove,
  exportEnrollments
);

router.delete(
  '/admin/enrollments/bulk',
  hrAdminAndAbove,
  bulkDeleteEnrollments
);

module.exports = router;