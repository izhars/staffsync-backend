// routes/assetRoutes.js
const express = require('express');
const router = express.Router();

const { protect, hrAdminAndAbove } = require('../middleware/auth');

const {
  getAllAssets,
  getMyAssets,
  getAsset,
  createAsset,
  updateAsset,
  assignAsset,
  returnAsset,
  deleteAsset,
  changeAssetStatus,
} = require('../controllers/assetController');

router.use(protect);

// ─────────────────────────────────────────────
// Static / collection routes
// ─────────────────────────────────────────────
router.get('/my-assets', getMyAssets);

router
  .route('/')
  .get(hrAdminAndAbove, getAllAssets)
  .post(hrAdminAndAbove, createAsset);

// ─────────────────────────────────────────────
// Parameterized routes
// ─────────────────────────────────────────────
router
  .route('/:id')
  .get(getAsset)
  .put(hrAdminAndAbove, updateAsset)
  .delete(hrAdminAndAbove, deleteAsset);

router.put('/:id/assign', hrAdminAndAbove, assignAsset);
router.put('/:id/return', hrAdminAndAbove, returnAsset);
router.put('/:id/status', hrAdminAndAbove, changeAssetStatus);

module.exports = router;