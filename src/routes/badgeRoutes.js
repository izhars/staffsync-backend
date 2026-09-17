// routes/badgeRoutes.js
const express = require('express');
const router = express.Router();

// Import upload middleware - CORRECT WAY
const { badgeUpload } = require('../middleware/upload');

const {
  createBadge,
  getBadges,
  deleteBadge,
} = require('../controllers/badgeController');

const { protect, hrAdminAndAbove } = require('../middleware/auth');

// 🔒 All routes require auth + HR admin or above
router.use(protect);
router.use(hrAdminAndAbove);

// Create a new badge (with image upload)
router.post('/', badgeUpload.single('image'), createBadge);

// Get all badges
router.get('/', getBadges);

// Delete a badge by ID
router.delete('/:id', deleteBadge);

module.exports = router;