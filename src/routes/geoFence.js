const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
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

router.use(protect);

// Employee routes
router.get('/my-locations', getMyLocations);
router.post('/check', checkLocation);

// HR/Admin routes
router
  .route('/locations')
  .get(authorize('hr', 'superadmin', 'manager'), getAllLocations)
  .post(authorize('hr', 'superadmin'), createLocation);

router
  .route('/locations/:id')
  .get(authorize('hr', 'superadmin', 'manager'), getLocationById)
  .put(authorize('hr', 'superadmin'), updateLocation)
  .delete(authorize('hr', 'superadmin'), deleteLocation);

router.patch(
  '/locations/:id/toggle',
  authorize('hr', 'superadmin'),
  toggleLocationStatus
);

module.exports = router;