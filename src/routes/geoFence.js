// routes/geoFenceRoutes.js
const express = require('express');
const router = express.Router();

const {
  protect,
  hrAdminAndAbove,
  managerAndAbove,
} = require('../middleware/auth');

const {
  createLocation,
  getAllLocations,
  getLocationById,
  updateLocation,
  deleteLocation,
  toggleLocationStatus,
  getMyLocations,
  checkLocation,
  getAssignableUsers,
  updateAssignees,
} = require('../controllers/geoFenceController');

// All routes below require authentication
router.use(protect);

// ─────────────────────────────────────────────
// Employee routes (any authenticated user)
// ─────────────────────────────────────────────
router.get('/my-locations', getMyLocations);
router.post('/check', checkLocation);

// ─────────────────────────────────────────────
// Assignee picker data (HR only)
// ─────────────────────────────────────────────
router.get('/assignable-users', hrAdminAndAbove, getAssignableUsers);

// ─────────────────────────────────────────────
// Location collection
//   GET  → manager and above (read-only)
//   POST → HR admin and above (write)
// ─────────────────────────────────────────────
router
  .route('/locations')
  .get(managerAndAbove, getAllLocations)
  .post(hrAdminAndAbove, createLocation);

// ─────────────────────────────────────────────
// Single location
// ─────────────────────────────────────────────
router
  .route('/locations/:id')
  .get(managerAndAbove, getLocationById)
  .put(hrAdminAndAbove, updateLocation)
  .delete(hrAdminAndAbove, deleteLocation);

// ─────────────────────────────────────────────
// Toggle active/inactive status
// ─────────────────────────────────────────────
router.patch(
  '/locations/:id/toggle',
  hrAdminAndAbove,
  toggleLocationStatus
);

// ─────────────────────────────────────────────
// Bulk update assignees for a location
// ─────────────────────────────────────────────
router.patch(
  '/locations/:id/assignees',
  hrAdminAndAbove,
  updateAssignees
);

module.exports = router;