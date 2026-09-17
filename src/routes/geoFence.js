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
} = require('../controllers/geoFenceController');

// All routes below require authentication
router.use(protect);

// ─────────────────────────────────────────────
// Employee routes (any authenticated user)
// ─────────────────────────────────────────────
router.get('/my-locations', getMyLocations);
router.post('/check', checkLocation);

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
//   GET    → manager and above (read-only)
//   PUT    → HR admin and above
//   DELETE → HR admin and above
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

module.exports = router;