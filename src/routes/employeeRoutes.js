// routes/employeeRoutes.js
const express = require('express');
const router = express.Router();

const {
  protect,
  managerAndAbove,       // super_admin + hr_admin + manager
  hrAdminAndAbove,       // super_admin + hr_admin
  superAdminOnly,        // super_admin only
} = require('../middleware/auth');

const { upload } = require('../middleware/upload');
const c = require('../controllers/employeeController');

router.use(protect);

// ─────────────────────────────────────────────
// Static / collection routes  (must come BEFORE /:id)
// ─────────────────────────────────────────────
router.get('/hr', c.getAllHRs);
router.get('/last-seen', c.getEmployeeList);
router.get('/', managerAndAbove, c.getAllEmployees);
router.post('/', hrAdminAndAbove, c.createEmployee);

// ─────────────────────────────────────────────
// Parameterized routes
// ─────────────────────────────────────────────
router.get('/:id', c.getEmployee);
router.put('/:id', hrAdminAndAbove, c.updateEmployee);
router.delete('/:id', superAdminOnly, c.deleteEmployee);

router.post(
  '/:id/documents',
  hrAdminAndAbove,
  upload.single('document'),
  c.uploadDocument
);

router.put(
  '/:id/profile-picture',
  upload.single('profilePicture'),
  c.updateProfilePicture
);

router.put(
  '/:id/availability',
  hrAdminAndAbove,
  c.toggleHRAvailability
);

router.get(
  '/:id/availability-status',
  managerAndAbove,
  c.getAvailabilityStatus
);

module.exports = router;