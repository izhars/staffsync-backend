const express = require('express');
const router = express.Router();
const {
  protect,
  managerAndAbove,
  hrAdminAndAbove,
  superAdminOnly,
} = require('../middleware/auth');
const { upload } = require('../middleware/upload');
const {
  getAllHRs,
  getEmployeeList,
  getAllEmployees,
  createEmployee,
  getEmployee,
  updateEmployee,
  deleteEmployee,
  uploadDocument,
  updateProfilePicture,
  toggleHRAvailability,
  getAvailabilityStatus,
} = require('../controllers/employeeController');

router.use(protect);

// Static routes
router.get('/hr', getAllHRs);
router.get('/last-seen', getEmployeeList);
router.get('/', managerAndAbove, getAllEmployees);
router.post('/', hrAdminAndAbove, createEmployee);

// Parameter routes
router.get('/:id', getEmployee);
router.put('/:id', hrAdminAndAbove, updateEmployee);
router.delete('/:id', superAdminOnly, deleteEmployee);

router.post(
  '/:id/documents',
  hrAdminAndAbove,
  upload.single('document'),
  uploadDocument
);

router.put(
  '/:id/profile-picture',
  upload.single('profilePicture'),
  updateProfilePicture
);

router.put(
  '/:id/availability',
  hrAdminAndAbove,
  toggleHRAvailability
);

router.get(
  '/:id/availability-status',
  managerAndAbove,
  getAvailabilityStatus
);

module.exports = router;