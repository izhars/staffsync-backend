// routes/holidayRoutes.js
const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const { ACCESS_ROLES } = require('../constants/roles');
const validateObjectId = require('../middleware/validateObjectId');
const validateHolidayInput = require('../middleware/validateHolidayInput');
const { bulkUpload } = require('../middleware/upload');

const {
  addHoliday,
  getHolidays,
  deleteHoliday,
  updateHoliday,
  getHolidayById,
  getHolidaysByYear,
  getUpcomingHolidays,
  getHolidaysByType,
  getHolidaysByCategory,          // ✅ NEW
  getRestrictedHolidaySummary,    // ✅ NEW
  bulkImportHolidays,
  exportHolidays,
  getHolidayStats,
  permanentDeleteHoliday
} = require('../controllers/holidayController');

router.use(protect);

// ========== PUBLIC (Authenticated Users) ==========
router.get('/', getHolidays);
router.get('/year/:year', getHolidaysByYear);
router.get('/upcoming', getUpcomingHolidays);
router.get('/type/:type', getHolidaysByType);
router.get('/category/:category', getHolidaysByCategory);              // ✅ NEW
router.get('/restricted/summary', getRestrictedHolidaySummary);        // ✅ NEW
router.get('/:id', validateObjectId, getHolidayById);

// ========== HR & SUPERADMIN ACCESS ==========
router.post('/', authorize(ACCESS_ROLES.HR_ADMIN, ACCESS_ROLES.SUPER_ADMIN), validateHolidayInput, addHoliday);
router.put('/:id', authorize(ACCESS_ROLES.HR_ADMIN, ACCESS_ROLES.SUPER_ADMIN), validateObjectId, validateHolidayInput, updateHoliday);
router.delete('/:id', authorize(ACCESS_ROLES.HR_ADMIN, ACCESS_ROLES.SUPER_ADMIN), validateObjectId, deleteHoliday);

// ========== BULK IMPORT ==========
router.post('/bulk-import', authorize(ACCESS_ROLES.HR_ADMIN, ACCESS_ROLES.SUPER_ADMIN), bulkUpload.single('file'), bulkImportHolidays);

// ========== SUPERADMIN ONLY ==========
router.delete('/:id/permanent', authorize(ACCESS_ROLES.SUPER_ADMIN), validateObjectId, permanentDeleteHoliday);
router.get('/export', authorize(ACCESS_ROLES.SUPER_ADMIN), exportHolidays);
router.get('/stats', authorize(ACCESS_ROLES.SUPER_ADMIN), getHolidayStats);

module.exports = router;