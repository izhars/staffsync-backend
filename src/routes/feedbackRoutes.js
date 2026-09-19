const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const { ACCESS_ROLES } = require('../constants/roles');
const feedbackController = require('../controllers/feedbackController');

router.use(protect); // require authentication for all feedback routes

// Employees submit feedback
router.post('/', feedbackController.createFeedback);
// HR/Admin view analytics, summaries and management
router.get('/summary', authorize(ACCESS_ROLES.HR_ADMIN, ACCESS_ROLES.SUPER_ADMIN), feedbackController.getFeedbackSummary);
router.get('/analytics', authorize(ACCESS_ROLES.HR_ADMIN, ACCESS_ROLES.SUPER_ADMIN), feedbackController.getFeedbackAnalytics);
router.get('/export', authorize(ACCESS_ROLES.HR_ADMIN, ACCESS_ROLES.SUPER_ADMIN), feedbackController.exportFeedbacks);
router.get('/', authorize(ACCESS_ROLES.HR_ADMIN, ACCESS_ROLES.SUPER_ADMIN), feedbackController.getAllFeedbacks);
router.put('/:id/respond', authorize(ACCESS_ROLES.HR_ADMIN, ACCESS_ROLES.SUPER_ADMIN), feedbackController.respondToFeedback);


module.exports = router;