// routes/holidayRoutes.js
const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
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
router.post('/', authorize('hr', 'superadmin'), validateHolidayInput, addHoliday);
router.put('/:id', authorize('hr', 'superadmin'), validateObjectId, validateHolidayInput, updateHoliday);
router.delete('/:id', authorize('hr', 'superadmin'), validateObjectId, deleteHoliday);

// ========== BULK IMPORT ==========
router.post('/bulk-import', authorize('hr', 'superadmin'), bulkUpload.single('file'), bulkImportHolidays);

// ========== SUPERADMIN ONLY ==========
router.delete('/:id/permanent', authorize('superadmin'), validateObjectId, permanentDeleteHoliday);
router.get('/export', authorize('superadmin'), exportHolidays);
router.get('/stats', authorize('superadmin'), getHolidayStats);

module.exports = router;