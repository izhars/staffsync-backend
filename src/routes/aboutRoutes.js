// routes/aboutRoutes.js (or similar)
const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const { ACCESS_ROLES } = require('../constants/roles');

// ✅ Import the configured upload from your middleware
const { upload } = require('../middleware/upload');

const {
  getAboutInfo,
  createOrUpdateAbout,
  addTimelineItem,
  updateTimelineItem,
  deleteTimelineItem,
  addStatItem,
  updateStatItem,
  deleteStatItem,
  addTeamMember,
  updateTeamMember,
  deleteTeamMember
} = require('../controllers/aboutController');

// Public route
router.get('/', getAboutInfo);

// Admin - Main content (upsert)
router.put(
  '/content',
  protect,
  authorize(ACCESS_ROLES.HR_ADMIN, ACCESS_ROLES.SUPER_ADMIN),
  createOrUpdateAbout
);

// Timeline routes
router.post(
  '/timeline',
  protect,
  authorize(ACCESS_ROLES.HR_ADMIN, ACCESS_ROLES.SUPER_ADMIN),
  addTimelineItem
);
router.put(
  '/timeline/:id',
  protect,
  authorize(ACCESS_ROLES.HR_ADMIN, ACCESS_ROLES.SUPER_ADMIN),
  updateTimelineItem
);
router.delete(
  '/timeline/:id',
  protect,
  authorize(ACCESS_ROLES.HR_ADMIN, ACCESS_ROLES.SUPER_ADMIN),
  deleteTimelineItem
);

// Stats routes
router.post(
  '/stats',
  protect,
  authorize(ACCESS_ROLES.HR_ADMIN, ACCESS_ROLES.SUPER_ADMIN),
  addStatItem
);
router.put(
  '/stats/:id',
  protect,
  authorize(ACCESS_ROLES.HR_ADMIN, ACCESS_ROLES.SUPER_ADMIN),
  updateStatItem
);
router.delete(
  '/stats/:id',
  protect,
  authorize(ACCESS_ROLES.HR_ADMIN, ACCESS_ROLES.SUPER_ADMIN),
  deleteStatItem
);

// Team routes - with file upload
router.post(
  '/team',
  protect,
  authorize(ACCESS_ROLES.HR_ADMIN, ACCESS_ROLES.SUPER_ADMIN),
  // Specify the field name expected in the form-data
  upload.single('image'),
  addTeamMember
);

router.put(
  '/team/:id',
  protect,
  authorize(ACCESS_ROLES.HR_ADMIN, ACCESS_ROLES.SUPER_ADMIN),
  upload.single('image'), // 'image' should match the field name in the request
  updateTeamMember
);

router.delete(
  '/team/:id',
  protect,
  authorize(ACCESS_ROLES.HR_ADMIN, ACCESS_ROLES.SUPER_ADMIN),
  deleteTeamMember
);

module.exports = router;