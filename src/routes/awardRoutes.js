// routes/awardRoutes.js
const express = require('express');
const { protect, hrAdminAndAbove, superAdminOnly } = require('../middleware/auth');

const {
  createAward,
  getAwards,
  getAward,
  updateAward,
  deleteAward,
  getMyAwards,
} = require('../controllers/awardController');

const router = express.Router();

// ─────────────────────────────────────────────
// Employee self-service
// ─────────────────────────────────────────────
router.get('/me', protect, getMyAwards);

// ─────────────────────────────────────────────
// HR & above
// ─────────────────────────────────────────────
router.use(protect, hrAdminAndAbove);

router.route('/')
  .post(createAward)
  .get(getAwards);

// ─────────────────────────────────────────────
// Parameterized routes
// ─────────────────────────────────────────────
router.route('/:id')
  .get(getAward)
  .put(updateAward);

// ─────────────────────────────────────────────
// Super-admin only
// ─────────────────────────────────────────────
router.delete('/:id', superAdminOnly, deleteAward);

module.exports = router;