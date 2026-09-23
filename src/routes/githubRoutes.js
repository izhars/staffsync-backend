// routes/githubRoutes.js
const express = require('express');
const router = express.Router();

const { pushCode, getStatus } = require('../controllers/githubController');
const { protect, superAdminOnly } = require('../middleware/auth');

// 🔐 Only Super Admin can push/view GitHub deployment status
router.use(protect);
router.use(superAdminOnly);

router.post('/push', pushCode);
router.get('/status', getStatus);

module.exports = router;