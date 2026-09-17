// routes/expenseCategoryRoutes.js
const express = require('express');
const router = express.Router();

const { protect, hrAdminAndAbove } = require('../middleware/auth');
const categoryController = require('../controllers/expenseCategoryController');

router.use(protect);

// ─────────────────────────────────────────────
// Admin / HR only
// ─────────────────────────────────────────────
router.post('/', hrAdminAndAbove, categoryController.createCategory);
router.put('/:id', hrAdminAndAbove, categoryController.updateCategory);
router.delete('/:id', hrAdminAndAbove, categoryController.deactivateCategory);

// ─────────────────────────────────────────────
// Everyone can read
// ─────────────────────────────────────────────
router.get('/', categoryController.getCategories);
router.get('/:id', categoryController.getCategoryById);

module.exports = router;