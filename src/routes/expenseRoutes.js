// routes/expenseRoutes.js
const express = require('express');
const router = express.Router();

const expenseController = require('../controllers/expenseController');
const { protect, hrAdminAndAbove } = require('../middleware/auth');
const { expenseUpload } = require('../middleware/upload');

// Apply auth middleware to all routes
router.use(protect);

// ─────────────────────────────────────────────
// HR / ADMIN ROUTES — declared FIRST
// because '/hr/...' must not be caught by '/:id'
// ─────────────────────────────────────────────
router.get('/hr/all', hrAdminAndAbove, expenseController.getAllExpensesForHR);
router.get('/hr/pending', hrAdminAndAbove, expenseController.getPendingExpenses);
router.get('/hr/approved', hrAdminAndAbove, expenseController.getApprovedExpenses);
router.get('/hr/rejected', hrAdminAndAbove, expenseController.getRejectedExpenses);
router.get('/hr/stats', hrAdminAndAbove, expenseController.getExpenseStats);
router.get('/hr/department', hrAdminAndAbove, expenseController.getDepartmentExpenses);

// ─────────────────────────────────────────────
// EMPLOYEE ROUTES — static paths first
// ─────────────────────────────────────────────
router.get('/me', expenseController.getMyExpenses);

router.post(
  '/',
  expenseUpload.single('receipt'),
  expenseController.createExpense
);

// ─────────────────────────────────────────────
// Parameterized routes LAST
// ─────────────────────────────────────────────
router.get('/:id', expenseController.getExpenseById);

router.put(
  '/:id',
  expenseUpload.single('receipt'),
  expenseController.updateExpense
);

router.delete('/:id', expenseController.deleteExpense);

router.post('/:id/submit', expenseController.submitExpense);

// HR approval action on a specific expense
router.put('/:id/hr-approve', hrAdminAndAbove, expenseController.hrApproveExpense);

module.exports = router;